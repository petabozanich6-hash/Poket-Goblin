# Cloudflare-hosted AI for Pocket Goblin

Status: **active in production since 2026-10-15** (enabled in the Cloudflare
dashboard: `AI` binding, `AI_PROVIDER=workers_ai`, the model below, and
`AI_DAILY_GLOBAL_LIMIT`). Those settings are now also in `wrangler.toml`, so
automatic deploys from `main` keep them. The platform-wide cap started at 5
calls a day while AI was being verified. That ran out in normal use and sent
every document to the built-in reader, so it is now 300 a day (about a tenth
of a cent per document read). Each person's own daily limit still applies. Local `npm run dev` passes
`AI_PROVIDER=none`, so no remote inference happens locally.

Previous status: implemented for review, **not activated or deployed**. Production is
built automatically from `main`; do not merge this change until deployment is
approved. No production migration, binding change or live inference is part of
preparing this change.

## What this connects

Set `AI_PROVIDER=workers_ai` to use the native `AI` binding. No OpenAI key or
Cloudflare API token is needed inside the app. Existing `openai_compatible` and
rules providers remain available; a Workers AI failure never switches to an
external provider.

- Tell the Goblin / structured interpretation: AI suggestions pass through the
  existing validation, source grounding and review-before-save flow.
- Document Devourer: readable text uses the same binding, with existing document
  validation. Photos and scanned PDFs still require OCR; this text model is not
  a vision model. No image is sent to it.
- Assistant chat and task breakdown retain their existing labelled rule engines.

The selected model is `@cf/meta/llama-3.1-8b-instruct-fp8`. It supports JSON mode
and is explicitly allowlisted; an unsupported `AI_MODEL` leaves the app on rules.
Use one small model initially, with no automatic upgrades or retries. Model
quality still needs staging checks with representative, non-sensitive examples.

## Controls

| Control            | Behaviour                                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Global daily calls | `AI_DAILY_GLOBAL_LIMIT`, default 100 per UTC day; 0 disables calls                                                                             |
| Global burst       | 20 reservations per fixed UTC minute                                                                                                           |
| User burst         | 5 reservations per fixed UTC minute                                                                                                            |
| User daily calls   | Existing Goblin HQ plan limits, including Owner; defaults are 40 for free/premium, 200 for Owner, with the global ceiling applying to everyone |
| Input              | Maximum 16,000 UTF-8 bytes including system prompt; oversized input falls back to rules                                                        |
| Output             | Maximum 1,024 generated tokens                                                                                                                 |
| Timeout            | 12 seconds, no retry; binding inference may continue and be billed                                                                             |
| Master switch      | Goblin HQ AI provider feature switch, or `AI_PROVIDER=none`                                                                                    |

Migration `0009_workers_ai_limits.sql` adds database-backed atomic reservations.
Each gate is reserved before inference, across Worker instances and features.
Database errors or a missing migration prevent inference and use fallback.
Failed/timed-out calls are not refunded. A later gate rejection can consume an
earlier reservation: deliberately conservative, so available calls may be lower
than the configured limit. Fixed minute windows can permit bursts on either side
of a minute boundary. The daily ceiling remains in force.

The table keeps two rows per user (deleted with their account) and two global
rows; windows reset in place. It contains no prompts or responses. Existing
`ai_usage_daily` records actual attempted calls; the reservation counters can be
higher and are authoritative for admission. Existing usage checks may also
restrict calls sooner. These new distributed controls apply to Workers AI;
the legacy external provider retains its previous controls.

These are application request limits, not an account-wide dollar billing cap.
Other Workers, playground calls and API calls do not pass through this code.
Do not enable prompt logging or AI Gateway caching for personal documents.

## Cost planning

Cloudflare's model page on 15 October 2026 lists USD $0.152 per million input
tokens and $0.287 per million output tokens. A request with 2,000 input and 800
output tokens is approximately $0.000534. At 100 such calls every day, that is
about $1.60 for a 30-day month before any free allowance, excluding other
Cloudflare services. This is an example, not a guaranteed bill; longer inputs
cost more. Check current prices and the account's Workers AI usage dashboard
before activation. Do not assume a paid plan stops at the free allowance.

Sources:

- [Model and pricing](https://developers.cloudflare.com/workers-ai/models/llama-3.1-8b-instruct-fp8/)
- [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [Workers bindings](https://developers.cloudflare.com/workers-ai/configuration/bindings/)
- [JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/)

## Dashboard configuration (when deployment is approved)

1. Start with a separate staging Worker and staging D1/R2 resources. Do not copy
   the production resource IDs from `wrangler.toml` into a staging deployment.
   Keep the provider disabled until the schema and binding are ready.
2. Apply migration 0009 to the selected environment. Production migrations must
   use the existing approval-gated workflow documented in `D1_MIGRATIONS.md`.
3. In Cloudflare, open **Workers & Pages → the selected Worker → Bindings → Add
   binding → Workers AI**. Name the binding **AI**, exactly. Save it as part of
   the approved configuration/deployment. It is a resource binding, not a secret
   or plain text variable. Dashboard labels may vary slightly.
4. In **Settings → Variables and Secrets**, add the plain text variables below.
   Leave `AI_PROVIDER=none` until ready for the first staging check. Do not set
   `aiRequest`; that context is created internally from the authenticated user.
5. Keep the repository configuration in sync: uncomment `[ai]` / `binding = "AI"`
   at the end of `wrangler.toml` in the approved configuration, and add the
   variables under its **existing** `[vars]` table (not after `[dev]`). Wrangler
   configuration can replace dashboard variables on a later deployment.

```toml
# Add under the existing [vars] table:
AI_PROVIDER = "workers_ai"
AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8"
AI_DAILY_GLOBAL_LIMIT = "100"

# Separate top-level table:
[ai]
binding = "AI"
```

Use a much smaller staging global limit, such as `5`, for initial checks.
`AI_API_KEY` and `AI_BASE_URL` are unused by Workers AI. Keep existing unrelated
bindings and settings intact. Do not change the domain, DNS or routes.

## Verify before production approval

Automated tests use a mock AI binding and the real SQLite schema; they never
make billable inference calls. Run `npm run typecheck`, `npm run lint`,
`npm test`, `npm run build`, and the Worker deployment dry run.

Once staging inference is authorized and configured:

1. Sign in; check `/api/intelligence/status` reports `workers_ai` and the selected
   model. This confirms configuration only, not successful inference.
2. Submit “Call mum tomorrow. Buy milk.” Verify `mode: ai`, `provider: workers_ai`,
   the local date, and review before saving. Check no unrelated items appear.
3. Upload a harmless text document and check suggestions and provider metadata.
   Try a photo: it should ask for OCR, without making a Workers AI call.
4. Lower the global budget and exhaust it; subsequent inputs must still work
   through the labelled fallback. Test the Goblin HQ AI switch similarly.
5. Check Cloudflare Workers AI usage for actual calls and costs, without logging
   user content. Only then seek approval for production migration, merge,
   configuration activation and a production smoke test.

Rollback: switch `AI_PROVIDER` to `none`, or disable the AI provider in Goblin HQ.
In-flight calls may finish. Leave the additive quota table in place; no destructive
rollback migration is required. Local `wrangler dev` with an AI binding can use
remote GPUs and incur charges; normal local tests should keep the provider off.
