-- Pocket Goblin Sprint 1 schema
-- Multi-user, strict isolation via user_id on all personal rows.

PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE categories (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, slug)
);

CREATE INDEX idx_categories_user ON categories(user_id);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'cancelled')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  due_date TEXT,
  capacity_cost INTEGER NOT NULL DEFAULT 1 CHECK (capacity_cost BETWEEN 1 AND 5),
  parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_tasks_user_status ON tasks(user_id, status);
CREATE INDEX idx_tasks_user_due ON tasks(user_id, due_date);
CREATE INDEX idx_tasks_parent ON tasks(parent_id);

CREATE TABLE captures (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  raw_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'dismissed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_captures_user ON captures(user_id, created_at DESC);

CREATE TABLE capture_items (
  id TEXT PRIMARY KEY NOT NULL,
  capture_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('task', 'reminder', 'appointment', 'note', 'shopping', 'follow_up')),
  title TEXT NOT NULL,
  due_date TEXT,
  category_slug TEXT,
  confidence TEXT NOT NULL DEFAULT 'medium' CHECK (confidence IN ('low', 'medium', 'high')),
  uncertain INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'accepted', 'rejected')),
  created_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_capture_items_capture ON capture_items(capture_id);

CREATE TABLE daily_plans (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_date TEXT NOT NULL,
  capacity_mode TEXT NOT NULL CHECK (capacity_mode IN ('goblin', 'steady', 'quest')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, plan_date)
);

CREATE TABLE daily_plan_tasks (
  plan_id TEXT NOT NULL REFERENCES daily_plans(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (plan_id, task_id)
);

CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capacity_mode TEXT NOT NULL DEFAULT 'steady' CHECK (capacity_mode IN ('goblin', 'steady', 'quest')),
  theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  gamification_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Built-in life categories (user_id NULL = global defaults)
INSERT INTO categories (id, user_id, slug, name, sort_order, is_builtin) VALUES
  ('cat_home', NULL, 'home', 'Home', 10, 1),
  ('cat_money', NULL, 'money', 'Money', 20, 1),
  ('cat_health', NULL, 'health', 'Health', 30, 1),
  ('cat_family', NULL, 'family', 'Family', 40, 1),
  ('cat_work_study', NULL, 'work_study', 'Work and Study', 50, 1),
  ('cat_appointments', NULL, 'appointments', 'Appointments', 60, 1),
  ('cat_shopping', NULL, 'shopping', 'Shopping', 70, 1),
  ('cat_personal', NULL, 'personal', 'Personal', 80, 1),
  ('cat_other', NULL, 'other', 'Other', 90, 1);
