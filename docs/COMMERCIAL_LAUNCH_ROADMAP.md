# Commercial launch roadmap — Pocket Goblin

Phase 0: read-only audit and deployment-repair proposal. Audited 2026-10-15
against `main` @ `1a12309` (Poket-Goblin) and `9be239f` (pocket-goblin, the
repo connected to Cloudflare Workers Builds).

Nothing in this phase was deployed, migrated, committed or changed in
Cloudflare. The only requests to production were anonymous `GET`s to
`/`, `/login`, `/assets/x.js`, `/api/health` and `/api/nope`.

---

## 1. Summary

1. **The homepage is broken because production runs the wrong repo.**
   Workers Builds deploys `petabozanich6-hash/pocket-goblin`. That repo is a
   one-commit import of the Sprint 7 code (`b66c645`) and its `wrangler.toml`
   has no `[assets]` block. No static files are uploaded, so every request
   reaches the Hono app. The app only knows `/api/*`, so `/` returns
   `{"error":"Not found"}`. The fix (the `[assets]` block) is already merged in
   Poket-Goblin (`21ed675`). It has never reached production.
2. **There is a reflected XSS in production right now.** It is on the public
   OAuth callback (`/api/connections/oauth/callback?error=…`). It is in both
   repos and runs on the `pocketgoblin.org` origin. It is the first thing to fix.
3. **CORS reflects any origin with credentials.** This was confirmed live.
   `SameSite=Lax` cookies limit the damage today, but it must be fixed.
4. **Notes, events, documents and reminders accept other accounts' record IDs**
   as link targets. None of these routes checks who owns the target.
5. **Account basics are missing:** password reset, password change, email
   verification, account deletion and data export. The auth rate limiter is
   per-isolate memory, and the per-email lockout is counted but never enforced.
6. Local checks all pass: typecheck, lint, format, 95/95 unit tests, build and
   `wrangler deploy --dry-run`.

---

## 2. Diagnosis: broken homepage

### Evidence

Live (anonymous GET, 2026-10-15):

| Request            | Status | Body                                                                   |
| ------------------ | ------ | ---------------------------------------------------------------------- |
| `GET /`            | 404    | `{"error":"Not found"}`                                                |
| `GET /login`       | 404    | `{"error":"Not found"}`                                                |
| `GET /assets/x.js` | 404    | `{"error":"Not found"}`                                                |
| `GET /api/health`  | 200    | `{"service":"pocket-goblin","status":"ok","environment":"production"}` |
| `GET /api/nope`    | 401    | `{"error":"Unauthorized"}` (auth middleware runs before 404)           |

The `{"error":"Not found"}` body comes from the Worker's catch-all handler,
`worker/index.ts:81`. The app is mounted with `basePath('/api')`
(`worker/index.ts:27`), so any path outside `/api` falls through to it.

### Repo comparison

| File                       | Poket-Goblin                                                                       | pocket-goblin (connected)                                               |
| -------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `wrangler.toml` `[assets]` | present, `wrangler.toml:16-19` (`./dist`, `single-page-application`, `["/api/*"]`) | **missing**                                                             |
| D1 id                      | `91a90710-…` (`wrangler.toml:25`)                                                  | same                                                                    |
| `preview_bucket_name`      | `pocket-goblin-uploads-preview` (`wrangler.toml:32`)                               | **`pocket-goblin-uploads`**, the production bucket (`wrangler.toml:17`) |
| `[vars] ENVIRONMENT`       | `development` (`wrangler.toml:35`)                                                 | `development`                                                           |
| `deploy` scripts           | `--var ENVIRONMENT:production` (`package.json:12-13`)                              | none                                                                    |
| Node engine                | `>=22`                                                                             | `>=20` (pinned Wrangler 4 refuses Node 20)                              |
| `.github/workflows`        | CI + D1 migrations                                                                 | none                                                                    |
| Sprint 8 code              | present (`grounding.ts`, `dedupe.ts`, provider hardening, review/captures changes) | absent                                                                  |
| Migrations                 | `0001`–`0005`                                                                      | identical `0001`–`0005`                                                 |

I checked the connected repo's tree against every Poket-Goblin commit. It
equals `b66c645` (Sprint 7) with three differences: no `.github/`, the
production D1 id, and the preview bucket set to the production bucket. It is
older than `21ed675` (SPA serving) and `0001add` (Sprint 8).

Dry-runs, with no upload:

