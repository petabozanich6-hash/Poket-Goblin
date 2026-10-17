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
