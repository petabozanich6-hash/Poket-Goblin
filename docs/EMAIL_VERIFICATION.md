# Pocket Goblin email verification

**Default: OFF.** Enable it only after mail delivery and migration 0016
are ready. Use the Cloudflare Worker variable
`EMAIL_VERIFICATION_REQUIRED = "true"`.

## Before enabling

1. Back up production D1 and apply `0016_verification_gate.sql` using the
   approval-gated production migrations workflow.
2. Confirm that the Cloudflare `EMAIL` binding can send mail from
   `no-reply@pocketgoblin.org` to a real external inbox.
3. Deploy and test the code while the flag remains off. Existing accounts
   must keep signing in normally.
4. Enable the flag and register a new user with a mailbox you control.
   Confirm that registration creates no session and login is blocked.
5. Open the single-use verification link, sign in, and test the resend flow.

## Safety

- Only users created while the flag is enabled require email verification.
- Existing accounts retain access, regardless of historic verification status.
- Pending accounts remain blocked **even if the flag is later turned off**.
- The token is random, stored as a hash, expires, and can only be used once.
- Public resends are rate-limited and do not reveal whether an account exists.
- If the mail sender is missing, gated registration fails before account creation.
- If delivery fails after registration, users can request another email.
- Email format checks or MX lookups alone do not prove mailbox ownership.

## Rollback

Turning the flag off stops gating **new** registrations only. It does not
unlock previously pending users. Restore mail delivery or assist the parent
in verifying their email; never bypass an existing verification requirement.
