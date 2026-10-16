-- Goblin Deals & Mischief. Campaigns are ALWAYS created inactive.
PRAGMA foreign_keys = ON;
CREATE TABLE promotion_campaigns (
 id TEXT PRIMARY KEY NOT NULL,
 code TEXT NOT NULL UNIQUE COLLATE NOCASE,
 name TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('percent','fixed')),
 amount INTEGER NOT NULL CHECK(amount > 0),
 billing_cycles INTEGER NOT NULL CHECK(billing_cycles BETWEEN 1 AND 36),
 audience TEXT NOT NULL DEFAULT 'new' CHECK(audience IN ('new','existing','all')),
 verification TEXT NOT NULL DEFAULT 'none' CHECK(verification IN ('none','manual')),
 verification_note TEXT NOT NULL DEFAULT '',
 start_at TEXT,
 expires_at TEXT,
 activation_window_days INTEGER CHECK(activation_window_days IS NULL OR activation_window_days BETWEEN 1 AND 365),
 max_redemptions INTEGER CHECK(max_redemptions IS NULL OR max_redemptions > 0),
 budget_cents INTEGER CHECK(budget_cents IS NULL OR budget_cents > 0),
 active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
 activated_at TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE promotion_redemptions (
 id TEXT PRIMARY KEY NOT NULL,
 campaign_id TEXT NOT NULL REFERENCES promotion_campaigns(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 stripe_subscription_id TEXT UNIQUE,
 stripe_checkout_session_id TEXT UNIQUE,
 status TEXT NOT NULL CHECK(status IN ('reserved','confirmed','failed','expired')),
 commitment_cents INTEGER NOT NULL CHECK(commitment_cents >= 0),
 discounts_realised_cents INTEGER NOT NULL DEFAULT 0,
 revenue_paid_cents INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 confirmed_at TEXT,
 UNIQUE(campaign_id,user_id)
);
CREATE INDEX idx_promotion_redemptions_campaign ON promotion_redemptions(campaign_id,status);
INSERT INTO promotion_campaigns
 (id,code,name,kind,amount,billing_cycles,audience,verification,verification_note,max_redemptions,activation_window_days)
 VALUES
 ('promo_uni20','UNI20','University students','percent',20,3,'new','manual','Student enrolment must be checked before activation for a customer.',NULL,NULL),
 ('promo_founding20','FOUNDING20','Founding goblins','percent',20,6,'new','none','',50,NULL),
 ('promo_goblinlaunch','GOBLINLAUNCH','Launch mischief','percent',25,1,'new','none','',NULL,7);
