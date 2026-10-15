# Documents: what Pocket Goblin keeps, and for how long

This describes how the code behaves (the Document Devourer, migration `0007`).
Public privacy wording must match it. Nothing here is a legal claim. Have the
privacy policy reviewed before launch.

## Two choices, made per upload

| Choice                     | Original file                                                                                                             | Extracted text    | Suggestions                                                           | Counts towards storage |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------- | ---------------------- |
| **Just sort it** (default) | Held privately under `tmp/` in R2 while you review, then deleted. Never kept longer than **24 hours**, even if abandoned. | **Never stored**  | Deleted with the document (approved items become your own tasks etc.) | No                     |
| **Keep this document**     | Kept in your private vault until you delete it                                                                            | Stored for search | Kept until reviewed or the document is deleted                        | Yes                    |

**Just sort it** in detail:

1. The record is written first and the file stored second. An upload
   interrupted part-way leaves a record with an expiry, never an untracked
   file.
2. The file is read, and suggestions are created for you to approve. Nothing
   becomes a task, reminder or calendar entry until you say yes.
3. **Done**, **Cancel**, a processing failure, or the 24-hour expiry deletes:
   the original file, every suggestion (approved, skipped or pending),
   extracted facts, internal links, and the document record. The tasks,
   reminders and calendar entries you approved stay. They are yours, and
   deleting a document never deletes them.
4. An hourly job (Cloudflare Cron Trigger) and every new upload sweep up
   anything past its expiry. If a file can't be deleted, the expiry stays and
   the next run retries.
5. Logs record counts and error types only, never file names, contents or
   suggestions.

**Recommended backstop (owner action, free):** add an R2 lifecycle rule on
the `pocket-goblin-uploads` bucket that deletes objects under the `tmp/`
prefix after 2 days. Go to Cloudflare → R2 → `pocket-goblin-uploads` →
Settings → Object lifecycle rules. If the application ever failed to clean
up, storage would still not keep temporary originals.

## Who else sees a document

- **Cloudflare** stores and processes everything as Pocket Goblin's
  infrastructure provider (Workers, D1, R2).
- **The AI provider**, only when one is configured (`AI_PROVIDER` /
  `AI_API_KEY`). The production deployment currently has none, and the
  built-in reader runs inside Pocket Goblin. When configured:
  - Text documents: up to 12,000 characters of extracted text are sent.
  - Photos and scans: the image is sent, because only a vision model can read
    it.
  - Requests ask the provider not to store the exchange (`store: false`).
  - Deleting a document in Pocket Goblin **does not** delete copies the
    provider may hold under its own terms.

### OpenAI API (the default `openai_compatible` endpoint), as published

- API inputs and outputs are **not used to train** OpenAI models by default.
- Abuse-monitoring logs are kept for **up to 30 days**, longer only if the law
  requires it or to protect the service or third parties from harm.
- **Zero Data Retention** or Modified Abuse Monitoring is available only to
  eligible customers **with OpenAI's prior approval**.

Source: [OpenAI — Your data](https://developers.openai.com/api/docs/guides/your-data).
Check the current wording before relying on it, and record in the privacy
policy which provider and which retention terms actually apply.

**Do not claim** "zero retention" or "deleted everywhere" unless a Zero Data
Retention agreement (or equivalent) is actually in place for the configured
provider.

## Safety of what is read

- Documents are untrusted. The built-in reader only pattern-matches. The AI
  prompt fences the document as data and says to ignore instructions inside
  it.
- AI output is validated: only task, reminder, appointment, note or follow-up
  suggestions; bounded counts and lengths; real dates; and dates must be
  written in the document.
- Nothing is paid, submitted, signed or shared. Suggestions are only created
  after the user approves them.
- Limits:
  - 10 MB per file, with types checked by content, not just the extension
  - at most 10 documents waiting for review
  - a daily processing cap per plan
  - kept-storage allowance per plan (Premium 1 GB by default)
