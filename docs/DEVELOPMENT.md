# Development — Pocket Goblin

## Prerequisites

- Node.js 20+
- npm 10+ (ships with Node)
- Git

Optional (later, for Worker local runs):

- Cloudflare account (free tier is enough to start)
- Wrangler CLI (`npm i -D wrangler` when you begin API work)

## First-time setup

```bash
git clone <repo-url>
cd Poket-Goblin
git checkout development
cp .env.example .env.local
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Scripts

| Command                | Purpose                                    |
| ---------------------- | ------------------------------------------ |
| `npm run dev`          | Vite dev server (port 5173)                |
| `npm run build`        | Typecheck + production SPA build → `dist/` |
| `npm run preview`      | Serve the production build locally         |
| `npm run typecheck`    | TypeScript project references check        |
| `npm run lint`         | ESLint                                     |
| `npm run lint:fix`     | ESLint with autofix                        |
| `npm run format`       | Prettier write                             |
| `npm run format:check` | Prettier check                             |
| `npm run check`        | typecheck + lint + format + build          |

## Project structure

```
├── .github/workflows/   CI checks
├── docs/                Architecture & migration docs
├── migrations/          Future D1 SQL (empty until schema inventory)
├── public/              Static public files
├── src/
│   ├── app/             Providers + router
│   ├── assets/          Media (import from Floot)
│   ├── components/      Shared UI
│   ├── features/        Domain modules
│   ├── hooks/
│   ├── lib/             Query client, helpers
│   ├── pages/           Route screens
│   ├── styles/          Global CSS
│   └── types/
├── worker/              Cloudflare Worker API placeholder
├── wrangler.toml        Cloudflare config (bindings commented out)
├── .env.example         Public Vite env template
└── .dev.vars.example    Worker secrets template
```

## Path alias

Use `@/` for imports from `src/`:

```ts
import { queryClient } from '@/lib/queryClient'
```

## CSS Modules

Co-locate styles as `Component.module.css` and import:

```ts
import styles from './Component.module.css'
```

Class names are exported in camelCase (`localsConvention: 'camelCaseOnly'`).

## Environment variables

- **Client:** `VITE_*` only — see `.env.example`. Copy to `.env.local`.
- **Worker secrets:** `.dev.vars` (gitignored) — see `.dev.vars.example`.
- Never commit real keys.

## Cloudflare local notes

Infrastructure is **not** provisioned in this foundation.

- `wrangler.toml` documents intended D1/R2 bindings (commented out).
- `worker/index.ts` returns a foundation JSON stub only.
- When API work starts: install Wrangler, uncomment bindings after creating
  resources, and keep migrations reviewed before applying.

See `docs/ARCHITECTURE.md` for Workers / D1 / R2 evaluation.

## Branching

- `main` — stable / release-ready
- `development` — active migration foundation and ongoing work

Open PRs into `development` (or `main` per team preference once set).

## CI

GitHub Actions workflow `.github/workflows/ci.yml` runs on pushes and PRs:

1. `npm ci`
2. `npm run typecheck`
3. `npm run lint`
4. `npm run format:check`
5. `npm run build`

## Coding guidelines for migration

- Prefer moving Floot code over rewriting it.
- Do not invent dashboards or mock product APIs.
- Keep ADHD-friendly UX and goblin theme intact.
- Match existing naming when importing Floot modules.
- Document discoveries in `docs/FLOOT_INVENTORY.md`.
