# Pocket Goblin Privacy Policy (DRAFT)

> **Draft for professional legal review.** It describes how the software
> actually behaves. Fill in every item marked ⚠️ before relying on it.
> Nothing here claims compliance with any particular law.

**Operator:** Peta Bozanich, trading as Pocket Goblin (ABN 54 938 519 819)
**Contact:** support@pocketgoblin.org
**Effective date:** ⚠️

## What we collect

| Data                              | Why                                                         | Where         |
| --------------------------------- | ----------------------------------------------------------- | ------------- |
| Email, display name               | Your account, sign-in, account emails                       | Cloudflare D1 |
| Password                          | Sign-in. Stored only as a salted PBKDF2 hash                | Cloudflare D1 |
| What you give the Goblin          | Tasks, notes, brain dumps, calendar, lists, reminders       | Cloudflare D1 |
| Documents you choose to keep      | Your private vault                                          | Cloudflare R2 |
| Messages to support               | Answering you (the Owner's private notes on them stay ours) | Cloudflare D1 |
| Goblin preferences                | Its name, style, voice settings, phrases you teach it       | Cloudflare D1 |
| Sign-in sessions, security events | Keeping your account safe (no IP addresses stored)          | Cloudflare D1 |
| Usage counts                      | Fair-use limits and service health (counts, never content)  | Cloudflare D1 |
| Subscription status               | Premium access (card details stay with Stripe)              | Cloudflare D1 |

Short-lived security records are also kept: single-use sign-in, reset and
verification links (stored only as hashes and deleted once used or
expired), and rate-limit counters (stored as hashes, cleared within hours).

We do not sell personal information or use it for advertising.

## Documents ("Document Devourer")

- **Just sort it** (default): the file is read to suggest actions, then
  deleted once you finish. It's never kept more than 24 hours, even if you
  walk away. Its text is not stored.
- Suggestions the Goblin is confident about may be added for you straight
  away (with Undo). Others wait for your OK. You can switch on "Ask me
  before the Goblin changes anything" in Settings.
- **Keep this document:** the file is stored privately until you delete it.

## Talking to the Goblin (voice)

- Pocket Goblin never records or stores audio.
- When you use the microphone, **your browser's** speech service turns speech
  into text. In Chrome, Edge and Samsung Internet this usually happens on the
  browser maker's servers (e.g. Google); in Safari on Apple's servers or on
  your device, under their own terms. You're told this before first use, and
  you can always type instead.
- The words are used to carry out your request and are not stored as a
  transcript. We keep your Goblin preferences, any phrases you teach it,
  record ids for a few minutes (so "move them" works), and a
  duplicate-protection record of the reply for up to 2 days.
- Spoken replies use your device's built-in voices.
- Thoughts typed while offline are stored on your device until they're sent.

## AI processing

Pocket Goblin uses **Cloudflare Workers AI**: open models (Meta Llama) run by
Cloudflare as part of our hosting. Some requests are sent there:

- sorting a brain dump
- understanding what you typed
- reading the text, or a photo, of a document you upload

Everything else uses Pocket Goblin's own built-in rules. No other AI company
receives your content. External AI providers are switched off in production.

⚠️ Confirm and cite Cloudflare's current Workers AI data-handling terms
(retention, training) before publishing. **Deleting something in Pocket
Goblin does not delete copies a provider holds under its own terms.** See
`docs/DOCUMENT_PRIVACY.md`.

## Phone calendar link

If you add your Goblin calendar to your phone, the link contains a private
token. Anyone with the link can read those calendar entries, so you can
reset it at any time from the Calendar page.

## Service providers

- **Cloudflare:** hosting, database, file storage, AI models and email
  delivery.
- **Stripe:** payments. Card details go to Stripe and never reach Pocket
  Goblin.

## Your choices and rights

In Settings you can:

- **download all your data** (JSON)
- **change your password**
- **reset your Goblin's personalisation**
- **delete your account**, which permanently removes your data and kept
  files. Cancel a renewing subscription first.

You can also email support@pocketgoblin.org. ⚠️ Add jurisdiction-specific
rights wording (e.g. Australian Privacy Principles, GDPR / UK GDPR for
overseas customers), response times, and the lawful basis for processing.

## Retention

- Account data: kept until you delete your account.
- "Just sort it" originals: deleted when you finish, or within 24 hours.
- Voice duplicate-protection records: 2 days. Rate-limit counters: hours.
- ⚠️ Backups: Cloudflare D1 Time Travel keeps point-in-time restore data for
  a limited period. State that period.

## Children

⚠️ Minimum age.

## Changes

⚠️ How you'll notify users of changes.
