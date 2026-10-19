// Finding people by email: their account if they have one, otherwise a placeholder row that
// becomes theirs the first time they sign in with that email (see users.ts).
import type { Queryable } from "./db";

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
