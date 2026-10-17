# Global Campus email — branded, reusable template

## Goal

One reusable Pocket Goblin university outreach email for institutions worldwide,
with the same public **CAMPUS10** code (10% off Premium for the first 12 months).
**No per-university or per-country codes.** UNE's existing offer stays separate.

Source: worker/lib/campusOutreachEmail.ts

This server-side TypeScript module returns a professional Pocket Goblin HTML
email and a matching plain-text version. It uses the existing mascot logo,
forest-green and gold colours, with a clear button linking to
https://pocketgoblin.org and an opt-out contact.

## Free inbound setup (replies to the existing Side-Quest Gmail inbox)

Desired public university contact: **hello@pocketgoblin.org**.
The owner has confirmed that replies should still arrive at the existing
verified Side-Quest Gmail destination. Cloudflare Email Routing forwards
incoming mail for free; it does **not** send outgoing campaign email.

Configure in the Cloudflare dashboard under
**Email Service > Email Routing > Routing Rules** for `pocketgoblin.org`:

1. Create a routing rule for the address pattern `hello`.
2. Set action to **Send to an email**.
3. Choose the existing verified Side-Quest Gmail destination already used
   for Pocket Goblin support. Do not assume the address spelling.
4. Save and enable the rule; send an inbound test from a separate address.
5. Keep support and no-reply account-email configuration untouched.

**Do not change MX records:** inbound support already uses Cloudflare
routing. Adding a rule is sufficient. This rule must be configured by
the owner in Cloudflare; it is **not** created by this PR.

## Free outbound choices and restrictions

- Cloudflare Email Service is **transactional-only**, and is not permitted
  for the university promotional campaign.
- Brevo has a free tier of 300 emails/day and can authenticate a branded
  domain for campaigns, but requires explicit recipient consent. Do not
  upload unsolicited university contact lists and send a cold bulk campaign.
- Zoho Mail's normal email service likewise disallows promotional,
  marketing, bulk and automated outreach; a free mailbox does not change
  those conditions.
- For initial worldwide discovery, submit individual requests through
  university channels that explicitly invite external student benefits or
  offers. When an organisation opts in, the branded email can be sent
  through a compliant provider.
- Authenticate any eventual marketing sender via its required DNS records
  without overwriting existing routing MX or DKIM records. Avoid duplicate
  SPF records, which break email authentication.

Provider sources:
- https://developers.cloudflare.com/email-service/reference/faq/
- https://help.brevo.com/hc/en-us/articles/209405205-What-is-the-anti-spam-policy-of-Brevo
- https://www.zoho.com/mail/help/usage-policy.html
- https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/

## Sending: deliberately NOT enabled by this PR

This change creates the email **template**, not an outbound marketing sender.
The currently connected Cloudflare Email Service Worker binding is
transactional-only; Cloudflare's FAQ explicitly says marketing email is not
supported. Do not dispatch the template through the existing account email
helper. Password resets, verification, and support notifications remain as is.

Before sending university outreach from a domain address:

1. Choose a domain-based provider or business mailbox that permits the
   intended individually targeted commercial outreach in the countries
   being contacted. A transactional email account is not necessarily suitable.
2. Configure SPF, DKIM and DMARC, plus an authorised Pocket Goblin From
   address and monitored support@pocketgoblin.org Reply-To.
3. Add provider credentials as Cloudflare Worker secrets, never browser code.
4. Protect any send action with Owner HQ authentication and explicit confirmation.
   Limit volume, prevent duplicates, and log statuses without message bodies.
5. Maintain a suppression list for unsubscribes, honour opt-out requests,
   supply a real public business postal address, and follow local email laws.
   Do not automatically blast scraped lists.
6. Send an approved preview to one controlled inbox before broader delivery.
   Do not re-email the 11 organisations previously contacted through Gmail.

## Builder interface

Calling the exported campusOutreachEmail function with these inputs:

- to: recipient address
- institutionName: optional organisation name for personalisation
- senderPostalAddress: required real public business mailing address or PO box

returns an object containing the recipient, subject, HTML, and plain text,
ready for a compliant external provider integration.

The builder rejects an empty postal address. Never publish the owner's
private home address without their explicit agreement. The footer includes
the support mailbox as a way to opt out, but the eventual sending system
still needs to maintain opt-out/suppression records.

## Campaign facts

- Code: CAMPUS10 — one worldwide reusable code.
- Discount: 10% off for the first 12 months, monthly or annual Premium.
- Coupon and promotion exist in the owner's screenshot of Stripe;
  a live redemption was not independently tested.
- Owner screenshot shows an offer redemption expiry of 17 April 2027.
- Existing UNE and launch codes are unchanged.
