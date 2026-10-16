-- Talk to the Goblin: personalisation, the person's own expressions, short
-- conversational context and replay protection for voice/offline requests.
--
-- Additive only. Nobody needs a row in any of these tables: without one the
-- Goblin uses its defaults. No audio and no transcripts are stored here.

PRAGMA foreign_keys = ON;

-- "Get to Know Your Goblin" (all optional).
CREATE TABLE goblin_profiles (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Goblin',
  aliases_json TEXT NOT NULL DEFAULT '[]',
  style TEXT NOT NULL DEFAULT 'friendly'
    CHECK (style IN ('friendly', 'professional', 'chaotic', 'quiet')),
  humour TEXT NOT NULL DEFAULT 'some' CHECK (humour IN ('none', 'some', 'lots')),
  reply_length TEXT NOT NULL DEFAULT 'short' CHECK (reply_length IN ('short', 'detailed')),
  speak_replies INTEGER NOT NULL DEFAULT 0,
  voice_name TEXT NOT NULL DEFAULT '',
  speech_rate REAL NOT NULL DEFAULT 1,
  speech_volume REAL NOT NULL DEFAULT 1,
  language TEXT NOT NULL DEFAULT '',
  listen_mode TEXT NOT NULL DEFAULT 'push' CHECK (listen_mode IN ('push', 'handsfree')),
  speech_notice_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- "When I say X, I mean Y." Interpretation preferences only: the meaning is
-- understood like anything else the person says, with the same checks.
CREATE TABLE goblin_expressions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phrase TEXT NOT NULL,
  meaning TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_goblin_expressions_user ON goblin_expressions(user_id);

-- What "them" refers to in a follow-up ("Which can wait?" → "Move them").
-- One row per user, record ids only, expires after a few minutes.
CREATE TABLE goblin_context (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  refs_json TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT NOT NULL
);

-- Replay protection: the same request id (a retried tap, an offline item
-- synced twice) returns the first answer instead of acting twice.
-- Rows older than two days are removed by the hourly housekeeping job.
CREATE TABLE goblin_requests (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  response_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, request_id)
);

CREATE INDEX idx_goblin_requests_created ON goblin_requests(created_at);
