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
- [Roadmap](docs/ROADMAP.md)

## Status

Sprint 1 core application is implemented against a **local** D1 database.
No production deploy. No paid Cloudflare resources provisioned.
