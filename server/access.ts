// Authorization. Every space-scoped query goes through requireMember first, and a space the
// caller is not in is reported as "not found" so its existence is not revealed.
import type { Role } from "../shared/api";
import type { Queryable } from "./db";
import { forbidden, notFound } from "./errors";
import { id as uuidSchema } from "./schemas";

export function assertUuid(value: string, what: string): string {
  if (!uuidSchema.safeParse(value).success) throw notFound(what);
  return value;
}

export async function requireMember(q: Queryable, spaceId: string, userId: string): Promise<{ role: Role }> {
  assertUuid(spaceId, "That space");
  const { rows } = await q.query<{ role: Role }>(
    "SELECT role FROM space_members WHERE space_id = $1 AND user_id = $2 AND left_at IS NULL",
    [spaceId, userId],
  );
  if (!rows[0]) throw notFound("That space");
  return rows[0];
}

export async function requireOwner(q: Queryable, spaceId: string, userId: string) {
  const { role } = await requireMember(q, spaceId, userId);
  if (role !== "owner") throw forbidden("owner_only", "Only a space owner can do that.");
}

/** Active members, i.e. people who can be put on a new expense or payment. */
export async function activeMemberIds(q: Queryable, spaceId: string): Promise<Set<string>> {
  const { rows } = await q.query<{ user_id: string }>(
    "SELECT user_id FROM space_members WHERE space_id = $1 AND left_at IS NULL",
    [spaceId],
  );
  return new Set(rows.map((r) => r.user_id));
}
