-- The action-taking Goblin: housekeeping, undo and autonomy preference.
--
-- Additive only. Existing shopping items keep their checked state; nothing is
-- deleted. Everyone starts with goblin_autonomy = 'auto' (safe, reversible
-- actions happen immediately with Undo).

PRAGMA foreign_keys = ON;

-- When an item was bought (for the "Bought recently" history) and when it was
-- taken off the list as no longer needed (soft removal, undoable).
ALTER TABLE shopping_items ADD COLUMN checked_at TEXT;
ALTER TABLE shopping_items ADD COLUMN removed_at TEXT;

CREATE INDEX idx_shopping_items_active ON shopping_items(user_id, checked, removed_at);

-- 'auto': do safe, explicit, reversible things straight away (with Undo).
-- 'ask':  always confirm first.
ALTER TABLE user_settings ADD COLUMN goblin_autonomy TEXT NOT NULL DEFAULT 'auto'
  CHECK (goblin_autonomy IN ('auto', 'ask'));

-- Every change the Goblin makes or proposes from natural language, with the
-- state before and after, so it can be undone and audited.
CREATE TABLE goblin_actions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'done', 'undone', 'declined')),
  message TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_goblin_actions_user ON goblin_actions(user_id, created_at DESC);
CREATE INDEX idx_goblin_actions_group ON goblin_actions(user_id, group_id);
