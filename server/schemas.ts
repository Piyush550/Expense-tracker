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

export const updateMe = z.strictObject({ name: trimmed(1, 40) });

export const createSpace = z.strictObject({
  name: trimmed(1, 60),
  kind: kind.default("recurring"),
  memberEmails: emails,
  memberIds: ids,
  groupIds: z.array(id).max(20).default([]),
});

export const updateSpace = z
  .strictObject({ name: trimmed(1, 60).optional(), kind: kind.optional(), simplifyDebts: z.boolean().optional() })
  .refine((v) => v.name !== undefined || v.kind !== undefined || v.simplifyDebts !== undefined, "Nothing to update.");

/** Add someone you already know (userId), a new person by email, or everyone in one of your groups. */
export const addMembers = z.union([
  z.strictObject({ userId: id }),
  z.strictObject({ email, name: trimmed(1, 40).optional() }),
  z.strictObject({ groupId: id }),
]);

export const updateMember = z.strictObject({ role: z.enum(["owner", "member"]) });

export const mergeMember = z.strictObject({ intoUserId: id });

export const createGroup = z.strictObject({ name: trimmed(1, 60), memberEmails: emails, memberIds: ids });
/** Sending memberEmails and/or memberIds replaces the group's people with exactly those. */
export const updateGroup = z
  .strictObject({
    name: trimmed(1, 60).optional(),
    memberEmails: z.array(email).max(50).optional(),
    memberIds: z.array(id).max(50).optional(),
  })
  .refine((v) => v.name !== undefined || v.memberEmails !== undefined || v.memberIds !== undefined, "Nothing to update.");

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
