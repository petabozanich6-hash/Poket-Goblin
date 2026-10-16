-- Shared, durable rate limits for sign-in, registration, password reset and
-- verification emails. The in-memory limiter resets whenever a Worker
-- isolate is recycled and isn't shared between locations; these counters
-- are. Keys are SHA-256 hashes (no email addresses or IPs are stored).
-- Rows are tiny, reset in place, and old windows are swept hourly.
--
-- Additive only.

CREATE TABLE auth_rate_limits (
  key TEXT PRIMARY KEY NOT NULL,
  -- Start of the current window, epoch milliseconds.
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_auth_rate_limits_window ON auth_rate_limits(window_start);
