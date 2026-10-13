# Architecture — Pocket Goblin

Independent ADHD-friendly life management app on Cloudflare.

## Stack

| Layer    | Choice                                                                |
| -------- | --------------------------------------------------------------------- |
| Frontend | React 19, TypeScript, Vite, React Router, TanStack Query, CSS Modules |
| API      | Cloudflare Workers + Hono (`/api/*`)                                  |
| Database | Cloudflare D1 (SQLite)                                                |
| Files    | Cloudflare R2 (Sprint 4 — local Miniflare; remote needs approval)     |
| Auth     | Email/password + httpOnly session cookies (PBKDF2 hashes)             |

## Topology

```
Browser (Vite SPA)
   │  /api/*  (dev proxy → :8787)
   ▼
Worker (Hono)
   ├── auth, me, categories, tasks, captures, plan
   ├── events, reminders, notes, shopping, search, history, dashboard
   ├── intelligence (interpret, breakdown, assist, memory)
   ├── documents + review + connections
   ├── magical (briefing, priorities, rescue, nudges, tiny-step, achievements)
   ├── D1 (per-user row isolation)
   └── R2 UPLOADS (local Miniflare; remote needs approval)
```

## Source layout

```
src/           UI, features, design system
shared/        Types, brain-dump, intelligence, documents, magical helpers
worker/        API routes and server libs
migrations/    D1 SQL migrations (0001–0005)
docs/          Product, architecture, UX audit, personality, integrations
```

## Multi-user isolation

- Every personal row includes `user_id`.
- Session middleware resolves the user before protected routes.
- Queries always filter by `user_id`.
- Document storage keys are user-scoped; downloads are authenticated.

## Magical layer (Sprint 5)

Pure helpers in `shared/magical/*` (briefing, prioritise, rescue, quiet hours, personality, tiny steps).  
Worker orchestration in `worker/lib/magical.ts` + `worker/routes/magical.ts`.  
Preferences extend `user_settings` (migration `0005_sprint5_magical.sql`).

Nudges are **in-app only**. No push/email delivery is claimed until configured and opted in.

## Intelligence (Sprint 3)

See `docs/INTELLIGENCE.md`.

## Documents & integrations (Sprint 4)

See `docs/INTEGRATIONS.md`.

## Inspection & QA (Sprint 6)

- Evidence-based audit: `docs/PRODUCT_AUDIT.md`
- Testing guide: `docs/TESTING.md`
- Security notes: `docs/SECURITY.md`
- Journey smoke: `npm run smoke:sprint6` (disposable users; does not wipe D1)
- Playwright: `npm run test:e2e` (Chromium; assumes local web+API)

## Local development

- D1 via Wrangler (`--local`). Apply migrations with `npm run db:migrate:local`.
- Secrets in `.dev.vars` (gitignored).
- Do not provision paid Cloudflare resources without permission.
- Do not reset local D1 without explicit permission.
