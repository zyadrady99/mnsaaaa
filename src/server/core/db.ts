import "server-only";
import { Pool, types, type PoolClient } from "pg";
import { databasePoolConfig } from "@/server/core/database-config";

// Preserve PostgreSQL microseconds in entitlement and deadline calculations.
types.setTypeParser(1184, (value) => value);

const state = globalThis as typeof globalThis & { dorosnaPool?: Pool };
export function database() {
  if (!state.dorosnaPool) {
    state.dorosnaPool = new Pool(databasePoolConfig(process.env));
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
