-- Owner-issued Premium giveaways: no Stripe checkout or automatic renewal.
CREATE TABLE premium_giveaway_campaigns (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  duration_days INTEGER NOT NULL CHECK (duration_days BETWEEN 1 AND 365),
  max_recipients INTEGER NOT NULL CHECK (max_recipients BETWEEN 1 AND 10000),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE premium_giveaway_grants (
  id TEXT PRIMARY KEY NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES premium_giveaway_campaigns(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  entitlement_id TEXT NOT NULL UNIQUE REFERENCES user_entitlements(id),
  issued_by TEXT NOT NULL REFERENCES users(id),
  issued_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(campaign_id,user_id)
);
CREATE INDEX idx_premium_giveaway_grants_campaign ON premium_giveaway_grants(campaign_id);
