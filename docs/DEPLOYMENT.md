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

Production deploys are manual and need approval. Nothing deploys from CI.
Wrangler 4 needs Node.js 22 or newer.

```bash
npm ci
npm run check            # typecheck, lint, format, tests, build
npm run deploy:dry-run   # builds and validates the bundle without uploading
npm run deploy           # build + wrangler deploy --var ENVIRONMENT:production
```

`npm run deploy` sets `ENVIRONMENT=production` at deploy time (Secure cookies,
production rate limits). `wrangler.toml` keeps `ENVIRONMENT = "development"`
so `wrangler dev` behaves as before.

### Before the first production deploy

1. **D1 database id.** `wrangler.toml` still has the placeholder id
   `00000000-0000-0000-0000-000000000001`. Replace it with the id of the
   existing production `pocket-goblin` D1 database
   (`npx wrangler d1 list`). Changing this id also changes which local
   Miniflare database `wrangler dev` uses, so local test data will appear
   empty afterwards (the old data is still on disk under `.wrangler/state`).
2. **Migrations.** Apply pending migrations to the remote database only after
   reviewing them: `npx wrangler d1 migrations apply pocket-goblin --remote`.
   The migrations are additive; they never drop user data.
3. **Secrets.** Set via `npx wrangler secret put <NAME>`, never in git:
   - `AUTH_SECRET` (required — a long random string)
   - Optional AI: `AI_PROVIDER`, `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`,
     `AI_DAILY_USER_LIMIT` — see `docs/INTELLIGENCE.md`
4. **R2.** The `UPLOADS` binding expects the `pocket-goblin-uploads` bucket.
   Do not create a remote bucket without approval; without it, deploy fails
   on the binding.

## Verifying a deploy

```bash
curl -sI https://pocketgoblin.org/          # 200, text/html
curl -sI https://pocketgoblin.org/login     # 200, text/html (SPA fallback)
curl -s  https://pocketgoblin.org/api/health
# {"service":"pocket-goblin","status":"ok","environment":"production"}
```

## Local development (unchanged)

`npm run dev` runs Vite on :5173 (with `/api` proxied to :8787) and
`wrangler dev` on :8787. See `docs/DEVELOPMENT.md`.
