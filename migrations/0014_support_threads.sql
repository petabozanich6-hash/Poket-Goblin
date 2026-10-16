-- Parent-to-Owner private feedback threads. No child records or lesson content.
PRAGMA foreign_keys = ON;
CREATE TABLE support_threads (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('problem','idea','feedback')),
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','in_progress','resolved')),
  internal_note TEXT NOT NULL DEFAULT '',
  unread_for_owner INTEGER NOT NULL DEFAULT 1,
  unread_for_user INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_support_owner ON support_threads (updated_at DESC);
CREATE INDEX idx_support_user ON support_threads (user_id, updated_at DESC);
CREATE TABLE support_replies (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
  author TEXT NOT NULL CHECK (author IN ('owner','user')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_support_replies_thread ON support_replies (thread_id, created_at);
