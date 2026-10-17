# Workers AI cost and performance baseline (2026-10-17)

## Scope

This is measurement only. It does **not** replace a model, increase an AI quota,
enable an external provider, or make a production database change on merge.

The app measures each permitted Workers AI text or vision invocation:
model ID, modality, success/failure, elapsed model-call time, and input/output
token counts when Workers AI reports them. Text-only fallback estimates are
marked **approximate**, never presented as provider-reported usage. Image
token counts are not guessed from image bytes.

No prompts, responses, documents, filenames, names, emails or user IDs are
stored in `ai_inference_metrics`. The existing private Owner HQ AI & Costs
page shows model-level aggregates; no public endpoint is added.

## Deployment gate

1. Merge only after tests, TypeScript, lint, build and the migration-order check pass.
2. **Before expecting measurements in production**, back up D1 and use the
   existing approval-gated **D1 migrations (production)** workflow to apply
   `0019_ai_inference_metrics.sql`. It creates a new table and index only.
3. If code deploys before the migration, telemetry writes fail silently and the
   app's normal AI requests continue. Owner HQ shows a migration-pending message.
4. Verify a harmless text request and a sample image after migration; check
   Owner HQ > AI & Costs for call count, avg latency, token basis and model name.
5. Compare figures against Cloudflare Workers AI Analytics and Billable Usage;
   do not mistake gross model estimates for invoices.

## Pricing and limitations

- Rates come only from [Cloudflare's Workers AI pricing table](https://developers.cloudflare.com/workers-ai/platform/pricing/),
  and apply only to an **exact matching model ID**.
- `@cf/meta/llama-3.1-8b-instruct-fast`, the deployed Pocket Goblin model,
  is **unpriced in this app** until its current rate is explicitly verified.
  The similarly named `-fp8` model has a published price but is NOT an
  interchangeable price assumption.
- Vision inference remains unpriced because image token usage/rates are not
  established here.
- Gross priced-model estimates exclude Cloudflare's daily free allocation,
  infrastructure, taxes and adjustments. The Cloudflare bill is authoritative.
- The baseline only starts once the table exists; it does not reconstruct
  earlier traffic or claim the account-level neuron total belongs to one app.
- Means are approximate averages of observed call durations, not promises
  of speed or complete end-to-end document processing time.

## Next experiment

Run a small, repeatable benchmark with synthetic documents (ordinary bill,
short university guide, long study outline, scanned letter), noting median
and p95 duration, accuracy and missed dates. Only then propose model or
prompt changes in a **separate** PR with cost and privacy approval.
