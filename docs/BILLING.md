# Billing (Stripe)

Premium is sold through Stripe Checkout and managed in the Stripe Customer
Portal. Pocket Goblin never sees card details.

## What's built

- **Settings → Plan** (`/settings/plan`): current plan, Free vs Premium (limits
  come live from Goblin HQ settings), monthly/yearly prices from Stripe,
  **Upgrade to Premium**, and **Manage billing** (card, receipts, cancel).
- `POST /api/billing/checkout` and `POST /api/billing/portal` open Stripe.
- `POST /api/billing/webhook`: signature-checked (5-minute tolerance),
  test/live mode must match, each event handled once (`stripe_events`,
  migration `0012`), and it always re-reads the subscription from Stripe so
  out-of-order events can't undo a newer state. It only writes the `premium`
  entitlement (`source = 'stripe'`). It never grants roles, and never
  overrides Premium the Owner gave by hand.
- Cancelling keeps Premium until the end of the paid period. Failed payments
  (`past_due`) keep Premium while Stripe retries, and the plan page asks the
  person to update their card.
- Account deletion is refused while a subscription is active, so nobody is
  billed for a deleted account.

## Safety rails

- Prices are never created in code. You make **one** product in Stripe.
- Live keys (`sk_live_…`) are refused unless `STRIPE_LIVE_ENABLED = "true"`.
- Without keys and prices, Premium shows **Coming soon** and nothing can be
  bought.

## Setting it up (test mode first)

1. In the Stripe dashboard, switch to **Test mode**.
2. **Product catalogue → Add product**: "Pocket Goblin Premium", with a
   recurring monthly price and (optionally) a yearly price. Copy the price
   ids (`price_…`).
3. **Developers → Webhooks → Add endpoint**:
   `https://pocketgoblin.org/api/billing/webhook`, with the events
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `customer.subscription.paused` and `customer.subscription.resumed`. Copy
   its signing secret (`whsec_…`).
4. **Settings → Billing → Customer portal**: turn on cancellation, payment
   method updates and invoice history.
5. Worker secrets (these survive deploys):
   `wrangler secret put STRIPE_SECRET_KEY` (the `sk_test_…` key) and
   `wrangler secret put STRIPE_WEBHOOK_SECRET`.
6. Put the price ids in `wrangler.toml` (`STRIPE_PRICE_MONTHLY`,
   `STRIPE_PRICE_YEARLY`) in a PR. They aren't secret, and dashboard-only
   variables are wiped by the next deploy.
7. Test with card `4242 4242 4242 4242`, any future date and any CVC.

Going live repeats steps 2–6 in live mode, plus `STRIPE_LIVE_ENABLED = "true"`.
That needs the Owner's explicit approval.

## Existing multi-currency Stripe prices (October 2026)

- Monthly: `price_1UQcuoRA6WYgjfaI4nZemncM` (AUD default A$9.95/month).
- Annual: `price_1UQcehRA6WYgjfaIchHkzT9R` (AUD default A$99/year).
- Both prices have manually configured currency options in Stripe (CAD, EUR, GBP, NZD and USD, as well as AUD).
- Checkout passes the Stripe Price ID but deliberately does **not** pass a `currency` parameter. Stripe Checkout selects the appropriate configured currency automatically for supported customers. If no matching currency is available, it uses the default AUD price. No customer IP lookup, currency switcher or homemade FX conversion is needed.
- The plan page displays the base AUD amount and explicitly states that Stripe confirms the final currency and amount before payment. **Do not claim the default displayed amount is the customer's localized amount.**
- The Stripe webhook and subscription entitlement handling remain unchanged.
- Linking the price IDs does **not** require putting Stripe secrets in GitHub. Live billing must remain disabled until credentials, signing secret, webhook, portal and live checkout are verified, with explicit owner approval.
- Existing Stripe promotion-code entry remains separate from Goblin Deals. Review this before turning on custom campaign redemptions.
