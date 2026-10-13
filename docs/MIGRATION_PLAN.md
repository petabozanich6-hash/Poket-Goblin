# Migration plan — Floot → GitHub / Cursor / Cloudflare

## Purpose

Move the existing Pocket Goblin application off Floot onto this repository
and Cloudflare, without rebuilding product behaviour from scratch.

## Principles

1. **Import first, adapt second** — bring Floot source in, then adjust imports,
   env, and hosting.
2. **No feature invention** — temporary UI stays a landing page until real
   screens are copied over.
3. **Preserve UX** — ADHD-friendly flows, goblin theme, and capacity-aware
   planning must remain recognizable.
4. **Secrets stay secret** — never commit API keys; use `.env.example` /
   `.dev.vars.example` only.
5. **Infrastructure last** — provision D1/R2 only after schemas and upload
   paths are documented.

## Phases

### Phase 0 — Foundation (this commit)

- [x] Vite + React + TypeScript scaffold
- [x] React Router, TanStack Query, Lucide, CSS Modules
- [x] ESLint, Prettier, strict TypeScript
- [x] Folder structure for full-stack migration
- [x] Cloudflare evaluation + wrangler placeholder
- [x] Documentation set
- [x] Temporary landing page
- [x] CI checks workflow
- [x] Development branch

### Phase 1 — Source intake

When Floot source is supplied:

1. Export / copy the full Floot project into a staging folder (e.g.
   `import/floot/` — gitignored if it contains secrets).
2. Complete `docs/FLOOT_INVENTORY.md` with real paths, endpoints, and schemas.
3. List third-party keys and map them to Worker secrets vs `VITE_*` public vars.
4. Snapshot any production data export format Floot provides.

### Phase 2 — Frontend port

1. Move components into `src/components/` and `src/features/`.
2. Align router with Floot routes in `src/app/router.tsx`.
3. Replace Floot-specific data clients with `fetch` / React Query against the
   new API base (`VITE_API_BASE_URL`).
4. Port CSS Modules and assets; fix path aliases (`@/`).
5. Keep visual language; do not redesign.

### Phase 3 — Backend port

1. Map Floot API routes → Worker handlers under `worker/` (or `worker/routes/`).
2. Translate DB schema → D1 migrations in `migrations/`.
3. Map file storage → R2 bindings and signed URL helpers.
4. Re-implement auth against Worker sessions (confirm Floot auth model first).
5. Proxy AI / email / voice calls server-side.

### Phase 4 — Data migration

1. Write one-off import scripts (not shipped to production clients).
2. Validate counts and referential integrity.
3. Dry-run on a preview D1 database before any production cutover.

### Phase 5 — Hardening for commercial release

1. Observability (logs, error tracking).
2. Rate limits, CORS, CSRF/session hardening.
3. Accessibility and ADHD UX regression checklist.
4. Staging deploy on Cloudflare preview; production only with explicit approval.

## Cutover checklist (future)

- [ ] Inventory complete and reviewed
- [ ] All Floot screens rendering against new API
- [ ] Auth working for existing test accounts
- [ ] Uploads round-trip via R2
- [ ] Email + AI integrations verified in staging
- [ ] CI green; no secrets in git history
- [ ] Explicit go-ahead to provision/deploy production

## Out of scope until later

- Production Cloudflare deploy
- Creating paid D1/R2 resources
- Rebuilding Side-Quest or any other product
- Marketing site beyond the temporary landing page
