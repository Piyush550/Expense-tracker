// People lists and shortcuts belonging to one space.
import type { Group, Person, SpaceQuickActions } from "../shared/api";
import { iso, type Queryable } from "./db";
import { activeMemberIds, requireMember } from "./access";
import { HttpError, notFound } from "./errors";

/** Scoped groups are visible to every active space member, including nonparticipants. */
export async function listSpaceGroups(q: Queryable, spaceId: string, userId: string): Promise<Group[]> {
  const { role } = await requireMember(q, spaceId, userId);
  const { rows } = await q.query<{ id: string; name: string; created_by: string; created_at: unknown; members: Person[] | string }>(
    `SELECT g.id, g.name, g.created_by,
       to_char(g.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
       COALESCE((SELECT json_agg(json_build_object('id', u.id, 'name', u.name, 'email', NULL,
                                                  'registered', u.auth_uid IS NOT NULL) ORDER BY lower(u.name), u.id)
                   FROM group_members gm JOIN users u ON u.id = gm.user_id
                   JOIN space_members sm ON sm.user_id = gm.user_id AND sm.space_id = g.space_id AND sm.left_at IS NULL
                  WHERE gm.group_id = g.id), '[]'::json) AS members
     FROM groups g WHERE g.space_id = $1 ORDER BY lower(g.name), g.id`, [spaceId],
  );
  return rows.map((r) => ({ id: r.id, spaceId, name: r.name, createdBy: r.created_by,
    createdAt: iso(r.created_at), canEdit: role === "owner", members: typeof r.members === "string" ? JSON.parse(r.members) : r.members }));
}

export async function findSpaceGroup(q: Queryable, spaceId: string, groupId: string, userId: string): Promise<Group> {
  const group = (await listSpaceGroups(q, spaceId, userId)).find((g) => g.id === groupId);
  if (!group) throw notFound("That group in this space");
  return group;
}

export async function setSpaceGroupMembers(tx: Queryable, spaceId: string, groupId: string, userIds: string[]) {
  const ids = [...new Set(userIds)];
  const active = await activeMemberIds(tx, spaceId);
  if (!ids.length || ids.some((id) => !active.has(id))) {
    throw new HttpError(422, "group_members", "Choose at least one current member of this space.");
  }
  await tx.query("DELETE FROM group_members WHERE group_id = $1", [groupId]);
  await tx.query("INSERT INTO group_members (group_id, user_id) SELECT $1, unnest($2::uuid[])", [groupId, ids]);
}

export async function createSpaceGroup(tx: Queryable, spaceId: string, userId: string, input: { id?: string; name: string; memberIds: string[] }) {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO groups (id, space_id, name, created_by, created_at)
     VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, clock_timestamp()) RETURNING id`,
    [input.id ?? null, spaceId, input.name, userId],
  );
  await setSpaceGroupMembers(tx, spaceId, rows[0]!.id, input.memberIds);
  return rows[0]!.id;
}

export async function loadQuickActions(q: Queryable, spaceId: string): Promise<SpaceQuickActions> {
  const { rows } = await q.query<{ group_id: string }>("SELECT group_id FROM space_group_shortcuts WHERE space_id = $1 ORDER BY position", [spaceId]);
  return rows.length ? { mode: "custom", groupIds: rows.map((r) => r.group_id) } : { mode: "automatic" };
}

/** Caller holds the space lock, serializing this with group and membership edits. */
export async function saveQuickActions(tx: Queryable, spaceId: string, config: SpaceQuickActions) {
  const ids = config.mode === "custom" ? config.groupIds : [];
  if (ids.length) {
    const found = await tx.query("SELECT id FROM groups WHERE space_id = $1 AND id = ANY($2::uuid[])", [spaceId, ids]);
    if (found.rows.length !== ids.length) throw new HttpError(422, "shortcut_groups", "Choose groups from this space only.");
  }
  await tx.query("DELETE FROM space_group_shortcuts WHERE space_id = $1", [spaceId]);
  for (const [position, groupId] of ids.entries()) {
    await tx.query("INSERT INTO space_group_shortcuts (space_id, position, group_id) VALUES ($1, $2, $3)", [spaceId, position, groupId]);
  }
}
