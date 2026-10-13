-- Sprint 5 — Magical UX: preferences, nudges, rescue plans, achievements

PRAGMA foreign_keys = ON;

ALTER TABLE user_settings ADD COLUMN quiet_hours_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_settings ADD COLUMN quiet_hours_start TEXT NOT NULL DEFAULT '21:00';
ALTER TABLE user_settings ADD COLUMN quiet_hours_end TEXT NOT NULL DEFAULT '08:00';
ALTER TABLE user_settings ADD COLUMN nudge_frequency TEXT NOT NULL DEFAULT 'normal'
  CHECK (nudge_frequency IN ('off', 'quiet', 'normal', 'chatty'));
ALTER TABLE user_settings ADD COLUMN daily_briefing_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE user_settings ADD COLUMN evening_checkin_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_settings ADD COLUMN reduced_motion INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_settings ADD COLUMN planning_approach TEXT NOT NULL DEFAULT 'balanced'
  CHECK (planning_approach IN ('minimal', 'balanced', 'ambitious'));
ALTER TABLE user_settings ADD COLUMN goblin_frequency TEXT NOT NULL DEFAULT 'normal'
  CHECK (goblin_frequency IN ('quiet', 'normal', 'chatty'));
ALTER TABLE user_settings ADD COLUMN completed_quest_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS nudge_log (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'shown', 'snoozed', 'dismissed', 'acted')),
  snoozed_until TEXT,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_nudge_fingerprint
  ON nudge_log(user_id, fingerprint);
CREATE INDEX IF NOT EXISTS idx_nudge_user_status
  ON nudge_log(user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS rescue_plans (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_date TEXT NOT NULL,
  summary TEXT NOT NULL,
  keep_task_ids_json TEXT NOT NULL DEFAULT '[]',
  defer_task_ids_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'accepted', 'dismissed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_rescue_user_date
  ON rescue_plans(user_id, plan_date DESC);

CREATE TABLE IF NOT EXISTS achievements (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  earned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, code)
);

CREATE INDEX IF NOT EXISTS idx_achievements_user
  ON achievements(user_id, earned_at DESC);

CREATE TABLE IF NOT EXISTS search_history (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_search_history_user
  ON search_history(user_id, created_at DESC);
