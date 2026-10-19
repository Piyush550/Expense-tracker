// Authorization. Every group-scoped query goes through requireMember first, and a group the
// caller is not in is reported as "not found" so its existence is not revealed.
import type { Role } from "../shared/api";
import type { Queryable } from "./db";
import { forbidden, notFound } from "./errors";
import { id as uuidSchema } from "./schemas";

export function assertUuid(value: string, what: string): string {
  if (!uuidSchema.safeParse(value).success) throw notFound(what);
  return value;
}

export async function requireMember(q: Queryable, groupId: string, userId: string): Promise<{ role: Role }> {
  assertUuid(groupId, "That group");
  const { rows } = await q.query<{ role: Role }>(
    "SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2 AND left_at IS NULL",
    [groupId, userId],
  );
  if (!rows[0]) throw notFound("That group");
  return rows[0];
}

export async function requireOwner(q: Queryable, groupId: string, userId: string) {
  const { role } = await requireMember(q, groupId, userId);
  if (role !== "owner") throw forbidden("owner_only", "Only a group owner can do that.");
}

/** Active members, i.e. people who can be put on a new expense or payment. */
export async function activeMemberIds(q: Queryable, groupId: string): Promise<Set<string>> {
  const { rows } = await q.query<{ user_id: string }>(
    "SELECT user_id FROM group_members WHERE group_id = $1 AND left_at IS NULL",
    [groupId],
  );
  return new Set(rows.map((r) => r.user_id));
}
