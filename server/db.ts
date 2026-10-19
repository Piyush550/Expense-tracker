// The narrow database interface the API uses. Production passes the pg-compatible pool from
// @netlify/database; tests and local dev pass PGlite. Always use $1-style parameters.

export interface QueryResult<R> {
  rows: R[];
}

export interface Queryable {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<R>>;
}

export interface Db extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}

interface PoolClientLike {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  release(err?: Error | boolean): void;
}

export interface PoolLike {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  connect(): Promise<PoolClientLike>;
  on?(event: "error", listener: (err: Error) => void): unknown;
}

export function dbFromPool(pool: PoolLike): Db {
  // An idle connection can drop while the function is frozen; without a listener the
  // pool's "error" event would crash the process.
  pool.on?.("error", (err) => console.error("database pool error", err));
  return {
    query: (text, params) => pool.query(text, params) as never,
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({ query: (text, params) => client.query(text, params) as never });
        await client.query("COMMIT");
        client.release();
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        client.release(true);
        throw err;
      }
    },
  };
}

/** node-postgres returns BIGINT and SUM() as strings; PGlite may return bigint. */
export const num = (v: unknown): number => (v == null ? 0 : Number(v));

export const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

/** Postgres error code, e.g. "23505" for a unique violation. */
export const pgCode = (err: unknown): string | undefined =>
  typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : undefined;
