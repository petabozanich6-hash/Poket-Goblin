# Architecture — Pocket Goblin

This document describes the target architecture for the migrated application
(GitHub + Cursor + Cloudflare). It does **not** invent product features; those
come from the existing Floot application.

## Goals

- Preserve the existing React + TypeScript frontend stack.
- Host a globally distributed API and static assets on Cloudflare.
- Keep secrets out of the client bundle.
- Support commercial readiness: auth, uploads, integrations, observability.

## High-level topology

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (Vite React SPA)                                   │
│  React Router · TanStack Query · Lucide · CSS Modules       │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTPS
┌───────────────────────────▼─────────────────────────────────┐
│  Cloudflare                                                 │
│  ┌─────────────────┐  ┌──────────────┐  ┌────────────────┐ │
│  │ Workers (API)   │  │ D1 (SQLite)  │  │ R2 (objects)   │ │
│  │ + static assets │  │ relational   │  │ docs / media   │ │
│  └─────────────────┘  └──────────────┘  └────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Frontend

| Concern      | Choice                         | Notes                                                    |
| ------------ | ------------------------------ | -------------------------------------------------------- |
| Build        | Vite                           | Matches modern React tooling; SPA output in `dist/`      |
| UI           | React 19 + TypeScript (strict) | Aligns with Floot stack                                  |
| Routing      | React Router                   | Preserve route patterns from Floot where possible        |
| Server state | TanStack React Query           | Cache / mutations for API calls                          |
| Icons        | Lucide React                   | Already used in the Floot app                            |
| Styles       | CSS Modules                    | Co-located `*.module.css`; no invented design system yet |

### Source layout (`src/`)

| Path          | Purpose                                              |
| ------------- | ---------------------------------------------------- |
| `app/`        | Providers, router shell                              |
| `pages/`      | Route-level screens (temporary landing only for now) |
| `components/` | Shared presentational UI (import from Floot)         |
| `features/`   | Domain modules (tasks, auth, capture, etc.)          |
| `hooks/`      | Shared React hooks                                   |
| `lib/`        | Query client, API helpers, utilities                 |
| `types/`      | Shared TypeScript types                              |
| `styles/`     | Global CSS only                                      |
| `assets/`     | Images / static media from Floot                     |

Feature code should land under `features/<domain>/` during migration to keep
boundaries clear without rewriting product behaviour.

## Backend (Cloudflare)

### Workers — recommended API host

**Role:** HTTP API, auth session handling, AI proxying, email webhooks,
background-friendly request handlers.

**Why Workers:**

- Same vendor as edge static hosting; low latency near users.
- TypeScript-native; fits the existing language choice.
- Scales to zero / pay-for-use — suitable before commercial launch.
- Can serve SPA assets via Workers Assets or Cloudflare Pages.

**Constraints to plan for:**

- CPU/time limits per request — long AI or email sync jobs may need
  Queues / Workflows later (not provisioned yet).
- Prefer streaming or chunked responses for voice/AI if Floot used long-lived
  connections.

**Status:** Placeholder entry at `worker/index.ts`. No product routes yet.

### D1 — recommended relational store

**Role:** Users, sessions, tasks, planning metadata, integration tokens
(encrypted at rest via app-level crypto), capacity settings.

**Why D1:**

- SQLite semantics; familiar migrations; good fit for task/relational data.
- Bound directly to Workers (`env.DB`) — no separate VPC/database host.
- Free/paid tiers on Cloudflare without standing up a third-party DB yet.

**Risks / evaluation notes:**

- Confirm Floot’s original DB engine and SQL dialect; translate schemas.
- Large analytical queries may need care; keep indexes matching Floot access
  patterns.
- Multi-region consistency is eventually consistent across D1 replicas —
  fine for personal task data if documented.

**Status:** Binding commented out in `wrangler.toml`. `migrations/` is empty
on purpose. **Do not create a database until schema inventory is complete.**

### R2 — recommended object storage

**Role:** Document uploads, voice audio blobs, goblin/theme assets that are
user-generated or large.

**Why R2:**

- S3-compatible API; no egress fees to the internet (Cloudflare pricing model).
- Natural pairing with Workers for signed upload/download URLs.
- Separates binary blobs from D1 row size limits.

**Evaluation notes:**

- Inventory Floot upload paths, size limits, MIME types, and retention.
- Decide public vs private buckets; prefer private + signed URLs for user docs.
- Cache public theme assets via Cloudflare CDN if appropriate.

**Status:** Binding commented out in `wrangler.toml`. **Do not create a bucket yet.**

## Auth

Auth must be re-homed from Floot’s platform auth. Target approach (to confirm
against Floot inventory):

- Session cookies or JWT issued by the Worker.
- Secrets only in Worker env / `.dev.vars` (never `VITE_*`).
- Preserve existing user identities if a data export is available.

## Integrations (expected from Floot)

Document concrete providers in `FLOOT_INVENTORY.md` when source arrives:

- Email (OAuth / IMAP / provider SDK — TBD from Floot)
- AI organisation / capture (provider keys on Worker only)
- Voice dictation (browser APIs + optional transcription API)

## Deployment (eventual)

1. `npm run build` → `dist/`
2. Deploy Worker + assets via Wrangler / Cloudflare Pages.
3. Bind D1 + R2 in production only after migrations are reviewed.
4. Configure GitHub secrets for Cloudflare credentials (CI deploy — not enabled
   in this foundation; CI currently runs checks only).

## Explicit non-goals of this foundation

- No production deploy.
- No paid Cloudflare resources provisioned.
- No invented dashboard or mock product features.
- No Side-Quest or other-repo changes.
