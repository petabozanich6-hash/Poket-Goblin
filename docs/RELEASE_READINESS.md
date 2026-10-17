# Pocket Goblin — launch readiness (17 October 2026)

This is the current release checklist, replacing an obsolete pre-launch checklist written before live billing, recent integrations, and migrations. It records what was checked and distinguishes code/CI evidence from live customer testing; it is not a penetration-test certificate or legal sign-off.

## Owner-confirmed live smoke tests

- Registration and billing/coupon checkout journey: owner reports passing with a separate test account.
- Live Stripe Checkout opens; a first-invoice promotional code changed the displayed price.
- Branded giveaway notification email: owner reports successful delivery.
- Owner manually checked onboarding through a new-account registration, so no separate onboarding walkthrough is scheduled.

These are owner-reported observations, not independently audited payment settlement, production webhook processing, or security testing.

## Repository controls and prior test coverage

- Authentication uses hashed passwords and HttpOnly session cookies. User-scoped data access is enforced in API routes; cross-record references have ownership checks.
- Owner HQ requires server-side permissions, CSRF protections and recent passkey step-up, with admin audit logging.
- Account-deletion tests verify one account's records are removed without deleting another account's records.
- Giveaway tests cover entitlement assignment, one claim per account, campaign caps, and email sending even when the provider fails; no Stripe subscription is created by gifts.
- Published Stripe promotion codes currently support only tightly restricted first-invoice percentage offers, one total redemption and new-customer eligibility. Other drafts (including multicycle/founding offers) remain inactive.
- Stripe usage tracker retrieves live counts from Stripe. The legacy internal financial and claim ledger is **not** a reconciled invoice-level accounting system.
- Account export is tested for coverage of user-id tables and explicitly excludes some secrets/internal records. Kept original documents are downloaded separately.

## Production state checked

- Owner ran and verified D1 migrations through `0022_stripe_promotion_links.sql`: 22 applied, 0 pending on 17 October 2026.
- `STRIPE_LIVE_ENABLED = "true"` was approved by the owner and committed to production `wrangler.toml`; monthly and annual Stripe price IDs are present.
- Stripe request API header is pinned to `2025-03-31.basil` to support Managed Payments.
- API keys, webhook secrets and account passwords must be stored only in Cloudflare secrets, not source control.

## Final release gates — verify separately

1. **Security:** Run current CI and cross-account API tests on the final `main` commit; verify user A cannot read, download, mutate, or link user B's tasks, notes, calendar entries, documents, pathways, or billing information. Check that unauthenticated and non-owner callers cannot access HQ endpoints. Automated tests reduce risk but are not a security penetration test.
2. **Billing settlement and webhooks:** Confirm a genuine completed Stripe test/live subscription grants the correct plan, webhook signatures are checked, repeated webhook delivery is idempotent, failed payments and cancellation transitions are handled, and access matches Stripe after renewal. Merely opening Checkout and previewing a coupon does not prove settlement and entitlements.
3. **Promotion accounting:** Stripe currently supplies aggregate redemption counts. Per-customer invoice reconciliation and accurate realised discounts remain unfinished; do not treat the legacy ledger's zero values as audited revenue.
4. **Policy review:** Terms, Privacy, Billing/Refunds and AI/Document guide are published from `docs/legal`. Confirm contact address, registered business details, supported currencies/prices, processing disclosures and consumer-law requirements with the owner's legal reviewer.
5. **Operational checks:** Verify production domain, email delivery for real flows, error logs, backups, migrations, alerts, support contact and recoverability. Do not expose tokens, Stripe keys, session cookies or other customer identifiers in support screenshots.

## Launch scope decisions

- Do not expand feature scope or reopen onboarding testing unless a regression appears.
- Do not activate six-cycle or calendar-month discount drafts until billing-interval-safe rules are implemented.
- No additional migration is required for this documentation-only revision.
