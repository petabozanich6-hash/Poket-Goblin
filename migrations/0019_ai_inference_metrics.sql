-- Additive metadata-only measurements of Workers AI inference calls.
-- Never store prompts, responses, uploaded files, usernames or user IDs.
-- Readiness: applies only through the existing approval-gated D1 migration workflow.
CREATE TABLE IF NOT EXISTS ai_inference_metrics (
  id TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  modality TEXT NOT NULL CHECK(modality IN ('text', 'vision')),
  status TEXT NOT NULL CHECK(status IN ('completed', 'failed')),
  duration_ms INTEGER NOT NULL CHECK(duration_ms >= 0),
  input_tokens INTEGER,
  output_tokens INTEGER,
  token_basis TEXT NOT NULL CHECK(token_basis IN ('reported', 'approximate', 'unknown')),
  estimated_gross_usd REAL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_inference_metrics_created_at
  ON ai_inference_metrics(created_at);
