// Turns a verified Firebase sign-in into a row in `users`, claiming any placeholder that
// a space or group created for the same email before the person ever signed in.
import type { Me } from "../shared/api";
import type { AuthClaims } from "./auth";
import { pgCode, type Db, type Queryable } from "./db";
import { forbidden } from "./errors";

interface UserRow {
  id: string;
  name: string;
  email: string | null;
}

const toMe = (u: UserRow): Me => ({ id: u.id, name: u.name, email: u.email ?? "" });

export function defaultName(claims: AuthClaims): string {
  const fromToken = claims.name?.trim();
  const fromEmail = claims.email?.split("@")[0]?.trim();
  return (fromToken || fromEmail || "Member").slice(0, 40);
}

/** Called on every request; one indexed lookup in the common case. */
export async function resolveUser(db: Db, claims: AuthClaims): Promise<Me> {
  if (!claims.emailVerified || !claims.email) {
    throw forbidden("email_unverified", "Verify your email address before using the app.");
  }
  const { rows } = await db.query<UserRow>("SELECT id, name, email FROM users WHERE auth_uid = $1", [claims.uid]);
  const existing = rows[0];
  if (existing) {
    const email = existing.email === claims.email ? existing.email : await syncEmail(db, existing.id, claims.email);
    return toMe({ ...existing, email });
  }
  try {
    return await db.transaction((tx) => firstSignIn(tx, claims, claims.email!));
  } catch (err) {
    // Two first requests raced; the other one created the row.
    if (pgCode(err) === "23505") {
      const again = await db.query<UserRow>("SELECT id, name, email FROM users WHERE auth_uid = $1", [claims.uid]);
      if (again.rows[0]) return toMe(again.rows[0]);
    }
    throw err;
  }
}

async function firstSignIn(tx: Queryable, claims: AuthClaims, email: string): Promise<Me> {
  const { rows } = await tx.query<UserRow & { auth_uid: string | null }>(
    "SELECT id, name, email, auth_uid FROM users WHERE email = $1 FOR UPDATE",
    [email],
  );
  const byEmail = rows[0];
  if (byEmail) {
    // Either a placeholder someone invited, or an account whose Firebase user was recreated.
    // The token proves the person owns this verified email, so the row is theirs.
    const name = byEmail.auth_uid ? byEmail.name : claims.name?.trim().slice(0, 40) || byEmail.name;
    await tx.query("UPDATE users SET auth_uid = $2, name = $3, updated_at = now() WHERE id = $1", [byEmail.id, claims.uid, name]);
    return toMe({ id: byEmail.id, name, email });
  }
  const inserted = await tx.query<UserRow>(
    "INSERT INTO users (auth_uid, email, name) VALUES ($1, $2, $3) RETURNING id, name, email",
    [claims.uid, email, defaultName(claims)],
  );
  return toMe(inserted.rows[0]!);
}

// The person changed the email on their Firebase account. If a placeholder holds the new
// email, fold it into this account; if a different signed-in user holds it, keep the old one.
async function syncEmail(db: Db, userId: string, email: string): Promise<string | null> {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<{ id: string; auth_uid: string | null }>(
      "SELECT id, auth_uid FROM users WHERE email = $1 AND id <> $2 FOR UPDATE",
      [email, userId],
    );
    const other = rows[0];
    if (other?.auth_uid) {
      const current = await tx.query<{ email: string | null }>("SELECT email FROM users WHERE id = $1", [userId]);
      return current.rows[0]?.email ?? null;
    }
    if (other) await mergeUsers(tx, other.id, userId);
    await tx.query("UPDATE users SET email = $2, updated_at = now() WHERE id = $1", [userId, email]);
    return email;
  });
}

/**
 * Moves everything that belongs to `fromId` onto `intoId` and deletes `fromId`. Used when a
 * placeholder turns out to be an existing account. Must run inside a transaction.
 */
export async function mergeUsers(tx: Queryable, fromId: string, intoId: string) {
  const p = [fromId, intoId];
  // Both on one expense: add the placeholder's share onto the account's share.
  await tx.query(
    `UPDATE expense_shares s
        SET share_paise = s.share_paise + f.share_paise,
            split_value = CASE WHEN s.split_value IS NULL OR f.split_value IS NULL
                               THEN COALESCE(s.split_value, f.split_value)
                               ELSE s.split_value + f.split_value END
       FROM expense_shares f
      WHERE f.user_id = $1 AND s.user_id = $2 AND s.expense_id = f.expense_id`,
    p,
  );
  await tx.query(
    "DELETE FROM expense_shares f USING expense_shares s WHERE f.user_id = $1 AND s.user_id = $2 AND s.expense_id = f.expense_id",
    p,
  );
  await tx.query("UPDATE expense_shares SET user_id = $2 WHERE user_id = $1", p);
  await tx.query("UPDATE expenses SET payer_id = $2 WHERE payer_id = $1", p);
  await tx.query("UPDATE expenses SET created_by = $2 WHERE created_by = $1", p);
  await tx.query("UPDATE expenses SET updated_by = $2 WHERE updated_by = $1", p);
  await tx.query("UPDATE expenses SET deleted_by = $2 WHERE deleted_by = $1", p);
  // A payment between the two identities is a payment to oneself once they are one person.
  await tx.query(
    "DELETE FROM settlements WHERE (from_user_id = $1 AND to_user_id = $2) OR (from_user_id = $2 AND to_user_id = $1)",
    p,
  );
  await tx.query("UPDATE settlements SET from_user_id = $2 WHERE from_user_id = $1", p);
  await tx.query("UPDATE settlements SET to_user_id = $2 WHERE to_user_id = $1", p);
  await tx.query("UPDATE settlements SET created_by = $2 WHERE created_by = $1", p);
  await tx.query("UPDATE settlements SET deleted_by = $2 WHERE deleted_by = $1", p);
  await tx.query("UPDATE spaces SET created_by = $2 WHERE created_by = $1", p);
  await tx.query("UPDATE groups SET created_by = $2 WHERE created_by = $1", p);
  // Same space: keep the account's membership (re-activated if the placeholder was active).
  await tx.query(
    `UPDATE space_members s
        SET left_at = CASE WHEN f.left_at IS NULL THEN NULL ELSE s.left_at END,
            role = CASE WHEN f.role = 'owner' THEN 'owner' ELSE s.role END
       FROM space_members f
      WHERE f.user_id = $1 AND s.user_id = $2 AND s.space_id = f.space_id`,
    p,
  );
  await tx.query(
    "DELETE FROM space_members f USING space_members s WHERE f.user_id = $1 AND s.user_id = $2 AND s.space_id = f.space_id",
    p,
  );
  await tx.query("UPDATE space_members SET user_id = $2 WHERE user_id = $1", p);
  await tx.query(
    "DELETE FROM group_members f USING group_members s WHERE f.user_id = $1 AND s.user_id = $2 AND s.group_id = f.group_id",
    p,
  );
  await tx.query("UPDATE group_members SET user_id = $2 WHERE user_id = $1", p);
  await tx.query("DELETE FROM users WHERE id = $1", [fromId]);
}
