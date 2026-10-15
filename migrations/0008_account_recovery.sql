-- Account recovery and management.
--
-- Additive only. Existing accounts are unchanged; email_verified_at starts
-- empty for everyone (verification is encouraged, never required to sign in).

PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN email_verified_at TEXT;
ALTER TABLE users ADD COLUMN password_changed_at TEXT;

-- Single-use tokens for password reset and email verification. Only a keyed
-- hash of each token is stored; the token itself exists only in the email.
CREATE TABLE account_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('password_reset', 'email_verify')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_account_tokens_user ON account_tokens(user_id, purpose);
CREATE INDEX idx_account_tokens_expiry ON account_tokens(expires_at);
