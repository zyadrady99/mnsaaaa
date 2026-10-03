import "server-only";
import { Pool, types, type PoolClient } from "pg";

// Preserve PostgreSQL microseconds in entitlement and deadline calculations.
types.setTypeParser(1184, (value) => value);

const state = globalThis as typeof globalThis & { dorosnaPool?: Pool };
export function database() {
  if (!state.dorosnaPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("Local database setup is required.");
    const url = new URL(connectionString);
    if (
      process.env.DOROSNA_LOCAL_ONLY === "1" &&
      (url.hostname !== "127.0.0.1" ||
        url.port !== "54322" ||
        url.username !== "dorosna_server")
    )
      throw new Error("Unexpected local database.");
    state.dorosnaPool = new Pool({
      connectionString,
      max: 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30_000,
      application_name: "dorosna-web",
    });
  }
  return state.dorosnaPool;
}

export async function transaction<T>(work: (db: PoolClient) => Promise<T>) {
  const db = await database().connect();
  try {
    await db.query("begin");
    await db.query("set local lock_timeout='5s'");
    await db.query("set local statement_timeout='15s'");
    await db.query("set local timezone='UTC'");
    const result = await work(db);
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback").catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}
