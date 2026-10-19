// People: finding them by email, and the people you already know (share a space or a group
// with), whom you can add anywhere without typing an email.
import type { Person } from "../shared/api";
import type { Queryable } from "./db";
import { notFound } from "./errors";

export async function userIdForEmail(tx: Queryable, email: string, name?: string): Promise<string> {
  const found = await tx.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
  if (found.rows[0]) return found.rows[0].id;
  const fallback = (email.split("@")[0] || "Member").slice(0, 40);
  const created = await tx.query<{ id: string }>(
    // Two requests inviting the same new email at once: the loser re-reads the winner's row.
    `INSERT INTO users (email, name) VALUES ($1, $2)
     ON CONFLICT (email) WHERE email IS NOT NULL DO UPDATE SET email = EXCLUDED.email
     RETURNING id`,
    [email, name ?? fallback],
  );
  return created.rows[0]!.id;
}

/**
 * Everyone who shares a space (current or past) or a group with `userId`, excluding them.
 * This is also the limit on who they may add by id: nobody can add a stranger by guessing ids.
 */
export async function listContacts(q: Queryable, userId: string, onlyIds?: string[]): Promise<Person[]> {
  const { rows } = await q.query<{ id: string; name: string; email: string | null; registered: boolean }>(
    `WITH known AS (
       SELECT m2.user_id FROM space_members m1 JOIN space_members m2 ON m2.space_id = m1.space_id WHERE m1.user_id = $1
       UNION SELECT g2.user_id FROM group_members g1 JOIN group_members g2 ON g2.group_id = g1.group_id WHERE g1.user_id = $1
       UNION SELECT gm.user_id FROM groups g JOIN group_members gm ON gm.group_id = g.id WHERE g.created_by = $1
     )
     SELECT u.id, u.name, u.email, u.auth_uid IS NOT NULL AS registered
       FROM users u JOIN known k ON k.user_id = u.id
      WHERE u.id <> $1 AND ($2::uuid[] IS NULL OR u.id = ANY($2::uuid[]))
      ORDER BY lower(u.name), u.id`,
    [userId, onlyIds ?? null],
  );
  return rows;
}

/** Throws 404 unless every id is one of the caller's contacts. */
export async function requireContacts(q: Queryable, userId: string, ids: string[]) {
  const unique = [...new Set(ids.filter((id) => id !== userId))];
  if (!unique.length) return;
  const found = await listContacts(q, userId, unique);
  if (found.length !== unique.length) throw notFound("That person");
}
