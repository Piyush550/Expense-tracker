-- Personal tokens: a key a user creates in the app so the iPhone shortcut can add expenses
-- as them. Only a SHA-256 hash of each token is stored; the token itself is shown once.
-- A token can call only the shortcut's endpoints (see server/tokens.ts), never manage tokens.
CREATE TABLE api_tokens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  token_hash     text NOT NULL UNIQUE,
  -- Last 4 characters, so the user can recognise which token is which.
  hint           text NOT NULL,
  -- NULL = never expires. Kept so a regenerated token gets the same lifetime again.
  lifetime_days  integer CHECK (lifetime_days IS NULL OR lifetime_days BETWEEN 1 AND 3650),
  created_at     timestamptz NOT NULL DEFAULT now(),
  rotated_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz,
  last_used_at   timestamptz,
  revoked_at     timestamptz
);
CREATE INDEX api_tokens_user_idx ON api_tokens (user_id, created_at DESC);
