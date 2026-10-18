-- Account-scoped, one-time walkthrough. Existing and new accounts see it once.
-- Additive; no user data is changed or removed.
ALTER TABLE user_settings ADD COLUMN tour_seen INTEGER NOT NULL DEFAULT 0 CHECK (tour_seen IN (0, 1));
