import "server-only";
import { X509Certificate } from "node:crypto";
import type { PoolConfig } from "pg";

export function databasePoolConfig(env: NodeJS.ProcessEnv): PoolConfig {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) throw new Error("Database setup is required.");

  let url: URL;
  try {
    url = new URL(connectionString);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.hostname ||
      !url.username ||
      !url.password ||
      url.pathname.length < 2 ||
      url.hash
    )
      throw new Error();
    // Decode here so invalid escapes cannot reach pg's URL parser and logs.
    decodeURIComponent(url.username);
    decodeURIComponent(url.password);
    decodeURIComponent(url.pathname);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }

  for (const name of url.searchParams.keys()) {
    const parameter = name.toLowerCase();
    if (parameter.startsWith("ssl") || parameter === "uselibpqcompat")
      throw new Error(
        "Configure database TLS with DATABASE_SSL_CA, without SSL URL parameters.",
      );
    if (["host", "hostaddr", "port", "user", "password"].includes(parameter))
      throw new Error(
        "Database connection overrides in the URL are not allowed.",
      );
  }

  const local = env.DOROSNA_LOCAL_ONLY === "1";
  if (
    local &&
    (url.hostname !== "127.0.0.1" ||
      url.port !== "54322" ||
      url.username !== "dorosna_server")
  )
    throw new Error("Unexpected local database.");

  let max = 10;
  let ssl: PoolConfig["ssl"] = false;
  if (!local) {
    const configuredMax = env.DATABASE_POOL_MAX ?? "1";
    if (!/^(?:[1-9]|10)$/.test(configuredMax))
      throw new Error("DATABASE_POOL_MAX must be an integer from 1 to 10.");
    max = Number(configuredMax);

    const ca = env.DATABASE_SSL_CA?.replaceAll("\\n", "\n").trim();
    if (ca) {
      try {
        new X509Certificate(ca);
      } catch {
        throw new Error(
          "DATABASE_SSL_CA must contain a valid PEM certificate.",
        );
      }
    }
    ssl = { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
  }

  return {
    connectionString,
    max,
    ssl,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30_000,
    application_name: "dorosna-web",
  };
}
