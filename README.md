# Pocket Goblin

Your brain has enough tabs open. Let the goblin handle it.

ADHD-friendly personal life management — whimsical, calm, and built to do the
organisational thinking for you.

## Quick start

```bash
cp .dev.vars.example .dev.vars
npm install
npm run db:migrate:local
npm run dev
```

Open http://localhost:5173 — you should see Register / Sign in, then the Den.

If an old “coming soon” page appears, a stale Vite process is probably still
bound to port 5173. Stop it, run `rm -rf node_modules/.vite`, then `npm run dev` again.

## Stack

React + TypeScript + Vite · Cloudflare Workers · D1 · CSS Modules

## Docs

- [Product](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Development](docs/DEVELOPMENT.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Production D1 migrations](docs/D1_MIGRATIONS.md)
- [Roadmap](docs/ROADMAP.md)

## Status

Production domain: **https://pocketgoblin.org** — one Worker (`pocket-goblin`)
serves the React app and the `/api/*` routes. See [Deployment](docs/DEPLOYMENT.md).
Deploys are manual and approval-gated. No paid Cloudflare resources are
provisioned by this repository.
