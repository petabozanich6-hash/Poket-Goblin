# Pocket Goblin: manual AI model quality and cost check

This is a **manual test, not an AI change**. No production model
configuration, budget or hosted website is changed by this workflow.

On GitHub, open **Actions → Manually compare Pocket Goblin Workers AI
models → Run workflow**. Select Qwen, Gemma, GLM, existing baseline or all
four, then type `RUN` to confirm that a small real AI inference may be
billed by Cloudflare. The account must already have repository secrets
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` with permission to call
Workers AI. If either is unavailable, the script refuses to call any model.

The script uses only a fixed synthetic university assessment page. It does
not load documents, users or messages from D1 or R2 and does not save the
model's full output. It tests only the model's ability to return JSON with
grounded assessment deadlines and reports latency, missing deadlines and
unexplained dates. It's NOT a full test of Pocket Goblin's document
extraction, OCR or capacity-aware scheduling workflow.

Call count is at most four; a conservative projected gross token cost
of US$0.15 is the stopping threshold, not a guaranteed invoice amount.
The existing baseline's exact model price needs separate verification.
Cloudflare includes 10,000 free neurons per day; any inference above the
allowance can be charged separately.

**Promotion criteria:** pick a candidate only if it can return parseable
JSON, respects all named due dates, has no invented deadlines, doesn't drop
required obligations and meets or exceeds the current baseline on
document accuracy. Compare actual end-to-end processing latency before
choosing a production default. If the candidate fails, leave the existing
`AI_DOCUMENT_MODEL` unset.

References:

- https://developers.cloudflare.com/workers-ai/models/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/workers-ai/features/json-mode/
