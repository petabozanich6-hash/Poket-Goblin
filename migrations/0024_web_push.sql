-- Opt-in, session-scoped browser push endpoints. No personal notification text is
-- sent through third-party push services. Sessions/user deletion cascades revoke it.
PRAGMA foreign_keys = ON;

CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  reminders_enabled INTEGER NOT NULL DEFAULT 1 CHECK(reminders_enabled IN (0, 1)),
  messages_enabled INTEGER NOT NULL DEFAULT 1 CHECK(messages_enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_push_user ON push_subscriptions(user_id);
CREATE INDEX idx_push_session ON push_subscriptions(session_id);

-- One notification per reminder due-time, including a distinct snooze time.
-- Keep only identifiers/timestamps; never record sensitive reminder titles.
CREATE TABLE push_reminder_deliveries (
  reminder_id TEXT NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  due_at TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY(reminder_id, due_at)
);