- Poket-Goblin: `✨ Read 11 files from the assets directory …/dist`, total 296 KiB.
  Bindings: DB, UPLOADS, ENVIRONMENT.
- Connected repo: **no assets line**, total 274 KiB, `env.ENVIRONMENT ("development")`.

**Verified.** The missing `[assets]` block is the cause.

### Related claims checked

| Claim                       | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production env var mismatch | **Confirmed, with an unknown.** Both repos set `ENVIRONMENT = "development"`. Live `/api/health` reports `production`. A plain `npx wrangler deploy` (the default Workers Builds deploy command) would publish `development`, as the connected-repo dry-run shows. Production therefore gets `production` from somewhere outside the repo: probably a custom deploy command or a dashboard-only setting. The owner must check this (§7, D2). If the next build drops it, cookies lose `Secure` (`worker/lib/session.ts:48`) and auth rate limits loosen 7.5× and 6× (`worker/routes/auth.ts:29,99`). |
| Preview R2 bucket name      | **Confirmed.** The connected repo points `preview_bucket_name` at the production bucket, so `wrangler dev --remote` would read and write real user files. Poket-Goblin uses `pocket-goblin-uploads-preview`. That bucket probably does not exist, so remote dev fails safely; normal deploys never use `preview_bucket_name`.                                                                                                                                                                                                                                                                        |
| In-memory auth rate limiter | **Confirmed.** `worker/lib/rateLimit.ts:8` uses a module-level `Map`, which is per isolate and per colo and resets on recycle. `auth.ts:135` increments a `login-fail:<email>` bucket but never checks it, so there is no per-account lockout.                                                                                                                                                                                                                                                                                                                                                       |
| AUTH_SECRET dev fallback    | **Confirmed.** `worker/lib/session.ts:19-21` falls back to `'local-dev-only-change-me'` in every environment. If production lacks the secret, session-token hashes are keyed with a public string. It cannot be checked from outside (§7, D3). Rotating the secret later logs every user out, because tokens are stored as `SHA-256(secret:token)`.                                                                                                                                                                                                                                                  |
| No password reset           | **Confirmed.** Auth routes are `register`, `login` and `logout` only (`worker/routes/auth.ts:28,98,152`). There is no reset, change-password, email verification or account deletion, and the app sends no email.                                                                                                                                                                                                                                                                                                                                                                                    |
| Upload limit 8 MiB vs 10 MB | **Confirmed.** `worker/lib/documents/validateUpload.ts:1` sets `8 * 1024 * 1024`, matching `docs/INTEGRATIONS.md:9`. The UI shows the server value (`src/pages/DocumentsPage.tsx:103`).                                                                                                                                                                                                                                                                                                                                                                                                              |
| Document → task linking     | **Confirmed, and wider than reported.** See §3, S3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

---

## 3. Confirmed findings: defects

Severity reflects a public multi-tenant SaaS.

### Security

