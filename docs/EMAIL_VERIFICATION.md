# Pocket Goblin — prove email ownership before granting new-user access

**Default is OFF.** The new-user verification gate is activated only if
`EMAIL_VERIFICATION_REQUIRED = "true"` is explicitly set in the Cloudflare
Worker configuration *after* email sending and migration 0016 are confirmed.

## Before enabling it

1. Back up production D1. Apply and verify migration `0016_verification_gate.sql`
   via the approval-gated production D1 migrations workflow.
2. Confirm the Cloudflare Email Service `EMAIL` binding is configured and
   can send mail from `no-reply@pocketgoblin.org` to a real external inbox.
   Do not enable the flag if sending fails.
3. Deploy the code and exercise registration with a real inbox while the flag
   remains off. Legacy accounts must be able to sign in unchanged.
4. Set `EMAIL_VERIFICATION_REQUIRED = "true"`, then register a fresh test user.
   Confirm registration creates no usable session; direct login and /api/me
   fail before verification. Check the real email link, one-time redemption,
   resend, and successful login afterward.
5. Rollout or rollback must preserve old users. The gate checks only users
   with `email_verification_required_at` set at registration, not old accounts
   whose `email_verified_at` was historically absent.

## Security/UX

- Gate applies only to new signups while flag is ON. Legacy users are not locked out.
- An unverified new account cannot get a session through registration or login.
- The emailed one-time token is random, short-lived and hashed at rest.
- The public resend endpoint has per-IP and per-email limits and an
  indistinguishable successful response; no email-address enumeration.
- Email is not authenticated by a regex, MX lookup or a welcome email alone.
- If sender setup is unavailable, new gated registration fails **before**
  inserting an account. If a send fails after creation, the new user can
  request another link; do not grant access to bypass email delivery.
- Emergency rollback: unset the flag. This disables gating (including pending
  newly created accounts); use sparingly and investigate mail delivery first.
