-- Phone calendar subscriptions: one private feed link per person.
--
-- Additive only. The link's token is never stored: only a keyed hash, so a
-- database leak does not reveal anyone's calendar. The time zone lets the
-- feed show all-day items on the right local day.

PRAGMA foreign_keys = ON;

CREATE TABLE calendar_feeds (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at TEXT
);
