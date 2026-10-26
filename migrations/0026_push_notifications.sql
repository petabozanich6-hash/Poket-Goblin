-- Push notifications, built on the endpoints staged in 0024.
-- A push carries no text: it only wakes the service worker, which then asks
-- Pocket Goblin (signed in) what to show. Notices hold kinds and record ids,
-- never reminder titles or other personal text. Additive only.
PRAGMA foreign_keys = ON;

-- What each device has already shown, so a second push never re-shows a
-- notification the person already dismissed.
ALTER TABLE push_subscriptions ADD COLUMN last_notice_seq INTEGER NOT NULL DEFAULT 0;

-- One row per person once they turn notifications on anywhere.
CREATE TABLE push_preferences (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  reminders_enabled INTEGER NOT NULL DEFAULT 1 CHECK (reminders_enabled IN (0, 1)),
  messages_enabled INTEGER NOT NULL DEFAULT 1 CHECK (messages_enabled IN (0, 1)),
  morning_enabled INTEGER NOT NULL DEFAULT 1 CHECK (morning_enabled IN (0, 1)),
  morning_time TEXT NOT NULL DEFAULT '08:00',
  evening_enabled INTEGER NOT NULL DEFAULT 0 CHECK (evening_enabled IN (0, 1)),
  evening_time TEXT NOT NULL DEFAULT '20:00',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Things to tell someone. `ref` is a record id (plus due time) or a local day,
-- so each reminder due-time, check-in or reply is announced once.
CREATE TABLE push_notices (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('reminder', 'morning', 'evening', 'message', 'test')),
  ref TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  pushed_at TEXT,
  UNIQUE (user_id, kind, ref)
);
CREATE INDEX idx_push_notices_pending ON push_notices(pushed_at, created_at);
CREATE INDEX idx_push_notices_created ON push_notices(created_at);
