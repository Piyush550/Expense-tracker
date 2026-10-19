// Groups: reusable lists of people that work in every space.
import type { Group, Person } from "../shared/api";
import type { Queryable } from "./db";
import { forbidden, notFound } from "./errors";
import { requireContacts, userIdForEmail } from "./people";

export async function listGroups(q: Queryable, userId: string, onlyId?: string): Promise<Group[]> {
  const { rows } = await q.query<{ id: string; name: string; created_by: string; members: Person[] | string }>(
    `SELECT g.id, g.name, g.created_by,
            COALESCE((SELECT json_agg(json_build_object('id', u.id, 'name', u.name, 'email', u.email,
                                                        'registered', u.auth_uid IS NOT NULL) ORDER BY lower(u.name), u.id)
                        FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = g.id), '[]'::json) AS members
       FROM groups g
      WHERE (g.created_by = $1 OR EXISTS (SELECT 1 FROM group_members x WHERE x.group_id = g.id AND x.user_id = $1))
        AND ($2::uuid IS NULL OR g.id = $2)
      ORDER BY lower(g.name), g.id`,
    [userId, onlyId ?? null],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdBy: r.created_by,
    canEdit: r.created_by === userId,
    members: typeof r.members === "string" ? JSON.parse(r.members) : r.members,
  }));
}

/** The group, if the caller can see it. */
export async function findGroup(q: Queryable, groupId: string, userId: string): Promise<Group> {
  const [group] = await listGroups(q, userId, groupId);
  if (!group) throw notFound("That group");
  return group;
}

export async function requireGroupOwner(q: Queryable, groupId: string, userId: string): Promise<Group> {
  const group = await findGroup(q, groupId, userId);
  if (!group.canEdit) throw forbidden("group_owner_only", "Only the person who made this group can change it.");
  return group;
}

/** Replaces the group's people. The maker always stays in it; ids must be the maker's contacts. */
export async function setGroupMembers(tx: Queryable, groupId: string, makerId: string, emails: string[], userIds: string[] = []) {
  await requireContacts(tx, makerId, userIds);
  const ids = new Set([makerId, ...userIds]);
  for (const email of emails) ids.add(await userIdForEmail(tx, email));
  await tx.query("DELETE FROM group_members WHERE group_id = $1", [groupId]);
  const list = [...ids];
  await tx.query(
    `INSERT INTO group_members (group_id, user_id) VALUES ${list.map((_, i) => `($1, $${i + 2})`).join(", ")}`,
    [groupId, ...list],
  );
}
