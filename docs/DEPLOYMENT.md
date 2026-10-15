# Deployment — Pocket Goblin

## Production

| Item           | Value                                                     |
| -------------- | --------------------------------------------------------- |
| Domain         | https://pocketgoblin.org                                  |
| Worker         | `pocket-goblin`                                           |
| Domain binding | Custom Domain, attached in the Cloudflare dashboard       |
| DNS / SSL      | Managed by Cloudflare for the zone — **not** in this repo |
| Frontend       | React SPA (`dist/`) served as Worker static assets        |
| API            | Hono Worker at `/api/*` on the same origin                |
| Database       | D1 binding `DB` (`pocket-goblin`)                         |
| Files          | R2 binding `UPLOADS` (`pocket-goblin-uploads`)            |

The domain, its DNS records and its certificates already exist. Nothing in
this repository creates, changes or removes them:

- `wrangler.toml` declares **no** `routes` and no `custom_domain` entry. When
  the config declares no routes, `wrangler deploy` leaves routes and Custom
  Domains configured in the dashboard untouched.
- Do not add a `routes` block for `pocketgoblin.org`. Wrangler treats a declared
  route list as the full set for the Worker, so a partial list could detach
  something managed in the dashboard.

## How requests are served

```
https://pocketgoblin.org
   │
   ▼
Worker "pocket-goblin"
   ├── /api/*            → Hono app (worker/index.ts), always runs first
   ├── /assets/*, files  → static files from dist/ (Vite build + public/)
   └── anything else     → dist/index.html (SPA fallback for React Router)
```

Configured in `wrangler.toml`:

```toml
[assets]
directory = "./dist"
not_found_handling = "single-page-application"
run_worker_first = ["/api/*"]
```

Because the SPA and API share one origin, the browser calls `/api/...` directly
(the same relative paths Vite proxies in development). Session cookies are
`SameSite=Lax`, `HttpOnly` and `Secure` in production.

Refreshing a deep link such as `/den`, `/tasks` or `/login` returns
`index.html`; React Router then renders the page or redirects (unknown paths
redirect to `/`). Unknown `/api/*` paths still return JSON `404`.

## Deploying

Production is deployed by **Cloudflare Workers Builds from this repository's
`main` branch**. Merging a PR into `main` is the approval gate, so protect
`main` (PR + passing CI required). GitHub Actions never deploys. Wrangler 4
needs Node.js 22 or newer.

Workers Builds settings (Workers & Pages → `pocket-goblin` → Settings → Build):

| Setting                            | Value                                                 |
| ---------------------------------- | ----------------------------------------------------- |
| Git repository                     | `petabozanich6-hash/Poket-Goblin`                     |
| Production branch                  | `main`                                                |
| Build command                      | `npm ci && npm run build`                             |
| Deploy command                     | `npx wrangler deploy --var ENVIRONMENT:production`    |
| Root directory                     | `/`                                                   |
| Build variable                     | `NODE_VERSION=22`                                     |
| Builds for non-production branches | **Off** — preview versions would use production D1/R2 |

Manual deploy (fallback, needs approval):

```bash
npm ci
npm run check            # typecheck, lint, format, tests, build
npm run deploy:dry-run   # builds and validates the bundle without uploading
npm run deploy           # build + wrangler deploy --var ENVIRONMENT:production
```

`wrangler.toml` sets `ENVIRONMENT = "production"`, so every deploy path gets
Secure cookies and production rate limits even without the `--var` flag.
`npm run dev` and `.dev.vars` set `ENVIRONMENT=development` locally.

In production the Worker refuses every route except `/api/health` with `503`
unless `AUTH_SECRET` is set and at least 32 characters long. Confirm the secret
exists **before** deploying. Changing it logs every user out.

Rollback: Workers & Pages → `pocket-goblin` → Deployments → Rollback. This
restores code and config only; D1 and R2 are untouched.

### Before the first production deploy

1. **D1 database id.** Done. `wrangler.toml` points at the production
   `pocket-goblin` database (`91a90710-dbd7-4a0c-8c90-b97cd3c86d90`).
2. **Migrations.** Use the manual, approval-gated GitHub Actions workflow
   "D1 migrations (production)". Run `preflight` first, then `apply`. Setup,
   token permissions and the safety checks are in
   [D1_MIGRATIONS.md](D1_MIGRATIONS.md). The migrations are additive and never
   drop user data.
3. **Secrets.** Set via `npx wrangler secret put <NAME>`, never in git:
   - `AUTH_SECRET` (required — 32+ random characters, e.g. `openssl rand -base64 48`)
   - Optional AI: `AI_PROVIDER`, `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`,
     `AI_DAILY_USER_LIMIT` — see `docs/INTELLIGENCE.md`
4. **R2.** The `UPLOADS` binding uses the existing `pocket-goblin-uploads`
   bucket. `preview_bucket_name` (`pocket-goblin-uploads-preview`) is only used
   by `wrangler dev --remote` and deliberately is not the production bucket.

## Verifying a deploy

```bash
curl -sI https://pocketgoblin.org/          # 200, text/html
curl -sI https://pocketgoblin.org/login     # 200, text/html (SPA fallback)
curl -s  https://pocketgoblin.org/api/health
# {"service":"pocket-goblin","status":"ok","environment":"production"}
curl -sI https://pocketgoblin.org/ | grep -i content-security-policy
```

## Local development (unchanged)

`npm run dev` runs Vite on :5173 (with `/api` proxied to :8787) and
`wrangler dev` on :8787. See `docs/DEVELOPMENT.md`.
