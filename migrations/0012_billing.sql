-- Stripe billing: remember which webhook events were already handled, so a
-- retried delivery never applies twice.
--
-- Additive only. Subscriptions themselves live in user_entitlements
-- (migration 0006) with source = 'stripe'.

PRAGMA foreign_keys = ON;

CREATE TABLE stripe_events (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
