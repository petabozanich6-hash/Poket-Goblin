# Pocket Goblin: Cloudflare Workers AI model trials

**Status: OPT-IN ONLY. Do not change live variables as part of merging.**

We retain the Cloudflare Worker, D1 and R2 and the existing Llama 3.1 8B
fast model until better results are demonstrated. All model calls continue
through the same atomic per-user, per-minute and per-account daily AI request
reservations; one request makes one model call. No external API keys,
provider subscriptions, prompt logging or new data transfers.

## Candidate models

| Model                                 | Intended test                              | Input / output USD per 1M tokens |
| ------------------------------------- | ------------------------------------------ | -------------------------------- |
| `@cf/meta/llama-3.1-8b-instruct-fast` | Existing live baseline                     | Confirm exact price in billing   |
| `@cf/google/gemma-4-26b-a4b-it`       | Document interpretation                    | $0.10 / $0.30                    |
| `@cf/qwen/qwen3-30b-a3b-fp8`          | Document extraction and short organisation | $0.0509 / $0.335                 |
| `@cf/zai-org/glm-4.7-flash`           | Short text organisation                    | $0.0605 / $0.40                  |
| `@cf/openai/gpt-oss-20b`              | Structured reasoning                       | $0.20 / $0.30                    |

All rates are **published token pricing**, not proof of faster performance or an
invoice. Some models may have significant thinking-token overhead, latency or
format incompatibilities. Pricing and availability can change.

Primary sources:

- https://developers.cloudflare.com/workers-ai/models/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/workers-ai/features/json-mode/

## Opt-in settings

- `AI_MODEL` (existing): model for quick AI interpretation.
- `AI_DOCUMENT_MODEL` (new, optional): separate model for interpreting text
  extracted from documents. If unset, it inherits `AI_MODEL`.

Both accept only the reviewed model IDs in `workersAi.ts`; unknown IDs fail
closed. Neither is changed by this PR or introduced in `wrangler.toml`.
The existing vision-only photo/scan transcription model remains unchanged.

Cloudflare's JSON-mode supported-model list does not currently confirm
the four trial models. For trial models, JSON Mode is **not requested**; the
prompt asks for JSON and the application accepts only a valid JSON object,
optionally in a JSON code fence. Invalid, prose-wrapped or unparseable output
is rejected and the existing rule-based fallback remains available. Dates and
task suggestions still pass the existing grounding/validation safeguards.

## Manual acceptance test (only in an isolated test Worker)

Use **synthetic** input only, with a separate D1 test database and an agreed
small neuron allowance. Do not point a test Worker at production D1 or R2.

- Quick brain dump: three independent thoughts including a shopping item, a
  relative date and something to remember. Reject if any thought is dropped
  or an unstated deadline is fabricated.
- Document: sample assessment page with an exact deadline and a vague due
  week. Reject invented dates, invented account numbers or dropped tasks.
- Document: long mixed admin letter. Reject if essential obligations are
  missed, response is invalid JSON or inference times out.
- Failure: invalid model, provider timeout and malformed output should lead
  to the existing rule-based fallback and consume no _additional_ retry call.

For each model and baseline, record five repeated runs per fixture:
_total processing time, AI call time, answer validity, completeness, invented
dates, quality, reported token/neurons, and Cloudflare billable usage_.
Prefer model only when it is **at least as accurate** as baseline and
meaningfully better on latency, cost, or both. If quality falls, keep baseline.

## Rollback

Unset `AI_DOCUMENT_MODEL` to restore the existing general model for documents.
Unset `AI_MODEL` to restore the original Llama 8B fast model for every text
request. Confirm Cloudflare's actual runtime vars first and never overwrite
unrelated payment, email or domain configuration.

This PR is a routing and safety foundation. It is **not** an independently
verified live benchmark or claim of cost savings.
