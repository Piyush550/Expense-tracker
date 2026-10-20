// Personal tokens ("et_…"): long-lived, revocable keys a signed-in user creates for the iPhone
// shortcut and similar tools. They sign in as that user and can use the API like the app,
// except for anything destructive (see tokenMayCall), which needs the normal Google / email
// sign-in.
import { createHash, randomBytes } from "node:crypto";
import type { ApiToken, Me } from "../shared/api";
import { iso, num, type Queryable } from "./db";
import { conflict, notFound } from "./errors";

export const TOKEN_PREFIX = "et_";
const MAX_ACTIVE = 10;

/**
 * Whether a personal token may call METHOD + path (with the /api prefix). Everything is allowed
 * except what cannot be undone or would let a stolen key entrench itself:
 * - any DELETE (expenses, payments, groups, members, spaces, keys);
 * - merging a member into another (permanent);
 * - anything under /api/tokens (a key cannot create, regenerate or revoke keys).
 */
export function tokenMayCall(method: string, path: string): boolean {
  const p = path.replace(/\/+$/, "");
  if (method === "DELETE") return false;
  if (p === "/api/tokens" || p.startsWith("/api/tokens/")) return false;
  if (/^\/api\/spaces\/[^/]+\/members\/[^/]+\/merge$/.test(p)) return false;
  return true;
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const newSecret = () => TOKEN_PREFIX + randomBytes(32).toString("base64url");

interface TokenRow {
  id: string;
  name: string;
  hint: string;
  lifetime_days: number | null;
  created_at: unknown;
  rotated_at: unknown;
  expires_at: unknown;
  last_used_at: unknown;
  revoked_at: unknown;
}

const COLUMNS = "id, name, hint, lifetime_days, created_at, rotated_at, expires_at, last_used_at, revoked_at";
const isoOrNull = (v: unknown) => (v == null ? null : iso(v));

function toToken(r: TokenRow): ApiToken {
  const expiresAt = isoOrNull(r.expires_at);
  const status = r.revoked_at ? "revoked" : expiresAt && Date.parse(expiresAt) <= Date.now() ? "expired" : "active";
  return {
    id: r.id,
    name: r.name,
    hint: r.hint,
    lifetimeDays: r.lifetime_days == null ? null : num(r.lifetime_days),
    createdAt: iso(r.created_at),
    rotatedAt: iso(r.rotated_at),
    expiresAt,
    lastUsedAt: isoOrNull(r.last_used_at),
    revokedAt: isoOrNull(r.revoked_at),
    status,
  };
}

/** The user a token signs in as, or null if it is unknown, revoked or expired. */
export async function userForToken(q: Queryable, token: string): Promise<Me | null> {
  const { rows } = await q.query<{ token_id: string; id: string; name: string; email: string | null; stale: boolean }>(
    `SELECT t.id AS token_id, u.id, u.name, u.email,
            (t.last_used_at IS NULL OR t.last_used_at < now() - interval '1 minute') AS stale
       FROM api_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > now())`,
    [hashToken(token)],
  );
  const row = rows[0];
  if (!row) return null;
  // At most one write a minute per token, so a busy shortcut does not write on every call.
  if (row.stale) await q.query("UPDATE api_tokens SET last_used_at = now() WHERE id = $1", [row.token_id]);
  return { id: row.id, name: row.name, email: row.email ?? "" };
}

export async function listTokens(q: Queryable, userId: string): Promise<ApiToken[]> {
  const { rows } = await q.query<TokenRow>(`SELECT ${COLUMNS} FROM api_tokens WHERE user_id = $1 ORDER BY created_at DESC, id`, [userId]);
  return rows.map(toToken);
}

async function ownToken(q: Queryable, userId: string, id: string, lock = false): Promise<ApiToken> {
  const { rows } = await q.query<TokenRow>(
    `SELECT ${COLUMNS} FROM api_tokens WHERE id = $1 AND user_id = $2 ${lock ? "FOR UPDATE" : ""}`,
    [id, userId],
  );
  if (!rows[0]) throw notFound("That token");
  return toToken(rows[0]);
}

const expiryFor = (days: number | null) => (days == null ? null : new Date(Date.now() + days * 86_400_000).toISOString());

/** Creates a token. The secret is returned here only; the database keeps its hash. */
export async function createToken(tx: Queryable, userId: string, name: string, lifetimeDays: number | null) {
  // Lock the user's row so two creates at once cannot both pass the limit check.
  await tx.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
  const { rows } = await tx.query<{ n: unknown }>(
    "SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())",
    [userId],
  );
  if (num(rows[0]?.n) >= MAX_ACTIVE) throw conflict("too_many_tokens", `You can have up to ${MAX_ACTIVE} active tokens. Revoke one first.`);
  const secret = newSecret();
  const inserted = await tx.query<TokenRow>(
    `INSERT INTO api_tokens (user_id, name, token_hash, hint, lifetime_days, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
    [userId, name, hashToken(secret), secret.slice(-4), lifetimeDays, expiryFor(lifetimeDays)],
  );
  return { token: secret, info: toToken(inserted.rows[0]!) };
}

/** New secret for the same entry; the old secret stops working at once. */
export async function regenerateToken(tx: Queryable, userId: string, id: string) {
  const current = await ownToken(tx, userId, id, true);
  if (current.status === "revoked") throw conflict("token_revoked", "A revoked token cannot be regenerated. Create a new one.");
  const secret = newSecret();
  const updated = await tx.query<TokenRow>(
    `UPDATE api_tokens SET token_hash = $3, hint = $4, rotated_at = now(), expires_at = $5
      WHERE id = $1 AND user_id = $2 RETURNING ${COLUMNS}`,
    [id, userId, hashToken(secret), secret.slice(-4), expiryFor(current.lifetimeDays)],
  );
  return { token: secret, info: toToken(updated.rows[0]!) };
}

/** Rename, or set a new lifetime counted from now. */
export async function updateToken(tx: Queryable, userId: string, id: string, patch: { name?: string; lifetimeDays?: number | null }) {
  const current = await ownToken(tx, userId, id, true);
  if (patch.lifetimeDays !== undefined && current.status === "revoked") {
    throw conflict("token_revoked", "A revoked token cannot be extended. Create a new one.");
  }
  const days = patch.lifetimeDays === undefined ? current.lifetimeDays : patch.lifetimeDays;
  const { rows } = await tx.query<TokenRow>(
    `UPDATE api_tokens SET name = COALESCE($3, name), lifetime_days = $4,
            expires_at = CASE WHEN $5 THEN $6::timestamptz ELSE expires_at END
      WHERE id = $1 AND user_id = $2 RETURNING ${COLUMNS}`,
    [id, userId, patch.name ?? null, days, patch.lifetimeDays !== undefined, expiryFor(days)],
  );
  return toToken(rows[0]!);
}

export async function revokeToken(q: Queryable, userId: string, id: string) {
  const { rows } = await q.query<TokenRow>(
    `UPDATE api_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1 AND user_id = $2 RETURNING ${COLUMNS}`,
    [id, userId],
  );
  if (!rows[0]) throw notFound("That token");
  return toToken(rows[0]);
}

/** Only revoked or expired tokens can be removed from the list. */
export async function deleteToken(q: Queryable, userId: string, id: string) {
  const current = await ownToken(q, userId, id);
  if (current.status === "active") throw conflict("token_active", "Revoke the token before deleting it.");
  await q.query("DELETE FROM api_tokens WHERE id = $1 AND user_id = $2", [id, userId]);
}
