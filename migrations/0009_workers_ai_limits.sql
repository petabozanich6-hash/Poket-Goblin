-- Fixed-size counters: one row per user/window, plus two global rows.
-- Reserve before inference; atomic conditional updates prevent concurrent overspend.
CREATE TABLE ai_request_limits (
  scope TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0)
);
