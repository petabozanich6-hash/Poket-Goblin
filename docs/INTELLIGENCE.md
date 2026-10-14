# Goblin intelligence (Sprint 3, hardened in Sprint 8)

Central organisation engine used by brain dump, breakdown, planning helpers, and Ask the goblin.

## Principle

The user provides the thought. The goblin proposes organisation. **Nothing is written to life data until the user confirms.**

## Modes

| Mode             | When                                                                        |
| ---------------- | --------------------------------------------------------------------------- |
| `rules`          | Default. Labelled heuristic engine in `shared/intelligence`.                |
| `ai`             | Structured interpret via OpenAI-compatible API when Worker secrets are set. |
| `ai_unavailable` | Credentials present but call failed / invalid JSON — falls back to rules.   |

Assistant free-form answers are **always grounded** in the current user’s stored rows. They do not invent tasks, appointments, or prior chats.

## Brain dump pipeline (Sprint 8)

1. **Save first.** `POST /api/captures` stores the raw text before any
   organising. If the AI fails, times out, returns junk, or the daily limit is
   reached, the words are still there and fall back to rules or a single
   "sort later" note.
2. **Interpret.** With AI configured, the model gets the user's local date
   (from the browser's `timezoneOffsetMinutes`) and must return one suggestion
   per distinct thought, each with a verbatim `sourceReference`.
3. **Ground** (`shared/intelligence/grounding.ts`). Each suggestion is matched
   to the user's own words:
   - Relative days ("Friday", "tomorrow") are recalculated deterministically.
   - Explicit dates ("3 November", "20/10") are kept only if the words name
     that exact day.
   - Vague timing ("next week", "next month", "soon") never gets a date.
   - Times and repeats are kept only if stated.
   - Anything removed marks the item `uncertain`, with a `missingInformation`
     note.
4. **Cover.** Thoughts the rule engine finds but the model skipped are added
   back, flagged "The AI skipped this part".
5. **De-duplicate.** Repeats inside one dump are merged. Items matching an
   open task or unticked shopping item are flagged `possibleDuplicateOf`.
   Re-sending the same dump within two minutes returns the first review.
6. **Review.** Nothing touches life data until the user taps Keep (Capture) or
   Accept (Inbox). Accepting atomically claims the suggestion, so a double-tap
   or accepting in both places creates one record. Accepting a likely duplicate
   returns `409` unless the user explicitly chooses "Add again"
   (`allowDuplicate: true`).

Usage is counted only when the paid provider is actually called. Over the daily
limit, brain dumps keep working on the rule engine instead of failing.

## Activate real AI (needs approval: paid service)

AI stays off until someone with authority approves a provider and its cost.
Production needs Worker secrets (never commit them):

```bash
npx wrangler secret put AI_PROVIDER     # openai_compatible
npx wrangler secret put AI_API_KEY      # provider key
npx wrangler secret put AI_MODEL        # optional, default gpt-4o-mini
npx wrangler secret put AI_BASE_URL     # optional, default https://api.openai.com/v1
npx wrangler secret put AI_DAILY_USER_LIMIT   # optional, default 40
```

Any OpenAI-compatible `/chat/completions` endpoint that supports
`response_format: {"type":"json_object"}` works. `GET /api/intelligence/status`
reports whether AI is configured.

Local development uses `.dev.vars` (never commit secrets):

```
AI_PROVIDER=openai_compatible
AI_API_KEY=...
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
AI_DAILY_USER_LIMIT=40
```

Without these, the app remains fully usable on the rule-based brain.

## Cost controls

- Per-user daily request counter in `ai_usage_daily`
- Enforced before interpret / breakdown / assist
- Malformed AI JSON is rejected (`validateSuggestions`)

## Privacy

- Session auth required
- Queries scoped by `user_id`
- Minimal context only for assistant grounding
- User text treated as data (prompt-injection fence on assist)
- User-controlled `user_memory` with list + delete

## Endpoints

- `GET /api/intelligence/status`
- `POST /api/intelligence/interpret`
- `POST /api/intelligence/breakdown`
- `POST /api/intelligence/breakdown/accept`
- `POST /api/intelligence/assist`
- `GET|POST /api/intelligence/memory`
- `DELETE /api/intelligence/memory/:id`
- `POST /api/intelligence/follow-up/accept`

Brain dump (`POST /api/captures`) routes through the same interpret engine.
