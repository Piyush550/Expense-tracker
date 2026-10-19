import type { Member, Role, SpaceDetail, SpaceKind, SpaceSummary } from "../shared/api";
import { num, type Queryable } from "./db";
import { conflict, notFound } from "./errors";
import { userIdForEmail } from "./people";

export async function listSpaces(q: Queryable, userId: string): Promise<SpaceSummary[]> {
  const { rows } = await q.query<{ id: string; name: string; kind: SpaceKind; role: Role; member_count: unknown; balance: unknown }>(
    `WITH mine AS (SELECT space_id, role FROM space_members WHERE user_id = $1 AND left_at IS NULL),
     paid AS (SELECT space_id, SUM(amount_paise) AS v FROM expenses
               WHERE payer_id = $1 AND deleted_at IS NULL AND space_id IN (SELECT space_id FROM mine) GROUP BY space_id),
     owed AS (SELECT e.space_id, SUM(s.share_paise) AS v FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
               WHERE s.user_id = $1 AND e.deleted_at IS NULL AND e.space_id IN (SELECT space_id FROM mine) GROUP BY e.space_id),
     sent AS (SELECT space_id, SUM(amount_paise) AS v FROM settlements
               WHERE from_user_id = $1 AND deleted_at IS NULL AND space_id IN (SELECT space_id FROM mine) GROUP BY space_id),
     recv AS (SELECT space_id, SUM(amount_paise) AS v FROM settlements
               WHERE to_user_id = $1 AND deleted_at IS NULL AND space_id IN (SELECT space_id FROM mine) GROUP BY space_id)
     SELECT s.id, s.name, s.kind, mine.role,
            (SELECT COUNT(*) FROM space_members x WHERE x.space_id = s.id AND x.left_at IS NULL) AS member_count,
            COALESCE(paid.v, 0) - COALESCE(owed.v, 0) + COALESCE(sent.v, 0) - COALESCE(recv.v, 0) AS balance
       FROM mine JOIN spaces s ON s.id = mine.space_id
       LEFT JOIN paid ON paid.space_id = s.id LEFT JOIN owed ON owed.space_id = s.id
       LEFT JOIN sent ON sent.space_id = s.id LEFT JOIN recv ON recv.space_id = s.id
      ORDER BY lower(s.name), s.id`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    myRole: r.role,
    memberCount: num(r.member_count),
    myBalancePaise: num(r.balance),
  }));
}

export async function loadSpace(q: Queryable, spaceId: string, myRole: Role): Promise<SpaceDetail> {
  const [space, members, months] = await Promise.all([
    q.query<{ id: string; name: string; kind: SpaceKind; simplify_debts: boolean }>(
      "SELECT id, name, kind, simplify_debts FROM spaces WHERE id = $1",
      [spaceId],
    ),
    q.query<{ id: string; name: string; email: string | null; auth_uid: string | null; role: Role; left_at: unknown }>(
      `SELECT u.id, u.name, u.email, u.auth_uid, m.role, m.left_at
         FROM space_members m JOIN users u ON u.id = m.user_id
        WHERE m.space_id = $1
        ORDER BY (m.left_at IS NOT NULL), lower(u.name), u.id`,
      [spaceId],
    ),
    q.query<{ m: string }>(
      `SELECT DISTINCT to_char(d, 'YYYY-MM') AS m FROM (
         SELECT spent_on AS d FROM expenses WHERE space_id = $1 AND deleted_at IS NULL
         UNION ALL SELECT period FROM settlements WHERE space_id = $1 AND deleted_at IS NULL
       ) x ORDER BY m DESC`,
      [spaceId],
    ),
  ]);
  const s = space.rows[0];
  if (!s) throw notFound("That space");
  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    simplifyDebts: s.simplify_debts,
    myRole,
    members: members.rows.map(
      (m): Member => ({
        id: m.id,
        name: m.name,
        email: m.email,
        registered: m.auth_uid !== null,
        role: m.role,
        active: m.left_at === null,
      }),
    ),
    months: months.rows.map((r) => r.m),
  };
}

/** Adds (or re-adds) a person to a space. Returns false if they are already an active member. */
export async function addToSpace(tx: Queryable, spaceId: string, userId: string): Promise<boolean> {
  const { rows } = await tx.query(
    `INSERT INTO space_members (space_id, user_id) VALUES ($1, $2)
     ON CONFLICT (space_id, user_id) DO UPDATE SET left_at = NULL, joined_at = now()
       WHERE space_members.left_at IS NOT NULL
     RETURNING user_id`,
    [spaceId, userId],
  );
  return rows.length > 0;
}

export async function addEmailToSpace(tx: Queryable, spaceId: string, email: string, name?: string): Promise<boolean> {
  return addToSpace(tx, spaceId, await userIdForEmail(tx, email, name));
}

/** Throws unless the space still has an owner and another member after `leavingUserId` goes. */
export async function ensureSpaceKeepsOwner(q: Queryable, spaceId: string, leavingUserId: string) {
  const { rows } = await q.query<{ owners: unknown; others: unknown }>(
    `SELECT COUNT(*) FILTER (WHERE role = 'owner' AND user_id <> $2) AS owners,
            COUNT(*) FILTER (WHERE user_id <> $2) AS others
       FROM space_members WHERE space_id = $1 AND left_at IS NULL`,
    [spaceId, leavingUserId],
  );
  const { owners, others } = rows[0]!;
  if (num(others) === 0) throw conflict("last_member", "You are the only member left. Delete the space instead.");
  if (num(owners) === 0) throw conflict("last_owner", "Make someone else an owner first.");
}
