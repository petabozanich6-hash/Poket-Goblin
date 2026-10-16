-- Approved document pathways are separate from imported document suggestions.
-- A document can have only one active approved pathway per user.
CREATE TABLE IF NOT EXISTS study_pathways (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  approved_at TEXT NOT NULL DEFAULT (datetime('now')),
  cancelled_at TEXT,
  UNIQUE(user_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_study_pathways_user
  ON study_pathways(user_id, status);

CREATE TABLE IF NOT EXISTS study_pathway_sessions (
  id TEXT PRIMARY KEY,
  pathway_id TEXT NOT NULL REFERENCES study_pathways(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  title TEXT NOT NULL,
  scheduled_date TEXT NOT NULL,
  minutes INTEGER NOT NULL CHECK (minutes > 0 AND minutes <= 240),
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  task_id TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'completed', 'cancelled')),
  UNIQUE(pathway_id, step_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_study_pathway_sessions_user_date
  ON study_pathway_sessions(user_id, scheduled_date, status);
