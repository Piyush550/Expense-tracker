// People: existing contacts, a name-only registered directory, and named email invitations.
import type { DirectoryPage, Person } from "../shared/api";
import { num, type Queryable } from "./db";
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
 * Everyone who shares a space (current or past) with `userId`, excluding them.
 * The legacy memberIds/userId inputs are limited to these contacts. directoryIds are validated separately.
 */
export async function listContacts(q: Queryable, userId: string, onlyIds?: string[]): Promise<Person[]> {
  const { rows } = await q.query<{ id: string; name: string; email: string | null; registered: boolean }>(
    `WITH known AS (
       SELECT DISTINCT m2.user_id FROM space_members m1 JOIN space_members m2 ON m2.space_id = m1.space_id WHERE m1.user_id = $1
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

/** Authenticated directory: display names and app ids only; never expose emails or Firebase uids. */
export async function registeredDirectory(q: Queryable, userId: string): Promise<Person[]> {
  const { rows } = await q.query<{ id: string; name: string }>(
    "SELECT id, name FROM users WHERE auth_uid IS NOT NULL AND id <> $1 ORDER BY lower(name), id",
    [userId],
  );
  return rows.map((p) => ({ ...p, email: null, registered: true }));
}

/** Directory selection is deliberately separate from the older contacts-only input. */
export async function requireRegistered(q: Queryable, ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const { rows } = await q.query("SELECT id FROM users WHERE auth_uid IS NOT NULL AND id = ANY($1::uuid[])", [unique]);
  if (rows.length !== unique.length) throw notFound("That registered person");
}

/** One name-only page of every registered user, including the caller. Search is literal, not LIKE syntax. */
export async function pageRegisteredDirectory(q: Queryable, input: { search?: string; limit: number; offset: number }): Promise<DirectoryPage> {
  const search = input.search?.trim() ?? "";
  const where = "auth_uid IS NOT NULL AND ($1 = '' OR strpos(lower(name), lower($1)) > 0 OR id::text = $1)";
  const [count, page] = await Promise.all([
    q.query<{ total: unknown }>(`SELECT COUNT(*) AS total FROM users WHERE ${where}`, [search]),
    q.query<{ id: string; name: string }>(`SELECT id, name FROM users WHERE ${where} ORDER BY lower(name), id LIMIT $2 OFFSET $3`, [search, input.limit, input.offset]),
  ]);
  return { people: page.rows, total: num(count.rows[0]?.total), limit: input.limit, offset: input.offset };
}
