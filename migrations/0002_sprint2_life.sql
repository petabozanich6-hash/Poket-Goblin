-- Sprint 2: calendar, reminders, recurrence, notes, shopping, history

PRAGMA foreign_keys = ON;

CREATE TABLE recurrence_rules (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL CHECK (
    frequency IN ('daily', 'weekly', 'fortnightly', 'monthly', 'yearly', 'custom')
  ),
  interval_value INTEGER NOT NULL DEFAULT 1,
  by_weekday TEXT,
  day_of_month INTEGER,
  starts_on TEXT NOT NULL,
  ends_on TEXT,
  paused INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_recurrence_user ON recurrence_rules(user_id);

CREATE TABLE events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  timezone TEXT NOT NULL DEFAULT 'local',
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  linked_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  recurrence_rule_id TEXT REFERENCES recurrence_rules(id) ON DELETE SET NULL,
  series_id TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_events_user_starts ON events(user_id, starts_at);
CREATE INDEX idx_events_series ON events(series_id);

CREATE TABLE reminders (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  remind_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'snoozed', 'dismissed', 'completed')),
  entity_type TEXT NOT NULL DEFAULT 'general'
    CHECK (entity_type IN ('task', 'event', 'bill', 'follow_up', 'general')),
  entity_id TEXT,
  repeat_frequency TEXT NOT NULL DEFAULT 'none'
    CHECK (repeat_frequency IN ('none', 'daily', 'weekly', 'fortnightly', 'monthly')),
  snoozed_until TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_reminders_user_at ON reminders(user_id, remind_at);
CREATE INDEX idx_reminders_user_status ON reminders(user_id, status);

CREATE TABLE notes (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  linked_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  linked_event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_notes_user ON notes(user_id, updated_at DESC);
CREATE INDEX idx_notes_pinned ON notes(user_id, pinned);

CREATE TABLE shopping_lists (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_shopping_lists_user ON shopping_lists(user_id);

CREATE TABLE shopping_items (
  id TEXT PRIMARY KEY NOT NULL,
  list_id TEXT NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  quantity TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  checked INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_shopping_items_list ON shopping_items(list_id, sort_order);
CREATE INDEX idx_shopping_items_user ON shopping_items(user_id);

CREATE TABLE task_history (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_task_history_user ON task_history(user_id, created_at DESC);
CREATE INDEX idx_task_history_task ON task_history(task_id);

ALTER TABLE tasks ADD COLUMN recurrence_rule_id TEXT REFERENCES recurrence_rules(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN series_id TEXT;
ALTER TABLE tasks ADD COLUMN occurrence_date TEXT;
ALTER TABLE tasks ADD COLUMN skipped INTEGER NOT NULL DEFAULT 0;

ALTER TABLE capture_items ADD COLUMN start_time TEXT;
ALTER TABLE capture_items ADD COLUMN recurrence_frequency TEXT;
ALTER TABLE capture_items ADD COLUMN created_event_id TEXT REFERENCES events(id) ON DELETE SET NULL;
ALTER TABLE capture_items ADD COLUMN created_note_id TEXT REFERENCES notes(id) ON DELETE SET NULL;
ALTER TABLE capture_items ADD COLUMN created_shopping_item_id TEXT REFERENCES shopping_items(id) ON DELETE SET NULL;
ALTER TABLE capture_items ADD COLUMN created_reminder_id TEXT REFERENCES reminders(id) ON DELETE SET NULL;
