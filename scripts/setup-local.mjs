import { randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import {
  localSettings,
  projectRoot,
} from "../experiments/auth-spike/scripts/local-runtime.mjs";

// Local-only setup. Never accepts a remote project, prints keys, or resets data.
const root = path.resolve(import.meta.dirname, "..");
const settings = localSettings();
const connection = new URL(settings.DB_URL);
const admin = new pg.Client({ connectionString: settings.DB_URL });
const migrationName = "20261002193221_dorosna_product.sql";
const migrationPath = path.join(root, "supabase", "migrations", migrationName);
const sql = readFileSync(migrationPath, "utf8");
const digest = createHash("sha256").update(sql).digest("hex");
try {
  await admin.connect();
  const existing = (
    await admin.query(
      "select to_regclass('app_private.runtime_migrations') as table_name",
    )
  ).rows[0];
  if (!existing.table_name) {
    const collision = (
      await admin.query(
        "select exists(select 1 from pg_namespace where nspname='app_private') as present",
      )
    ).rows[0];
    if (collision.present)
      throw new Error("Existing unrecognized product schema; setup refused.");
    const cli = path.join(
      projectRoot,
      "node_modules",
      "@supabase",
      "cli-windows-x64",
      "bin",
      "supabase.exe",
    );
    const dockerDir = path.join(
      process.env.LOCALAPPDATA,
      "Programs",
      "DockerDesktop",
      "resources",
      "bin",
    );
    const applied = spawnSync(
      cli,
      [
        "db",
        "query",
        "--local",
        "--workdir",
        projectRoot,
        "--file",
        migrationPath,
        "--agent",
        "no",
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 60_000,
        env: { ...process.env, PATH: `${dockerDir};${process.env.PATH ?? ""}` },
      },
    );
    if (applied.status !== 0) {
      // CLI 2.119.0 db query uses a prepared statement and rejects multi-statement
      // transactional migrations. Use the same verified localhost connection.
      if (
        !(applied.stderr ?? "").includes(
          "cannot insert multiple commands into a prepared statement",
        )
      )
        throw new Error("Local migration failed; no credentials were printed.");
      await admin.query(sql);
    }
    await admin.query(
      "insert into app_private.runtime_migrations(name,digest) values($1,$2)",
      [migrationName, digest],
    );
  } else {
    const recorded = (
      await admin.query(
        "select digest from app_private.runtime_migrations where name=$1",
        [migrationName],
      )
    ).rows[0];
    if (recorded?.digest !== digest)
      throw new Error("Migration file differs from the applied local schema.");
  }
  const envPath = path.join(root, ".env.local");
  if (!existsSync(envPath)) {
    const password = randomBytes(32).toString("base64url");
    // Password is generated locally and sent as SQL data, never as a command argument.
    await admin.query(`alter role dorosna_server password '${password}'`);
    connection.username = "dorosna_server";
    connection.password = password;
    const key = randomBytes(32).toString("hex");
    writeFileSync(
      envPath,
      [
        `DATABASE_URL=${connection.href}`,
        `SUPABASE_URL=${settings.API_URL}`,
        `SUPABASE_SERVER_KEY=${settings.SERVICE_ROLE_KEY}`,
        `APP_SECRET=${key}`,
        "APP_ORIGIN=http://127.0.0.1:3000",
        "DOROSNA_LOCAL_ONLY=1",
        "",
      ].join("\n"),
      { mode: 0o600, flag: "wx" },
    );
  }
  mkdirSync(path.join(root, ".local"), { recursive: true });
  console.log(
    JSON.stringify({
      localDatabaseReady: true,
      migration: migrationName,
      credentialsPrinted: false,
      existingDataPreserved: true,
    }),
  );
} catch (error) {
  console.error(
    error instanceof Error && error.message.startsWith("Migration file")
      ? error.message
      : "Local setup failed; inspect the current local runtime. Credentials were not printed.",
  );
  process.exitCode = 1;
} finally {
  await admin.end();
}