| #   | Sev          | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Evidence                                                                                              |
| --- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| S1  | **Critical** | **Reflected XSS on the production origin.** The `error` query parameter is put unescaped into HTML on an unauthenticated route. A local probe of `?error=<img src=x onerror=alert(1)>` returned that markup verbatim as `text/html`. A link to `pocketgoblin.org/api/connections/oauth/callback?error=…` runs script as the victim, same-origin, and the victim's `Lax` cookie is sent, so the script can read and change all of their data. **Present in the deployed code.** Not exploited against production during this audit.                                                                                              | `worker/routes/connections.ts:157-161`; same lines in the connected repo                              |
| S2  | High         | **CORS reflects every origin with `credentials: true`.** Confirmed live: `Origin: https://evil.example` gets `access-control-allow-origin: https://evil.example` and `allow-credentials: true`. `SameSite=Lax` keeps cross-site cookies out today, but any same-site origin (another subdomain) or a future `SameSite=None` change would expose every API response. A same-origin SPA does not need CORS.                                                                                                                                                                                                                       | `worker/index.ts:29-37`                                                                               |
| S3  | High         | **Cross-account record links.** Link targets are stored without checking that the caller owns them: documents `linkedTaskId/EventId/ReminderId`, plus a `record_links` row; notes `linkedTaskId/EventId` on create and update; events `linkedTaskId` on create; reminders `entityId`. Nothing currently joins on these to show the target's content, so this is not a data leak today. It is a broken invariant, though: any feature that displays a linked record would leak another tenant's data. The FK checks also turn failed inserts into 500s, which is an existence oracle (IDs are random UUIDs, so it is low value). | `worker/routes/documents.ts:188-216`; `notes.ts:81-82,143-148`; `events.ts:118`; `reminders.ts:90-91` |
| S4  | High         | **AUTH_SECRET falls back silently** to a public constant in production (see §2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `worker/lib/session.ts:19-21`                                                                         |
| S5  | High         | **Production mode depends on a deploy flag.** `ENVIRONMENT=production` (which turns on `Secure` cookies and strict rate limits) is set only by `--var` in npm scripts and CI, not in config. Workers Builds' default command would deploy `development`.                                                                                                                                                                                                                                                                                                                                                                        | `wrangler.toml:34-35`; `package.json:12-13`; `session.ts:48`; `auth.ts:29,99`                         |
| S6  | Medium       | **Auth throttling is ineffective at the edge.** The limiter is in memory per isolate. The per-email failure bucket is never enforced. Register returns 409 for existing emails (account enumeration). Login skips PBKDF2 for unknown emails (timing enumeration). `X-Forwarded-For` is trusted when `CF-Connecting-IP` is absent.                                                                                                                                                                                                                                                                                               | `rateLimit.ts:8`; `auth.ts:20-26,65-67,133-136`                                                       |
| S7  | Medium       | **Password hashing** uses PBKDF2-SHA256 at 100k iterations, below current OWASP guidance (600k). `verifyPassword` rejects any other count, so raising it needs versioned rehash-on-login. The hash comparison is not constant-time.                                                                                                                                                                                                                                                                                                                                                                                             | `worker/lib/passwords.ts:1,52-54`                                                                     |
| S8  | Medium       | **No security headers** on the SPA or API: no CSP, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy` or HSTS. There is no `public/_headers`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `public/` contains only `assets/` and `favicon.svg`                                                   |
| S9  | Low          | The OAuth callback does not check that the `state` owner matches the current session. It also updates the connection before any token exchange.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `connections.ts:165-188`                                                                              |
| S10 | Low          | Production source maps are published (`dist/assets/*.js.map`, about 2 MB, including full source).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `vite.config.ts:30`                                                                                   |
| S11 | Low          | Uploads are read fully into memory (`formData()` then `arrayBuffer()`) before the size check. Any ZIP is accepted as a "docx". A document `displayName` containing CR/LF would make `Headers.set` throw (500) on download.                                                                                                                                                                                                                                                                                                                                                                                                      | `documents.ts:101-113,243-245`; `validateUpload.ts:50-53`                                             |
| S12 | Low          | The CI workflow has no `permissions:` block (it inherits the repo default) and actions are pinned by tag, not SHA. The D1 workflow correctly sets `contents: read`.                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `.github/workflows/ci.yml`; `d1-migrations.yml:32-33`                                                 |

### Deployment and configuration

| #   | Finding                                                                                                                                                                                                                               | Evidence                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| D-a | Workers Builds deploys a stale fork with no `[assets]`, so the homepage is down.                                                                                                                                                      | §2                                    |
| D-b | The connected repo's preview bucket is the production bucket.                                                                                                                                                                         | connected `wrangler.toml:17`          |
| D-c | The docs say "Nothing deploys from CI". That is false in practice: Workers Builds auto-deploys the connected repo. It may also upload preview versions for non-production branches, and those versions use production D1/R2 bindings. | `docs/DEPLOYMENT.md:58`               |
| D-d | `wrangler.toml` comments still say "Local D1 only" and "Local R2 simulation" even though the bindings point at real production resources.                                                                                             | `wrangler.toml:21,28`                 |
| D-e | No `[observability]` (Workers Logs) is configured, so there is no production error visibility.                                                                                                                                        | `wrangler.toml`                       |
| D-f | Whether production D1 has migrations `0001`–`0005` applied is **unknown**. `/api/health` does not touch D1. Run the existing preflight workflow (read-only).                                                                          | `.github/workflows/d1-migrations.yml` |

### Correctness and quality

| #   | Finding                                                                                           | Evidence               |
| --- | ------------------------------------------------------------------------------------------------- | ---------------------- |
| Q1  | Expired sessions are deleted only when they are used again, so the table grows without bound.     | `session.ts:102-107`   |
| Q2  | Documents `categorySlug` is stored as free text with no validation against categories.            | `documents.ts:200`     |
| Q3  | Document processing runs inline in the upload request. Large PDFs share the request's CPU budget. | `documents.ts:137-138` |
| Q4  | API smokes and Playwright are not in CI, so isolation tests (smoke F) only run by hand.           | `docs/TESTING.md`      |

---

## 4. Missing features (not defects)

| Area             | Exists today                                                                                    | Missing                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Account security | Register/login/logout, PBKDF2, hashed opaque sessions, HttpOnly cookies                         | Password reset, change password/email, email verification, session list/revoke, account deletion, data export, MFA |
| Abuse protection | In-memory IP buckets                                                                            | Durable rate limiting (Workers Rate Limiting binding or Durable Object), Turnstile on register/login               |
| Email            | Nothing                                                                                         | Transactional email provider (reset, verify, receipts)                                                             |
| Billing          | Nothing (`stripe`, `subscription` and `premium` appear nowhere)                                 | Stripe Checkout/Portal, webhooks, `subscriptions` table, entitlement checks                                        |
| Plan limits      | Per-user AI daily counter (`ai_usage_daily`, `AI_DAILY_USER_LIMIT`), 8 MiB upload cap           | Tiered limits (AI calls, storage bytes, document count), usage UI                                                  |
| AI routing       | OpenAI-compatible provider + rule fallback, 12 s timeout, JSON validation, grounding (Sprint 8) | Per-tier model routing, cost accounting, Workers AI/Anthropic option, provider failover                            |
| Documents        | Upload/list/rename/download/delete, magic-byte sniffing, text extraction, review suggestions    | OCR, async queue processing, storage quotas, retention/deletion on account close, virus scanning                   |
| Integrations     | OAuth state/token schema, honest "not connected" states                                         | Token exchange, encrypted token storage, live sync                                                                 |
| i18n             | English only, `lang="en"`                                                                       | String extraction, locale formatting, RTL review                                                                   |
| Legal            | Nothing                                                                                         | Privacy policy, terms, cookie notice, DPA/GDPR rights flows, data residency statement                              |
| Observability    | None                                                                                            | Workers Logs, error alerting, uptime check on `/` and `/api/health`                                                |
| Testing          | 95 unit tests, manual API smokes, one Playwright spec                                           | Smokes/e2e in CI against `wrangler dev`, an authz regression test per route                                        |

---

## 5. Proposed change set: Phase 1 (deployment repair and critical fixes)

One branch, `fix/phase1-deploy-and-security`, opened as a PR against `main` for
approval. Nothing deploys until the owner reconnects Workers Builds (§6).

**Config and deployment**

1. `wrangler.toml`: set `[vars] ENVIRONMENT = "production"` so every deploy
   path is production by default. Add `ENVIRONMENT=development` to
   `.dev.vars.example` (`.dev.vars` overrides `[vars]` in `wrangler dev`).
   Keep the `--var` flags as belt-and-braces.
2. `wrangler.toml`: keep `[assets]` and `preview_bucket_name =
"pocket-goblin-uploads-preview"`. Fix the misleading "local only" comments.
   Add `[observability] enabled = true` (Workers Logs is included in the
   Workers plan; confirm under D6).
3. Docs: rewrite `docs/DEPLOYMENT.md` "Deploying" for Workers Builds from
   Poket-Goblin `main`, including the dashboard settings in §6.

**Security fixes**

4. S1: HTML-escape the OAuth callback output, or return a redirect to
   `/inbox?connection=cancelled` with no reflected text. Add a unit test.
5. S2: restrict CORS to `https://pocketgoblin.org` plus `http://localhost:5173`
   in development. Better still, remove CORS (same origin) and keep it only for
   dev.
6. S3: add `assertOwned(db, userId, table, id)` and use it for every link
   target: documents (task/event/reminder), notes (task/event), events (task)
   and reminders (`entityId` when `entityType` ≠ `general`). Return 404 for
   foreign or unknown IDs. Add isolation tests.
7. S4: fail closed in production. If `ENVIRONMENT=production` and
   `AUTH_SECRET` is missing or shorter than 32 characters, return 503 from auth
   routes and log an error. **Deploy only after D3 confirms the secret is
   set**, or every user is locked out.
8. S8: add `public/_headers` with CSP (`default-src 'self'`, etc.),
   `frame-ancestors 'none'`, `Referrer-Policy`, `X-Content-Type-Options`, and
   HSTS (after D4). Add the same headers to API responses via Hono
   `secureHeaders`.
9. S10: `build.sourcemap: 'hidden'` (maps generated but not referenced), or
   `false`. Owner choice, D7.
10. S12: add `permissions: contents: read` to `ci.yml`.

**Small, agreed product fix**

11. Upload limit: change to the agreed 10 MB (D5), and update docs and the test.

Deferred to Phase 2, account security: S6 (durable rate limiting with the
Workers Rate Limiting binding, enforcing the per-email lockout, generic
register response), S7 (PBKDF2 rehash on login), S9, S11, Q1–Q3. These need
schema changes or design decisions, and they do not cause the outage.

---

### Phase 1 status

Implemented on branch `fix/phase1-deploy-and-security` (PR to `development`).
The owner approved §5 as listed. Where §5 depended on a decision, the
recommendation was used:

- **D5:** 10 MiB, shown as "10 MB".
- **D6:** Workers Logs enabled.
- **D7:** source maps are `hidden` and also excluded from upload
  (`public/.assetsignore`).
- **D4 (HSTS):** not set. It is still pending.

Before this reaches production, D2 and D3 are still required.

---

## 6. Making Poket-Goblin the single source of truth

**Recommendation: reconnect Workers Builds to `petabozanich6-hash/Poket-Goblin`.**
Do not sync config into the connected repo.

Why: syncing means maintaining two repos forever, and the connected repo is
already a stale fork missing Sprint 8, CI and the migration workflow. A
reconnect is a dashboard setting. It does not change the Worker name, the
custom domain, DNS, D1, R2 or secrets.

### Steps only the owner can do (Cloudflare dashboard)

Do these **after** the Phase 1 PR is merged to `main`:

1. **Workers & Pages → `pocket-goblin` → Settings → Variables and Secrets.**
   Write down what is listed. Confirm `AUTH_SECRET` exists as a _Secret_ (D3).
   Note whether `ENVIRONMENT` appears there.
2. **Settings → Build.** Write down the current _Build command_, _Deploy
   command_, _Root directory_ and _non-production branch_ settings, and send
   them over (this answers D2).
3. In the same panel, choose **Disconnect** for the Git repository, then
   **Connect** → GitHub → `petabozanich6-hash/Poket-Goblin`. Install or extend
   the Cloudflare GitHub app for that repo if prompted.
4. Set:
   - Production branch: `main`
   - Build command: `npm ci && npm run build`
   - Deploy command: `npx wrangler deploy --var ENVIRONMENT:production`
   - Root directory: `/`
   - Environment variable (build): `NODE_VERSION=22`
   - **Builds for non-production branches: off** (D1). Otherwise preview
     versions bind to production D1/R2.
5. Trigger a build, or let the merge to `main` trigger one. Then verify:
   ```bash
   curl -sI https://pocketgoblin.org/          # 200 text/html
   curl -sI https://pocketgoblin.org/den       # 200 text/html (SPA fallback)
   curl -s  https://pocketgoblin.org/api/health
   ```
6. Before any user-facing launch, run **Actions → D1 migrations (production) →
   preflight** to confirm `0001`–`0005` are applied (D-f). Apply only if it
   reports pending migrations, through the approval-gated path.
7. Archive `petabozanich6-hash/pocket-goblin` on GitHub (Settings → Archive),
   or delete it once the new builds are confirmed. Archive is reversible.

Rollback: **Workers & Pages → `pocket-goblin` → Deployments → Rollback** to the
previous version. Code and config only; D1 and R2 are untouched.

Merging to `main` will auto-deploy once Workers Builds is connected. The PR
merge becomes the approval gate. Enable branch protection on `main` (require
PR and passing CI) so nothing reaches production without review.

---

## 7. Decisions needing owner approval

| ID  | Decision                                                                                                            | Recommendation                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| D1  | Reconnect Workers Builds to Poket-Goblin (§6), with non-production branch builds off                                | Yes                                                             |
| D2  | Report the current Workers Builds deploy command and variables (explains `environment: production`)                 | Needed before merging Phase 1                                   |
| D3  | Confirm `AUTH_SECRET` is set in production. If not, set it (this logs everyone out, which is acceptable pre-launch) | Confirm before S4 ships                                         |
| D4  | Enable HSTS (`max-age=31536000; includeSubDomains`)? This affects every subdomain of `pocketgoblin.org`             | Yes, if no subdomain needs plain HTTP                           |
| D5  | Upload limit: 10 MB = 10,000,000 bytes, or 10 MiB = 10,485,760 bytes                                                | 10 MiB, shown as "10 MB"                                        |
| D6  | Enable Workers Logs (`[observability]`)                                                                             | Yes. No new resource, but log retention and volume limits apply |
| D7  | Source maps in production: hidden or none                                                                           | `hidden`                                                        |
| D8  | Branch protection on `main` (PR + CI required)                                                                      | Yes                                                             |
| D9  | Archive the old `pocket-goblin` repo after cut-over                                                                 | Archive, don't delete                                           |
| D10 | Phase 1 scope as listed in §5 (S1, S2, S3, S4, S5, S8, S10, S12, upload limit)                                      | Approve                                                         |

---

## 8. Blockers

- **Dashboard access.** The Workers Builds settings, secrets and the
  `environment: production` source cannot be seen from the repo (D2, D3). The
  Cloudflare MCP server is installed but needs authorisation.
- **D1 migration state** is unknown until the preflight workflow is run (D-f).
- **S1 is live in production.** The fix only reaches users after the reconnect
  (§6). If the reconnect is delayed, a stopgap is a one-file fix pushed to the
  connected repo (which auto-deploys). That would need its own approval.

---

## 9. Checks run (local only)

Node v24.21.0, npm 11.19.0, Wrangler 4.149.0. No Cloudflare login was used.

| Check                                                                   | Result                                                                                                             |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `npm ci`                                                                | OK (270 packages; deprecation warning for eslint 9.39)                                                             |
| `npm run typecheck`                                                     | pass                                                                                                               |
| `npm run lint`                                                          | pass                                                                                                               |
| `npm run format:check`                                                  | pass                                                                                                               |
| `npm test`                                                              | 13 files, **95/95 pass**                                                                                           |
| `npm run build`                                                         | pass. JS 379.5 kB (116.3 kB gzip), CSS 18.2 kB, plus a 2.0 MB source map                                           |
| `wrangler deploy --dry-run --var ENVIRONMENT:production` (Poket-Goblin) | pass. 11 asset files read, 296 KiB; bindings DB, UPLOADS, ENVIRONMENT                                              |
| `wrangler deploy --dry-run` (connected repo)                            | pass, but **no assets** and `ENVIRONMENT="development"`, which confirms the diagnosis                              |
| In-process probe of `worker/index.ts` (vite-node, fake env)             | `/` → 404 `{"error":"Not found"}`; OAuth callback reflects `<img onerror>` unescaped; CORS reflects `evil.example` |
| Live anonymous GETs                                                     | See §2                                                                                                             |

Not run: API smokes and Playwright (they need `wrangler dev` with local D1 and
were out of scope for a read-only audit), and anything touching remote
D1/R2.

Side effects: `node_modules/` and `dist/` were created in both clones (both
gitignored), and dry-run bundles were written to the session scratchpad.

---

## 10. Remaining phases (not started)

Each phase gets its own branch and PR, approved before merge.

1. **Phase 1: deployment repair and critical security** (§5).
2. **Phase 2: account security.** Password reset and change, email
   verification, session management, account deletion and export, durable rate
   limiting + Turnstile, PBKDF2 rehash, generic auth errors. Builds on the
   existing `users`/`sessions` tables and `passwords.ts`.
3. **Phase 3: transactional email + legal.** Provider choice (Cloudflare
   Email Service or a third party), privacy policy, terms, cookie notice,
   GDPR rights flows.
4. **Phase 4: Stripe subscriptions.** Checkout, Customer Portal, webhook
   Worker route with signature verification, `subscriptions` and `entitlements`
   tables (additive migration `0006`). No billing code exists today.
5. **Phase 5: free/premium limits.** Generalise `ai_usage_daily` and the
   upload cap into per-plan limits (AI calls, storage bytes, document count),
   with a usage UI.
6. **Phase 6: AI routing.** Per-tier model selection on top of the existing
   `resolveProvider`/rule fallback, cost logging, failover.
7. **Phase 7: document lifecycle.** Queue-based processing (replacing the
   inline pipeline), OCR, quotas, retention, R2 cleanup on account deletion.
8. **Phase 8: i18n and UX.** String extraction, locale date/number
   formatting, full WCAG pass (the existing UX audit covers critical surfaces
   only).
9. **Phase 9: launch testing.** Smokes and e2e in CI, per-route authz
   regression suite, load test of auth and upload, uptime monitoring, incident
   runbook.
