// Moves data from the old Firebase Realtime Database app (the `ledger` node) into Postgres.
// Safe to run more than once: every row gets a deterministic id and inserts skip existing rows.
import { createHash } from "node:crypto";
import { isRealDate, MONTH_RE, shiftMonth } from "../shared/dates";
import { computeShares } from "../shared/split";
import type { Db, Queryable } from "../server/db";
import { spaceBalances } from "../server/ledger";

interface LegacyUser { name?: string; email?: string; createdAt?: number }
interface LegacyMember { name?: string; claimedBy?: string | null }
interface LegacyExpense {
  date?: string; name?: string; paise?: number; payer?: string; people?: Record<string, boolean>;
  remarks?: string; createdAt?: number; createdBy?: string; updatedAt?: number; updatedBy?: string;
}
interface Ledger {
  users?: Record<string, LegacyUser>;
  members?: Record<string, LegacyMember>;
  expenses?: Record<string, LegacyExpense>;
  settled?: Record<string, Record<string, boolean>>;
  groups?: Record<string, LegacyGroup>;
}
interface LegacyGroup { name?: string; members?: Record<string, boolean>; createdBy?: string }

export interface ImportOptions {
  spaceName: string;
  /** Email of the account that will own the space; defaults to the earliest user. */
  ownerEmail?: string;
  dryRun?: boolean;
}

export interface ImportReport {
  spaceId: string;
  users: number;
  placeholders: number;
  expenses: { imported: number; alreadyThere: number };
  payments: { imported: number; alreadyThere: number };
  skipped: string[];
  groups: number;
  balances: { name: string; netPaise: number }[];
}

