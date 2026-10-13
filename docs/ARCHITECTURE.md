# Architecture — Pocket Goblin

Independent ADHD-friendly life management app on Cloudflare.

## Stack

| Layer    | Choice                                                                |
| -------- | --------------------------------------------------------------------- |
| Frontend | React 19, TypeScript, Vite, React Router, TanStack Query, CSS Modules |
| API      | Cloudflare Workers + Hono (`/api/*`)                                  |
| Database | Cloudflare D1 (SQLite)                                                |
| Files    | Cloudflare R2 (Sprint 4 — not provisioned)                            |
| Auth     | Email/password + httpOnly session cookies (PBKDF2 hashes)             |

## Topology

```
Browser (Vite SPA)
   │  /api/*  (dev proxy → :8787)
   ▼
Worker (Hono)
   ├── auth, me, categories, tasks, captures, plan
   └── D1 (per-user row isolation)
```

## Source layout

```
src/           UI, features, design system
shared/        Types + deterministic brain-dump interpreter
worker/        API routes and server libs
migrations/    D1 SQL migrations
```

## Multi-user isolation

- Every personal row includes `user_id`.
- Session middleware resolves the user before protected routes.
- Queries always filter by `user_id`.

## Brain dump (Sprint 1)

Deterministic heuristics in `shared/brainDump.ts` — not AI.

- Suggests kind / category / date only from cues in the text.
- Never invents dates without recognizable language.
- User must accept suggestions before tasks are created.

AI provider abstraction arrives in Sprint 3.

## Local development

- D1 runs locally via Wrangler (`--local`). No remote DB required.
- `AUTH_SECRET` lives in `.dev.vars` (gitignored).
- Do not provision paid Cloudflare resources without permission.

## Future

- Sprint 2: calendar, reminders, notes, shopping, search
- Sprint 3: AI organisation + natural language
- Sprint 4: R2 documents + integrations
- Sprint 5: polish, security review, release prep
