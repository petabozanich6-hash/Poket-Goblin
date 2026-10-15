-- Owner account and administration (Goblin HQ) — schema only.
--
-- Additive: new tables, new nullable/defaulted columns, and reference rows.
-- It changes no existing row and grants no privileges to anyone. Promoting
-- the Owner is a separate, approval-gated operation (docs/OWNER_PROMOTION.md).

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------------ accounts

-- Account lifecycle. Every existing account starts as 'active'.
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'suspended'));
ALTER TABLE users ADD COLUMN suspended_at TEXT;
ALTER TABLE users ADD COLUMN suspended_reason TEXT;

-- last_seen_at: coarse activity (updated at most hourly) for "active users".
-- elevated_until: end of a passkey step-up for administrative access.
ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;
ALTER TABLE sessions ADD COLUMN elevated_until TEXT;

-- --------------------------------------------------------- administrative roles

-- Role catalogue. Ordinary customers have no row in user_roles. New roles
-- (e.g. restricted support staff) are added here later without a rebuild.
CREATE TABLE roles (
  name TEXT PRIMARY KEY NOT NULL,
  description TEXT NOT NULL
);

INSERT INTO roles (name, description)
VALUES ('owner', 'Full platform administration');

CREATE TABLE user_roles (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL REFERENCES roles(name),
  granted_by TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  granted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revoked_at TEXT
);

CREATE UNIQUE INDEX idx_user_roles_active
  ON user_roles(user_id, role) WHERE revoked_at IS NULL;
CREATE INDEX idx_user_roles_role ON user_roles(role, revoked_at);

-- ----------------------------------------------------- subscription entitlements

-- Separate from roles: buying Premium never grants administration, and
-- losing a subscription never removes Owner access. Stripe stays the billing
-- authority; these rows hold only what feature access and support need.
--   entitlement: premium | owner_premium
--   source:      stripe  | admin
--   status:      active | trialing | past_due | canceled | expired
CREATE TABLE user_entitlements (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entitlement TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  billing_interval TEXT,
  currency TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  granted_by TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ended_at TEXT
);

CREATE UNIQUE INDEX idx_user_entitlements_open
  ON user_entitlements(user_id, entitlement) WHERE ended_at IS NULL;
CREATE INDEX idx_user_entitlements_status
  ON user_entitlements(entitlement, status);
CREATE INDEX idx_user_entitlements_stripe_sub
  ON user_entitlements(stripe_subscription_id);

-- ------------------------------------------------------------ audit & security

-- Every administrative change. actor_user_id is NULL for operator actions
-- (e.g. the promotion workflow); actor_label says who/what acted.
CREATE TABLE admin_audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_label TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_admin_audit_created ON admin_audit_log(created_at DESC);
CREATE INDEX idx_admin_audit_target ON admin_audit_log(target_type, target_id);

-- Per-account security events (sign-ins, failures, suspensions, step-ups).
-- Metadata only: never passwords, tokens or content.
CREATE TABLE security_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_security_events_user ON security_events(user_id, created_at DESC);
CREATE INDEX idx_security_events_type ON security_events(event_type, created_at DESC);

-- ----------------------------------------------------------- passkeys (WebAuthn)

CREATE TABLE webauthn_credentials (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]',
  device_type TEXT NOT NULL DEFAULT '',
  backed_up INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL DEFAULT 'Passkey',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at TEXT
);

CREATE INDEX idx_webauthn_credentials_user ON webauthn_credentials(user_id);

-- Single-use challenges, bound to the session that requested them.
CREATE TABLE webauthn_challenges (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'authenticate')),
  challenge TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_webauthn_challenges_user ON webauthn_challenges(user_id, purpose);

-- --------------------------------------------------------- platform settings

-- Owner-managed, validated configuration (never secrets). Absent keys use
-- the defaults in code, so an empty table changes nothing.
CREATE TABLE platform_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- --------------------------------------------------------------- observability

-- One row per goblin-intelligence attempt, recorded from this migration on.
--   outcome: ai | ai_unavailable | rules | limit_reached | disabled
CREATE TABLE ai_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_ai_events_created ON ai_events(created_at);
CREATE INDEX idx_ai_events_user ON ai_events(user_id, created_at);

-- Unhandled API errors (route + error class only; no request bodies).
CREATE TABLE app_errors (
  id TEXT PRIMARY KEY NOT NULL,
  method TEXT NOT NULL,
  route TEXT NOT NULL,
  status INTEGER NOT NULL,
  error_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_app_errors_created ON app_errors(created_at);
