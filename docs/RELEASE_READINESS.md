# Release readiness — Free + Premium launch

Branch: `claude/pocket-goblin-pwa-voice-991yas`. It contains PR #31 (Free
plan safeguards), PR #32 (email verification) and the launch fixes below.
Nothing here is merged, deployed or switched to live payments.

## What changed for launch

- **Billing:**
  - replacement subscriptions activate correctly
  - `invoice.paid` and `invoice.payment_failed` events are handled
  - an hourly reconciliation re-checks subscriptions with Stripe
  - no double subscriptions; if someone pays twice, the second is followed when the first ends
  - account deletion follows the real billing state
- **Free plan:**
  - rule-only helpers no longer use up the 3 AI requests a day
  - undo and confirm behave correctly when they hit a limit
  - a clear upgrade notice appears whenever a limit is reached
- **Reminders:**
  - impossible reminder times are rejected
  - repeating reminders are refused rather than stored and never delivered
  - quiet hours and nudges follow the customer's local clock
  - no copy promises push notifications
- **Auth:**
  - rate limits are stored in D1 (migration 0018)
  - a per-account lockout on repeated wrong passwords that strangers can't use to lock the owner out
  - a cross-site request guard is in place
  - registration is atomic and race-safe
  - changing a password revokes old reset links
  - a "your password was changed" email is sent
  - the resend result is truthful
- **Emails:** branded, mobile-friendly layout with a plain-text version.
- **Trust:**
  - Terms and Privacy are corrected and published at `/terms` and `/privacy` (still drafts for legal review)
  - support contact is available while signed out
- **Layout:** fixed sideways scroll on phones; support messages are rate limited.

## Evidence

- `npm run check` passes: typecheck, lint, format, 39 test files / 568
  tests, production build. `wrangler deploy --dry-run` passes.
- Browser (Playwright, production build on `wrangler dev`): 25 journeys pass.
  They cover first run, the action Goblin, voice/PWA install and offline
  sync, Document Devourer, Owner HQ (desktop, tablet and phone) and a new
  Free customer.
- All 18 migrations apply in order to an empty database, and the
  migration-order check passes.
- **Not tested:** real phones, real email delivery, real Stripe (test or
  live), production `platform_settings`.

## Configuration

| Name                                        | Kind     | Required | Notes                                                       |
| ------------------------------------------- | -------- | -------- | ----------------------------------------------------------- |
| `AUTH_SECRET`                               | secret   | yes      | 32+ chars; production refuses to serve without it           |
| `STRIPE_SECRET_KEY`                         | secret   | billing  | `sk_test_…` until live approval                             |
| `STRIPE_WEBHOOK_SECRET`                     | secret   | billing  | from the Stripe webhook endpoint                            |
| `STRIPE_PRICE_MONTHLY/YEARLY`               | var      | billing  | already in `wrangler.toml`                                  |
| `STRIPE_LIVE_ENABLED`                       | var      | no       | **leave unset** until the owner approves real charges       |
| `EMAIL_VERIFICATION_REQUIRED`               | var      | no       | `"true"` gates new sign-ups on a confirmed email            |
| `AI_PROVIDER`, `AI_MODEL`                   | var      | yes      | `workers_ai`, allow-listed Llama model (in `wrangler.toml`) |
| `AI_DAILY_GLOBAL_LIMIT`                     | var      | yes      | 300 today; Free may use half                                |
| `EMAIL` (send_email), `AI`, `DB`, `UPLOADS` | bindings | yes      | unchanged                                                   |

No new secrets or paid services. The "Workers Builds" PR check is red by
design: preview builds are switched off because they would use production
data.

## Deployment plan (owner approval required)

Merging to `main` deploys automatically (Workers Builds), and the
migration workflow only runs from `main`. The code tolerates a short gap
before the migrations:

- Missing 0016 triggers: the app-level limit checks still apply.
- Missing 0017 column: sign-in falls back safely while verification is off.
- Missing 0018 table: limits fall back to in-memory counters.

1. Back up production D1 (Time Travel bookmark).
2. Merge the PR into `main`. Workers Builds deploys it.
3. Straight away, run **D1 migrations (production)**: preflight first,
   which should list 0016, 0017 and 0018 as pending; then apply.
4. Smoke test on pocketgoblin.org:
   - sign in
   - add a task
   - tell the Goblin "I need milk"
   - open `/terms` and `/privacy`
   - Settings → Plan shows Free with the correct allowances
5. In Owner HQ → Platform settings, confirm AI limits and storage quotas
   say "Using the default", or set Free 3 a day / 10 MB.
6. In the Stripe dashboard (test mode), add `invoice.paid` and
   `invoice.payment_failed` to the webhook. Set "after retries fail" to
   **cancel subscription**, and turn on the customer portal.
7. Run a test-mode purchase end to end, cancel it, then buy again (the
   replacement path).
8. Email: onboard the domain to Cloudflare Email Sending (SPF/DKIM), add
   DMARC, and test reset and verification emails to a Gmail and an Outlook
   inbox. Only then consider `EMAIL_VERIFICATION_REQUIRED = "true"`.
9. Live billing: a separate, explicit approval. Repeat the Stripe steps in
   live mode and set `STRIPE_LIVE_ENABLED = "true"`.

## Rollback plan

- **Code:** revert the merge commit on `main`. Workers Builds redeploys
  the previous version. Every migration is additive, so the old code runs
  against the new schema.
- **Quota triggers misbehaving:** first set the affected customers to
  Premium from Owner HQ, which needs no deploy. As a last resort, a new
  migration can `DROP TRIGGER` the five `free_*` triggers. That changes no
  data, but it needs the owner's approval.
- **Email verification:** turning the flag off only stops gating new
  sign-ups. People already pending stay pending (by design, see
  `EMAIL_VERIFICATION.md`).
- **Billing:** keep `STRIPE_LIVE_ENABLED` unset. Removing
  `STRIPE_SECRET_KEY` turns billing off without touching entitlements.

## Needs the owner

- Legal review of `docs/legal/*` (every ⚠️). The pages are live as
  drafts.
- Check that the Stripe prices and currencies in the dashboard match
  A$9.95 and A$99.
- Confirm `support@pocketgoblin.org` is a monitored mailbox.
- Confirm whether `www.pocketgoblin.org` is used. The cross-site guard
  and CORS only allow `https://pocketgoblin.org`.
- Check that the Owner HQ exchange-rate source (Frankfurter) responds in
  production; if not, AUD costs show as unavailable rather than invented.

## Can wait

- Web push notifications. Reminders are in-app, plus the phone-calendar
  link.
- Repeating reminders (use repeating tasks).
- Batching multi-row Goblin and breakdown writes, so a race at a limit
  can't half-apply.
- An atomic storage check for simultaneous "keep" requests (it can go
  over by one file).
- A unique index on the default shopping list.
- Excluding the Owner from the HQ customer count.
- A "Help with my account or billing" support category.