// Fixed namespace so the same Firebase key always maps to the same UUID (RFC 4122 v5).
const NAMESPACE = Buffer.from("6f1c2d3e4a5b46c7889900aabbccddee", "hex");
export function uuidV5(name: string): string {
  const h = createHash("sha1").update(NAMESPACE).update(name).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

class DryRun extends Error {
  constructor(readonly report: ImportReport) {
    super("dry run");
  }
}

/** Accepts an export of the whole database ({ ledger: … }) or of the ledger node itself. */
export function readLedger(json: unknown): Ledger {
  if (!json || typeof json !== "object") throw new Error("The export is not a JSON object.");
  const root = json as Record<string, unknown>;
  const ledger = (root.ledger ?? root) as Ledger;
  if (!ledger.expenses && !ledger.users) throw new Error("No `users` or `expenses` found. Export the `ledger` node (or the whole database).");
  return ledger;
}

const lastDayOfMonth = (ym: string) => {
  const d = new Date(`${shiftMonth(ym, 1)}-01T00:00:00Z`);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
};

export async function importLedger(db: Db, ledger: Ledger, opts: ImportOptions): Promise<ImportReport> {
  try {
    return await db.transaction(async (tx) => {
      const report = await run(tx, ledger, opts);
      if (opts.dryRun) throw new DryRun(report);
      return report;
    });
  } catch (err) {
    if (err instanceof DryRun) return err.report;
    throw err;
  }
}

async function run(tx: Queryable, ledger: Ledger, opts: ImportOptions): Promise<ImportReport> {
  const skipped: string[] = [];
  const idFor = new Map<string, string>(); // old Firebase id → users.id
  const names = new Map<string, string>();

  // 1. Accounts. Firebase uids stay the same (sign-in is still Firebase), so these rows are
  //    recognised the moment each person signs in to the new app.
  const users = Object.entries(ledger.users ?? {}).sort(([, a], [, b]) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  for (const [uid, u] of users) {
    const email = u.email?.trim().toLowerCase() || null;
    const name = (u.name?.trim() || email?.split("@")[0] || "Member").slice(0, 40);
    const existing = await tx.query<{ id: string }>(
      "SELECT id FROM users WHERE auth_uid = $1 OR ($2::text IS NOT NULL AND email = $2) ORDER BY (auth_uid IS NOT DISTINCT FROM $1) DESC LIMIT 1",
      [uid, email],
    );
    let id = existing.rows[0]?.id;
    if (id) {
      await tx.query("UPDATE users SET auth_uid = COALESCE(auth_uid, $2) WHERE id = $1", [id, uid]);
    } else {
      id = uuidV5(`user:${uid}`);
      await tx.query("INSERT INTO users (id, auth_uid, email, name) VALUES ($1, $2, $3, $4)", [id, uid, email, name]);
    }
    idFor.set(uid, id);
    names.set(id, name);
  }

  // 2. Names from the old fixed member list. Claimed ones are the account that claimed them.
  let placeholders = 0;
  const placeholder = async (oldId: string, name: string) => {
    const id = uuidV5(`member:${oldId}`);
    const inserted = await tx.query("INSERT INTO users (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING id", [id, name.slice(0, 40)]);
    if (inserted.rows.length) placeholders++;
    idFor.set(oldId, id);
    names.set(id, name);
    return id;
  };
  for (const [oldId, m] of Object.entries(ledger.members ?? {})) {
    const claimed = m.claimedBy ? idFor.get(m.claimedBy) : undefined;
    if (claimed) idFor.set(oldId, claimed);
    else await placeholder(oldId, m.name?.trim() || "Former member");
  }
  const resolve = async (oldId: string | undefined) => (oldId ? (idFor.get(oldId) ?? (await placeholder(oldId, "Former member"))) : undefined);

  // 3. One recurring space holding everything: the old app was a single ledger settled monthly.
  const ownerEntry = opts.ownerEmail
    ? users.find(([, u]) => u.email?.trim().toLowerCase() === opts.ownerEmail!.trim().toLowerCase())
    : users[0];
  if (opts.ownerEmail && !ownerEntry) throw new Error(`No user with email ${opts.ownerEmail} in the export.`);
  const ownerId = ownerEntry ? idFor.get(ownerEntry[0]) : undefined;
  if (!ownerId) throw new Error("No user accounts in the export, so there is nobody to own the space.");
  const spaceId = uuidV5("space:legacy-ledger");
  await tx.query(
    "INSERT INTO spaces (id, name, kind, created_by) VALUES ($1, $2, 'recurring', $3) ON CONFLICT (id) DO NOTHING",
    [spaceId, opts.spaceName, ownerId],
  );
  const members = new Set<string>(users.map(([uid]) => idFor.get(uid)!));

  // 4. Expenses, split equally as the old app did.
  const expenses = { imported: 0, alreadyThere: 0 };
  for (const [key, e] of Object.entries(ledger.expenses ?? {})) {
    const label = `expense ${key} (${e.name ?? "no name"})`;
    if (!e.date || !isRealDate(e.date)) { skipped.push(`${label}: bad date ${e.date}`); continue; }
    if (!Number.isSafeInteger(e.paise) || (e.paise ?? 0) <= 0 || (e.paise ?? 0) > 10_000_000_000) { skipped.push(`${label}: bad amount ${e.paise}`); continue; }
    const payer = await resolve(e.payer);
    if (!payer) { skipped.push(`${label}: no payer`); continue; }
    const people = new Set<string>();
    for (const [pid, on] of Object.entries(e.people ?? {})) if (on) people.add((await resolve(pid))!);
    if (!people.size) { skipped.push(`${label}: nobody to split between`); continue; }
    const id = uuidV5(`expense:${key}`);
    const createdBy = (await resolve(e.createdBy)) ?? payer;
    const updatedBy = (await resolve(e.updatedBy)) ?? createdBy;
    const inserted = await tx.query(
      `INSERT INTO expenses (id, space_id, description, amount_paise, payer_id, split_type, spent_on, remarks, created_by, updated_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'equal', $6, $7, $8, $9, to_timestamp($10 / 1000.0), to_timestamp($11 / 1000.0))
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [id, spaceId, (e.name?.trim() || "Expense").slice(0, 100), e.paise, payer, e.date, (e.remarks ?? "").slice(0, 500), createdBy, updatedBy,
        e.createdAt ?? Date.now(), e.updatedAt ?? e.createdAt ?? Date.now()],
    );
    members.add(payer);
    people.forEach((p) => members.add(p));
    if (!inserted.rows.length) { expenses.alreadyThere++; continue; }
    for (const s of computeShares(e.paise!, "equal", [...people].map((userId) => ({ userId })), id)) {
      await tx.query("INSERT INTO expense_shares (expense_id, user_id, share_paise) VALUES ($1, $2, $3)", [id, s.userId, s.sharePaise]);
    }
    expenses.imported++;
  }

  // 5. "Paid" ticks were money that actually moved: a payment settling that month, dated its last day.
  const payments = { imported: 0, alreadyThere: 0 };
  for (const [month, ticks] of Object.entries(ledger.settled ?? {})) {
    if (!MONTH_RE.test(month)) { skipped.push(`paid ticks under "${month}": not a month`); continue; }
    for (const [key, on] of Object.entries(ticks ?? {})) {
      if (!on) continue;
      const parts = key.split("_");
      const paise = Number(parts[2]);
      if (parts.length !== 3 || !Number.isSafeInteger(paise) || paise <= 0) { skipped.push(`paid tick ${month}/${key}: unreadable`); continue; }
      const from = (await resolve(parts[0]))!;
      const to = (await resolve(parts[1]))!;
      if (from === to) { skipped.push(`paid tick ${month}/${key}: same person on both sides after merging names`); continue; }
      const inserted = await tx.query(
        `INSERT INTO settlements (id, space_id, from_user_id, to_user_id, amount_paise, paid_on, period, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'Marked paid in the old app', $8) ON CONFLICT (id) DO NOTHING RETURNING id`,
        [uuidV5(`settled:${month}:${key}`), spaceId, from, to, paise, lastDayOfMonth(month), `${month}-01`, ownerId],
      );
      members.add(from);
      members.add(to);
      if (inserted.rows.length) payments.imported++;
      else payments.alreadyThere++;
    }
  }

  for (const userId of members) {
    await tx.query(
      "INSERT INTO space_members (space_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (space_id, user_id) DO NOTHING",
      [spaceId, userId, userId === ownerId ? "owner" : "member"],
    );
  }

  // 6. Optional old quick-pick lists belong to the imported space, never to a global group list.
  let groups = 0;
  for (const [key, g] of Object.entries(ledger.groups ?? {})) {
    const people = new Set<string>();
    for (const [pid, on] of Object.entries(g.members ?? {})) if (on) people.add((await resolve(pid))!);
    const maker = (g.createdBy && idFor.get(g.createdBy)) || ownerId;
    if (!people.size) continue;
    const id = uuidV5(`group:${key}`);
    const inserted = await tx.query(
      "INSERT INTO groups (id, space_id, name, created_by) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING RETURNING id",
      [id, spaceId, (g.name?.trim() || "Group").slice(0, 60), maker],
    );
    if (!inserted.rows.length) continue;
    for (const userId of people) {
      await tx.query("INSERT INTO space_members (space_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [spaceId, userId]);
      await tx.query("INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)", [id, userId]);
    }
    groups++;
  }

  const b = await spaceBalances(tx, spaceId, true);
  return {
    spaceId,
    users: users.length,
    placeholders,
    expenses,
    payments,
    skipped,
    groups,
    balances: b.members
      .filter((m) => m.netPaise !== 0)
      .map((m) => ({ name: names.get(m.userId) ?? m.userId, netPaise: m.netPaise }))
      .sort((x, y) => y.netPaise - x.netPaise),
  };
}
