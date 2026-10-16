-- Existing users remain able to sign in, regardless of prior email verification status.
-- Newly registered users are marked only when explicit rollout flag is enabled.
ALTER TABLE users ADD COLUMN email_verification_required_at TEXT;
