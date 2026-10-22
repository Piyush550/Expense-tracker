// Request validation. Everything from the client is untrusted.
import { z } from "zod";
import { MAX_AMOUNT_PAISE } from "../shared/money";
import { isRealDate, MONTH_RE } from "../shared/dates";

export const id = z.uuid();
const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);
const paise = z.number().int().positive().max(MAX_AMOUNT_PAISE);
const date = z.string().refine(isRealDate, "Use a real date in YYYY-MM-DD form.");
const month = z.string().regex(MONTH_RE, "Use a month in YYYY-MM form.");
const kind = z.enum(["recurring", "one_time"]);

export const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const emails = z.array(email).max(50).default([]);
const ids = z.array(id).max(50).default([]);
const invitation = z.strictObject({ name: trimmed(1, 40), email });
const invites = z.array(invitation).max(50).default([]);

export const updateMe = z.strictObject({ name: trimmed(1, 40) });

export const spaceGroup = z.strictObject({ name: trimmed(1, 60), memberIds: z.array(id).min(1).max(100) });
export const updateSpaceGroup = z.strictObject({ name: trimmed(1, 60).optional(), memberIds: z.array(id).min(1).max(100).optional() })
  .refine((v) => v.name !== undefined || v.memberIds !== undefined, "Nothing to update.");
export const quickActions = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("automatic") }),
  z.strictObject({ mode: z.literal("custom"), groupIds: z.array(id).min(1).max(3).refine((ids) => new Set(ids).size === ids.length, "Choose distinct groups.") }),
]);

export const createSpace = z.strictObject({
  id: id.optional(), // Optional client id makes MCP retries safe; existing app clients may omit it.
  name: trimmed(1, 60),
  kind: kind.default("recurring"),
  memberEmails: emails,
  memberIds: ids,
  directoryIds: ids,
  memberInvites: invites,
  initialGroups: z.array(spaceGroup.extend({ id })).max(20).default([]),
  quickGroupIds: z.array(id).max(3).default([]),
}).refine((v) => new Set(v.initialGroups.map((g) => g.id)).size === v.initialGroups.length, "Each group needs its own id.")
  .refine((v) => new Set(v.quickGroupIds).size === v.quickGroupIds.length && v.quickGroupIds.every((id) => v.initialGroups.some((g) => g.id === id)), "Choose shortcuts from the new space's groups.");

export const updateSpace = z
  .strictObject({ name: trimmed(1, 60).optional(), kind: kind.optional(), simplifyDebts: z.boolean().optional() })
  .refine((v) => v.name !== undefined || v.kind !== undefined || v.simplifyDebts !== undefined, "Nothing to update.");

/** Add someone you already know (userId), a new person by email, or a registered directory entry. */
export const addMembers = z.union([
  z.strictObject({ memberIds: ids, directoryIds: ids, memberInvites: invites })
    .refine((v) => v.memberIds.length + v.directoryIds.length + v.memberInvites.length > 0, "Choose at least one person."),
  z.strictObject({ directoryUserId: id }),
  z.strictObject({ userId: id }),
  z.strictObject({ email, name: trimmed(1, 40).optional() }),
]);

export const updateMember = z.strictObject({ role: z.enum(["owner", "member"]) });

export const mergeMember = z.strictObject({ intoUserId: id });

const expenseFields = {
  description: trimmed(1, 100),
  amountPaise: paise,
  payerId: id,
  splitType: z.enum(["equal", "exact", "percent", "shares"]),
  spentOn: date,
  remarks: z.string().trim().max(500).default(""),
  splits: z
    .array(z.strictObject({ userId: id, value: z.number().int().min(0).max(MAX_AMOUNT_PAISE).nullish() }))
    .min(1)
    .max(100),
};

export const createExpense = z.strictObject({ id, ...expenseFields });
export type CreateExpense = z.output<typeof createExpense>;

export const bulkExpenses = z
  .strictObject({ expenses: z.array(createExpense).min(1).max(50) })
  .refine((v) => new Set(v.expenses.map((e) => e.id)).size === v.expenses.length, "Each row needs its own id.");
export const updateExpense = z.strictObject({ version: z.number().int().positive(), ...expenseFields });

export const createSettlement = z
  .strictObject({
    id,
    fromUserId: id,
    toUserId: id,
    amountPaise: paise,
    paidOn: date,
    period: month.optional(),
    note: z.string().trim().max(200).default(""),
  })
  .refine((v) => v.fromUserId !== v.toUserId, "Someone cannot pay themselves.");

export const listQuery = z.object({ month: month.optional() });
export const directoryPageQuery = z.object({
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const pageFields = {
  month: month.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
};
/** Filters and paging for one page of expenses; every filter runs in the database. */
export const expensePageQuery = z.object({ ...pageFields, payer: id.optional(), involving: id.optional(), q: z.string().trim().max(100).optional() });
export const settlementPageQuery = z.object({ ...pageFields, person: id.optional() });

// ── Personal tokens and the phone shortcut ─────────────────────────────────────────────
const lifetimeDays = z.number().int().min(1).max(3650).nullable();

export const createToken = z.strictObject({ name: trimmed(1, 40), lifetimeDays: lifetimeDays.default(365) });

export const updateToken = z
  .strictObject({ name: trimmed(1, 40).optional(), lifetimeDays: lifetimeDays.optional() })
  .refine((v) => v.name !== undefined || v.lifetimeDays !== undefined, "Nothing to update.");

export const quickExpense = z.strictObject({
  // May arrive empty when the shortcut's list step got nothing; the route answers that with
  // a message pointing at the step to fix, rather than a bare validation error.
  preset: z.string().trim().max(200).default(""),
  amount: z.union([z.number(), z.string().trim().max(20)]),
  title: z.string().trim().max(100).optional(),
  date: z.string().trim().max(40).optional(),
  requestId: id.optional(),
  /** Names picked in "Who shared it?": a list, or text with one name per line. Empty = the preset's people. */
  people: z.union([z.array(z.string().trim().max(80)).max(100), z.string().max(4000)]).optional(),
});

export const quickPeople = z.strictObject({ preset: z.string().trim().max(200).default("") });
