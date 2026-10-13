# Goblin intelligence (Sprint 3)

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

## Activate real AI (optional)

In `.dev.vars` (never commit secrets):

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
