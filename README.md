# Pocket Goblin

ADHD-friendly, goblin-themed life management — migrating from Floot to
GitHub, Cursor, and Cloudflare.

> Preparing the goblin's new home.

## Status

**Migration foundation.** The existing Floot application has not been imported
yet. This repository provides a React + TypeScript + Vite shell, tooling,
folder structure, Cloudflare preparation, and documentation so the real app
can land cleanly.

Do not expect product features here until the Floot source is migrated.

## Quick start

```bash
npm install
npm run dev
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for full setup.

## Documentation

| Doc                                                | Contents                                   |
| -------------------------------------------------- | ------------------------------------------ |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)       | Target stack, Workers / D1 / R2 evaluation |
| [docs/MIGRATION_PLAN.md](docs/MIGRATION_PLAN.md)   | Phased Floot → Cloudflare plan             |
| [docs/FLOOT_INVENTORY.md](docs/FLOOT_INVENTORY.md) | Required source, APIs, schemas, assets     |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)         | Local workflows and conventions            |

## Stack (foundation)

- React + TypeScript (strict) + Vite
- React Router
- TanStack React Query
- Lucide React
- CSS Modules
- ESLint + Prettier
- Cloudflare Workers / D1 / R2 (prepared, not provisioned)

## License

Private — commercial product in preparation. All rights reserved.
