// Applies netlify/database/migrations/*.sql in order. Netlify does this itself on deploy;
// this is for tests and `npm run dev:local`.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "../server/db";

const DIR = fileURLToPath(new URL("../netlify/database/migrations/", import.meta.url));

export function readMigrations(): { name: string; sql: string }[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ name: f.replace(/\.sql$/, ""), sql: readFileSync(join(DIR, f), "utf8") }));
}

export async function migrate(pg: PGlite) {
  await pg.exec("CREATE TABLE IF NOT EXISTS _local_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())");
  const done = new Set((await pg.query<{ name: string }>("SELECT name FROM _local_migrations")).rows.map((r) => r.name));
  for (const m of readMigrations()) {
    if (done.has(m.name)) continue;
    await pg.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.query("INSERT INTO _local_migrations (name) VALUES ($1)", [m.name]);
    });
  }
}

export function dbFromPglite(pg: PGlite): Db {
  return {
    query: (text, params) => pg.query(text, params) as never,
    transaction: (fn) => pg.transaction((tx) => fn({ query: (text, params) => tx.query(text, params) as never })),
  };
}
