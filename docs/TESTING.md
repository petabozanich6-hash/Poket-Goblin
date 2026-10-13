# Testing — Pocket Goblin

## Principles

- Do not reset the developer’s local D1 database in routine tests.
- Disposable users (`s6_*@example.com`, smoke accounts) are created instead.
- Do not claim browser tests passed unless they actually ran.
- Distinguish rule-based behaviour from AI that needs credentials.

## Commands

| Command                                 | What it does                                                        |
| --------------------------------------- | ------------------------------------------------------------------- |
| `npm test`                              | Vitest unit tests (shared + worker libs)                            |
| `npm run check`                         | typecheck, lint, prettier, unit tests, production build             |
| `npm run smoke:local` … `smoke:sprint5` | Historical sprint API smokes                                        |
| `npm run smoke:sprint6`                 | Full journey A–F API integration (needs API on `:8787`)             |
| `npm run test:e2e`                      | Playwright browser journeys (needs web+API; installs Chromium once) |

## Journey coverage (`smoke:sprint6`)

- **A** First-time user: register → capture → accept → search → complete → logout/login persist
- **B** Chaotic brain dump multi-item accept/reject
- **C** Goblin mode, tiny step, rescue dismiss without silent accept
- **D** Life admin records + search + den summary
- **E** Document upload / search / cross-user deny / delete
- **F** Multi-user isolation + anonymous 401

## Unit tests of note

- `shared/magical/magical.test.ts` — briefing, rescue, quiet hours, tiny steps
- `shared/brainDump.test.ts` / `shared/intelligence/*` — extract rules
- `worker/lib/rateLimit.test.ts` — auth throttle buckets
- `worker/lib/documents/validateUpload.test.ts` — file validation

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs `typecheck`, `lint`, `format:check`, `test`, `build` on `main` and `development`.

API smokes and Playwright are **local/manual** (need Wrangler + D1). Optional future job can start `wrangler dev` in CI if desired.

## Browser verification

Sprint 6 also exercised the Den UI in a real browser (briefing, overwhelm, navigation). Prefer Playwright for repeatable UI regression once Chromium is installed:

```bash
npx playwright install chromium
npm run dev   # separate terminal
npm run test:e2e
```
