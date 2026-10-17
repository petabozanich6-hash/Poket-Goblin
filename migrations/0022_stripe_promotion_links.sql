-- Store Stripe ids for owner-published first-invoice promotion codes.
-- Older draft campaigns stay inactive and unlinked.
ALTER TABLE promotion_campaigns ADD COLUMN stripe_coupon_id TEXT;
ALTER TABLE promotion_campaigns ADD COLUMN stripe_promotion_code_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_promotion_stripe_code ON promotion_campaigns(stripe_promotion_code_id) WHERE stripe_promotion_code_id IS NOT NULL;
