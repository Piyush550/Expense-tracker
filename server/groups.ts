import type { GroupDetail, GroupSummary, Member, Role } from "../shared/api";
import { num, type Queryable } from "./db";
import { conflict, notFound } from "./errors";

export async function listGroups(q: Queryable, userId: string): Promise<GroupSummary[]> {
  const { rows } = await q.query<{ id: string; name: string; member_count: unknown; balance: unknown }>(
    `WITH mine AS (SELECT group_id FROM group_members WHERE user_id = $1 AND left_at IS NULL),
     paid AS (SELECT group_id, SUM(amount_paise) AS v FROM expenses
               WHERE payer_id = $1 AND deleted_at IS NULL AND group_id IN (SELECT group_id FROM mine) GROUP BY group_id),
     owed AS (SELECT e.group_id, SUM(s.share_paise) AS v FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
               WHERE s.user_id = $1 AND e.deleted_at IS NULL AND e.group_id IN (SELECT group_id FROM mine) GROUP BY e.group_id),
     sent AS (SELECT group_id, SUM(amount_paise) AS v FROM settlements
               WHERE from_user_id = $1 AND deleted_at IS NULL AND group_id IN (SELECT group_id FROM mine) GROUP BY group_id),
     recv AS (SELECT group_id, SUM(amount_paise) AS v FROM settlements
               WHERE to_user_id = $1 AND deleted_at IS NULL AND group_id IN (SELECT group_id FROM mine) GROUP BY group_id)
     SELECT g.id, g.name,
            (SELECT COUNT(*) FROM group_members x WHERE x.group_id = g.id AND x.left_at IS NULL) AS member_count,
            COALESCE(paid.v, 0) - COALESCE(owed.v, 0) + COALESCE(sent.v, 0) - COALESCE(recv.v, 0) AS balance
       FROM mine JOIN groups g ON g.id = mine.group_id
       LEFT JOIN paid ON paid.group_id = g.id LEFT JOIN owed ON owed.group_id = g.id
       LEFT JOIN sent ON sent.group_id = g.id LEFT JOIN recv ON recv.group_id = g.id
      ORDER BY lower(g.name), g.id`,
    [userId],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, memberCount: num(r.member_count), myBalancePaise: num(r.balance) }));
}

export async function loadGroup(q: Queryable, groupId: string, myRole: Role): Promise<GroupDetail> {
  const [group, members, months] = await Promise.all([
    q.query<{ id: string; name: string; simplify_debts: boolean }>(
      "SELECT id, name, simplify_debts FROM groups WHERE id = $1",
      [groupId],
    ),
    q.query<{ id: string; name: string; email: string | null; auth_uid: string | null; role: Role; left_at: unknown }>(
      `SELECT u.id, u.name, u.email, u.auth_uid, m.role, m.left_at
         FROM group_members m JOIN users u ON u.id = m.user_id
        WHERE m.group_id = $1
        ORDER BY (m.left_at IS NOT NULL), lower(u.name), u.id`,
      [groupId],
    ),
    q.query<{ m: string }>(
      `SELECT DISTINCT to_char(d, 'YYYY-MM') AS m FROM (
         SELECT spent_on AS d FROM expenses WHERE group_id = $1 AND deleted_at IS NULL
         UNION ALL SELECT paid_on FROM settlements WHERE group_id = $1 AND deleted_at IS NULL
       ) x ORDER BY m DESC`,
      [groupId],
    ),
  ]);
  const g = group.rows[0];
  if (!g) throw notFound("That group");
  return {
    id: g.id,
    name: g.name,
    simplifyDebts: g.simplify_debts,
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

/**
 * Adds a person by email: their account if they have one, otherwise a placeholder that
 * becomes theirs when they first sign in with that email. Returns false if already a member.
 */
export async function addMemberByEmail(tx: Queryable, groupId: string, email: string, name?: string): Promise<boolean> {
  const found = await tx.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
  let userId = found.rows[0]?.id;
  if (!userId) {
    const fallback = (email.split("@")[0] || "Member").slice(0, 40);
    const created = await tx.query<{ id: string }>(
      "INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id",
      [email, name ?? fallback],
    );
    userId = created.rows[0]!.id;
  }
  const { rows } = await tx.query(
    `INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)
     ON CONFLICT (group_id, user_id) DO UPDATE SET left_at = NULL, joined_at = now()
       WHERE group_members.left_at IS NOT NULL
     RETURNING user_id`,
    [groupId, userId],
  );
  return rows.length > 0;
}

export async function ensureGroupKeepsOwner(q: Queryable, groupId: string, leavingUserId: string) {
  const { rows } = await q.query<{ owners: unknown; others: unknown }>(
    `SELECT COUNT(*) FILTER (WHERE role = 'owner' AND user_id <> $2) AS owners,
            COUNT(*) FILTER (WHERE user_id <> $2) AS others
       FROM group_members WHERE group_id = $1 AND left_at IS NULL`,
    [groupId, leavingUserId],
  );
  const { owners, others } = rows[0]!;
  if (num(others) === 0) throw conflict("last_member", "You are the only member left. Delete the group instead.");
  if (num(owners) === 0) throw conflict("last_owner", "Make someone else an owner first.");
}
