# Pocket Goblin Privacy Policy (DRAFT)

> **Draft for professional legal review. Not published.** It describes how the
> software behaves as of the `feat/launch-essentials` branch. Fill in every item
> marked ⚠️ before publication. Nothing here claims compliance with any law.

**Operator:** Peta Bozanich, trading as Pocket Goblin (ABN 54 938 519 819)
**Contact:** support@pocketgoblin.org
**Effective date:** ⚠️

## What we collect

| Data                              | Why                                                        | Where         |
| --------------------------------- | ---------------------------------------------------------- | ------------- |
| Email, display name               | Your account, sign-in, account emails                      | Cloudflare D1 |
| Password                          | Sign-in. Stored only as a salted PBKDF2 hash               | Cloudflare D1 |
| What you give the goblin          | Tasks, notes, brain dumps, calendar, lists, reminders      | Cloudflare D1 |
| Documents you choose to keep      | Your private vault                                         | Cloudflare R2 |
| Sign-in sessions, security events | Keeping your account safe (no IP addresses stored)         | Cloudflare D1 |
| Usage counts                      | Fair-use limits and service health (counts, never content) | Cloudflare D1 |

We do not sell personal information or use it for advertising.

## Documents ("Document Devourer")

- **Just sort it** (default): the file is read to suggest actions, then
  deleted once you finish. It's never kept more than 24 hours, even if you
  walk away. Its text is not stored. Only the items you approve are saved.
- **Keep this document:** the file is stored privately until you delete it.

## Talking to the Goblin (voice)

- Pocket Goblin never records or stores audio.
- When you use the microphone, **your browser’s** speech service turns speech
  into text. In Chrome, Edge and Samsung Internet this usually happens on the
  browser maker’s servers (e.g. Google); in Safari on Apple’s servers or on
  your device, under their own terms. You’re told this before first use, and
  you can always type instead.
- The words are used to carry out your request and are not stored as a
  transcript. We keep your Goblin preferences, any phrases you teach it, record
  ids for a few minutes (so “move them” works), and a duplicate-protection
  record of the reply for up to 2 days.
- Spoken replies use your device’s built-in voices.
- Thoughts typed while offline are stored on your device until they’re sent.

## AI processing

⚠️ State which AI provider is configured. Currently none: production uses
Pocket Goblin's built-in rules. If a provider is enabled, the text of what you
submit (or the image, for photos) is sent to that provider to generate
suggestions. Under OpenAI's published API terms, for example, API data is not
used for training by default and may be kept for up to 30 days for abuse
monitoring. **Deleting something in Pocket Goblin does not delete copies a
provider holds under its own terms.** See `docs/DOCUMENT_PRIVACY.md`.

## Service providers

- Cloudflare (hosting, database, file storage, email delivery)
- ⚠️ AI provider, if enabled
- ⚠️ Stripe (payments, once billing launches): card details go to Stripe and
  never reach Pocket Goblin

## Your choices and rights

In Settings you can:

- **download all your data** (JSON)
- **change your password**
- **delete your account**, which permanently removes your data and kept files

You can also email support@pocketgoblin.org. ⚠️ Add jurisdiction-specific
rights wording (e.g. GDPR / UK GDPR, Australian Privacy Principles), response
times, and the lawful basis for processing.

## Retention

- Account data: kept until you delete your account.
- "Just sort it" originals: deleted when you finish, or within 24 hours.
- ⚠️ Backups: Cloudflare D1 Time Travel keeps point-in-time restore data for
  a limited period. State that period.

## Children

⚠️ Minimum age.

## Changes

⚠️ How you'll notify users of changes.
