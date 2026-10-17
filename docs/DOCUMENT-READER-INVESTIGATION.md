# Document reader: rules first and live fallback investigation

Investigated main commit 12434c8 (17 October 2026). The user confirmed that the PDF produced correctly allocated study tasks and calendar entries despite the AI fallback warning. This establishes successful rules processing, not an AI failure diagnosis.

## Routing change

Run text understanding and deadline/module planning before deciding to call AI. Skip text AI when the rules produce a recognised study pathway, or a recognised document with at least one high-confidence action and no low-confidence, uncertain or incomplete actions. These are routing heuristics, not proof that every detail was extracted. Unknown or ambiguous text retains the existing bounded AI attempt and rules fallback. Photos/scans retain the existing vision path. No expected savings percentage is claimed without representative upload measurements.

Study tasks still require pathway approval; ordinary rule actions still obey existing autonomy settings and Undo. AI suggestions still require review. Temporary text retention, tenant isolation, production external-provider blocking, cost gates and model defaults are unchanged. No existing uploads are reprocessed.

## What the warning actually means

`worker/lib/documents/processDocument.ts` emits the same warning after a thrown AI exception or failed `validateDocumentAi` validation. `WorkersAiBlockedError` also enters this branch, even when no inference occurred. Thus the warning can mean a budget/configuration block, transport/provider failure, 20-second timeout, malformed/empty/oversized response, or unusable document schema. It does not distinguish these cases.

The early daily-usage gate, disabled AI and missing general provider configuration skip the call without this warning. Later atomic minute/day/global/free-tier reservations can block a call and still produce it. Reservation database errors are also collapsed into a budget-unavailable exception. No specific cause can be ranked confidently from the warning alone.

## Configuration and history

Checked-in production configuration selects Workers AI and `@cf/meta/llama-3.1-8b-instruct-fast`. `AI_DOCUMENT_MODEL` can override the document model; an invalid override fails closed. Actual deployed values and binding presence have not been verified. `gpt-4o-mini` is only the compatible HTTP provider default, not the checked-in production route; that external route is disabled in production.

Commit a46bb7c records an earlier slow fp8-model investigation and switches to the fast model plus a 20-second document timeout. Those historical measurements do not prove the current warning is a timeout. PR #41 added optional document-model selection and strict JSON parsing without changing the default. PR #46 improved standalone module planning; PR #48 fixed calendar display and accepted proposals. The new rules-first routing avoids paying for an interpretation the module planner would replace anyway.

## Evidence and coverage

GitHub Actions run 38997559069 reports successful typecheck, lint, format, tests, production build and Worker dry-run steps. CI validates code, not live provider health. Document integration tests simulate HTTP failure and valid AI output; Workers AI tests cover parsing, model routing and budget behaviour. The study browser workflow starts local development with AI disabled. No production document content, credentials or runtime logs were retrieved in this investigation.

New regressions check zero provider calls and zero AI usage/reservations for a clear bill (the separate monthly document allowance remains), temporary-text privacy, and study proposals remaining in review without tasks being created. Existing AI safety tests use an ambiguous document so the AI branch remains exercised.

## Evidence needed for the original incident

- Approximate upload timestamp with timezone and deployed Worker version/commit.
- Non-secret effective `AI_PROVIDER`, `AI_MODEL`, optional `AI_DOCUMENT_MODEL`, and confirmation that the AI binding exists. Do not provide keys or environment dumps.
- Sanitized processing metadata: status, mode and warning codes/text only. Omit document text, filename, summary, suggestions and user identifiers.
- Cloudflare Workers/Workers AI metadata for that request: request/correlation ID, selected model, whether inference started, elapsed time, error category/provider numeric code or HTTP status, and whether a budget gate blocked it. No prompt, response body, authorization headers, cookies or uploaded bytes.
- Aggregate `ai_events` outcome and applicable budget state at that time, if available. These events store only coarse outcomes; they cannot distinguish a timeout from invalid JSON or a block.

The current catch discards the underlying exception, so existing Worker logs may not contain the needed detail. If historical metadata is unavailable, reproduce with a synthetic, non-sensitive document and capture only allowlisted error categories and timing. Do not enable prompt logging or upload the user's original PDF just for diagnosis.
