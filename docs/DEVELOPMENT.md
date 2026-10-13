# Development — Pocket Goblin

## Prerequisites

- Node.js 20+
- npm 10+

## Setup

```bash
git checkout development
cp .dev.vars.example .dev.vars   # set AUTH_SECRET
npm install
npm run db:migrate:local
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:8787/api/health

Vite proxies `/api` to the Worker.

## Scripts

| Command                                 | Purpose                                  |
| --------------------------------------- | ---------------------------------------- |
| `npm run dev`                           | Web + API together                       |
| `npm run db:migrate:local`              | Apply D1 migrations locally              |
| `npm run test`                          | Vitest                                   |
| `npm run check`                         | typecheck + lint + format + test + build |
| `npm run typecheck` / `lint` / `format` | Individual gates                         |

## First user journey (manual)

1. Open `/welcome` and create an account (any email/password — local only).
2. Dump a thought on the Den or Capture page.
3. Accept a suggestion → appears in Tasks.
4. Choose capacity on Plan → rebuild today’s shortlist.
5. Complete a task from the Den or Tasks.

## Design system

- Tokens: `src/styles/tokens.css` (light/dark + reduced motion)
- Mascot: `src/components/goblin/GoblinMascot.tsx`
- UI primitives: `src/components/ui/*`

## Security notes

- Never commit `.dev.vars` or real secrets.
- Passwords are PBKDF2-hashed server-side.
- Sessions are httpOnly cookies.
- No personal data of the original developer is hardcoded.
