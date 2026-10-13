-- Sprint 4: documents, review inbox, connections, jobs, relationships

PRAGMA foreign_keys = ON;

CREATE TABLE documents (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sha256 TEXT,
  category_slug TEXT,
  status TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (status IN (
      'uploaded', 'queued', 'processing', 'ready', 'failed', 'needs_ocr'
    )),
  processing_error TEXT,
  extracted_text TEXT,
  linked_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  linked_event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
  linked_reminder_id TEXT REFERENCES reminders(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_documents_user ON documents(user_id, updated_at DESC);
CREATE INDEX idx_documents_user_status ON documents(user_id, status);
CREATE INDEX idx_documents_user_name ON documents(user_id, display_name);

CREATE TABLE document_extractions (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('fact', 'suggestion')),
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'medium',
  source_excerpt TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_doc_extractions_doc ON document_extractions(document_id);

CREATE TABLE review_items (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL
    CHECK (source_type IN (
      'capture', 'document', 'email', 'calendar', 'voice', 'manual'
    )),
  source_id TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  suggestion_type TEXT NOT NULL DEFAULT 'task',
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'dismissed', 'snoozed', 'edited')),
  uncertain INTEGER NOT NULL DEFAULT 0,
  snoozed_until TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  reviewed_at TEXT
);

CREATE INDEX idx_review_user_status ON review_items(user_id, status, created_at DESC);

CREATE TABLE record_links (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_type TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_type TEXT NOT NULL,
  to_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, from_type, from_id, to_type, to_id)
);

CREATE INDEX idx_record_links_user ON record_links(user_id);

CREATE TABLE external_connections (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL
    CHECK (provider IN (
      'gmail', 'outlook_mail', 'google_calendar', 'outlook_calendar'
    )),
  status TEXT NOT NULL DEFAULT 'not_connected'
    CHECK (status IN (
      'not_connected', 'connecting', 'connected', 'syncing',
      'needs_attention', 'error', 'disconnected'
    )),
  account_label TEXT NOT NULL DEFAULT '',
  scopes TEXT NOT NULL DEFAULT '',
  status_message TEXT NOT NULL DEFAULT '',
  last_synced_at TEXT,
  sync_cursor TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, provider)
);

CREATE INDEX idx_connections_user ON external_connections(user_id);

-- Encrypted/opaque token blob — never log or return to clients
CREATE TABLE oauth_tokens (
  connection_id TEXT PRIMARY KEY NOT NULL
    REFERENCES external_connections(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token_enc TEXT NOT NULL DEFAULT '',
  refresh_token_enc TEXT NOT NULL DEFAULT '',
  expires_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  redirect_path TEXT NOT NULL DEFAULT '/inbox',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE external_records (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES external_connections(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  record_type TEXT NOT NULL CHECK (record_type IN ('email', 'event', 'attachment')),
  title TEXT NOT NULL DEFAULT '',
  occurred_at TEXT,
  fingerprint TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  reviewed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, provider, external_id)
);

CREATE INDEX idx_external_records_user ON external_records(user_id, reviewed);

CREATE TABLE processing_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL
    CHECK (job_type IN (
      'document_extract', 'email_sync', 'calendar_sync', 'interpret'
    )),
  subject_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX idx_jobs_user_status ON processing_jobs(user_id, status);
