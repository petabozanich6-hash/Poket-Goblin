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
   ├── events, reminders, notes, shopping, search, history, dashboard
   ├── intelligence (interpret, breakdown, assist, memory)
   ├── documents (vault) + review (unified inbox) + connections (OAuth)
   ├── D1 (per-user row isolation)
   └── R2 UPLOADS (local Miniflare; remote needs approval)
```

## Source layout

```
src/           UI, features, design system
shared/        Types, brain-dump, intelligence, document extract rules
worker/        API routes and server libs (AI, storage, jobs)
migrations/    D1 SQL migrations
docs/          Product, architecture, intelligence, integrations, visual identity
```

## Multi-user isolation

- Every personal row includes `user_id`.
- Session middleware resolves the user before protected routes.
- Queries always filter by `user_id`.

## Intelligence (Sprint 3)

See `docs/INTELLIGENCE.md`.

- One engine for dump / breakdown / assist.
- Structured JSON validated server-side before any write path.
- Rule-based fallback when AI credentials are absent or fail.
- Daily per-user usage limits.
- User must confirm before mutations.

## Local development

- D1 runs locally via Wrangler (`--local`). No remote DB required.
- Secrets live in `.dev.vars` (gitignored). See `.dev.vars.example`.
- Do not provision paid Cloudflare resources without permission.

## Documents & integrations (Sprint 4)

See `docs/INTEGRATIONS.md`.

- Private object storage abstraction (`worker/lib/storage`)
- Document interpret rules in `shared/documents/extract.ts`
- Unified `review_items` inbox
- OAuth foundations without fake synced data

## Future

- Sprint 5: polish, security review, release prep
