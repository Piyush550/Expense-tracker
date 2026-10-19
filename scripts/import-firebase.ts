// One-off: copy the old Firebase Realtime Database data into the Netlify (Postgres) database.
//
//   1. Firebase console → Realtime Database → Data → ⋮ → Export JSON  (saves firebase-export.json)
//   2. netlify database status --branch <your production branch> --show-credentials   (copy the URL)
//   3. DATABASE_URL='postgres://…' npm run import:firebase -- firebase-export.json --dry-run
//   4. Check the printed balances against the old app, then run again without --dry-run.
//
// Options: --space-name "Flat 4B"   --owner-email you@example.com   --dry-run
import { readFileSync } from "node:fs";
import pg from "pg";
import { formatMoney } from "../shared/money";
import { dbFromPool } from "../server/db";
import { importLedger, readLedger } from "./legacy-import";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const file = process.argv.slice(2).find((a, i, all) => !a.startsWith("--") && !all[i - 1]?.match(/^--(space-name|owner-email)$/));
const url = process.env.DATABASE_URL ?? process.env.NETLIFY_DB_URL;
if (!file || !url) {
  console.error("Usage: DATABASE_URL='postgres://…' npm run import:firebase -- <export.json> [--space-name NAME] [--owner-email EMAIL] [--dry-run]");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const ledger = readLedger(JSON.parse(readFileSync(file, "utf8")));
  const dryRun = process.argv.includes("--dry-run");
  const r = await importLedger(dbFromPool(pool), ledger, {
    spaceName: arg("space-name") ?? "Shared expenses",
    ownerEmail: arg("owner-email"),
    dryRun,
  });
  console.log(dryRun ? "\nDRY RUN: nothing was saved.\n" : "\nImport finished.\n");
  console.log(`Space id: ${r.spaceId}`);
  console.log(`Accounts: ${r.users}, names without an account: ${r.placeholders}`);
  console.log(`Expenses: ${r.expenses.imported} imported, ${r.expenses.alreadyThere} already there`);
  console.log(`Paid ticks → payments: ${r.payments.imported} imported, ${r.payments.alreadyThere} already there`);
  console.log(`Groups (quick-pick lists): ${r.groups} imported`);
  if (r.skipped.length) console.log(`\nSkipped ${r.skipped.length}:\n  ${r.skipped.join("\n  ")}`);
  console.log("\nBalances after import (positive = is owed):");
  if (!r.balances.length) console.log("  Everyone is square.");
  r.balances.forEach((b) => console.log(`  ${b.name.padEnd(24)} ${formatMoney(b.netPaise)}`));
} finally {
  await pool.end();
}
