# Production D1 migrations

Migrations in `migrations/` are applied to the production database by a
**manually started, approval-gated** GitHub Actions workflow:
`.github/workflows/d1-migrations.yml` ("D1 migrations (production)").

| Item       | Value                                                                           |
| ---------- | ------------------------------------------------------------------------------- |
| Database   | `pocket-goblin`                                                                 |
| D1 ID      | `91a90710-dbd7-4a0c-8c90-b97cd3c86d90`                                          |
| Migrations | `migrations/0001_…` to `0020_…`, in order (including pending changes on PR #38) |

The workflow only ever targets that database. The ID is pinned in the
workflow and in `scripts/d1-migrations.mjs`. Every run checks that
`wrangler.toml` has exactly one D1 binding, with that name and ID, before
contacting Cloudflare.

It does **not** deploy the Worker or the website, change R2, routes, the
domain, DNS or SSL, or create any Cloudflare resource.

## Pocket Goblin Phase 1 pathway rollout (PR #38)

The **schema-only staging change is already on `main`** (PR #43). Migrations
`0019_study_pathways.sql` and `0020_study_pathway_deadlines.sql` have no
application routes and can safely be applied before releasing PR #38.
**Merging PR #38 into `main` automatically triggers a Cloudflare Workers
production build.** Never merge it before both migrations are verified as
applied in production.

- `0019_study_pathways.sql` creates versioned approved pathways and sessions,
  with account-deletion cascades and one active pathway per document. It does
  not change existing tasks or documents.
- `0020_study_pathway_deadlines.sql` stores a separately immutable original
  deadline for sessions; the column is nullable to preserve old records.

### Required release order

1. Complete PR #38 review, passing head-commit CI and local browser acceptance,
   and manually inspect a representative real study PDF. Do not use customer
   documents in public CI.
2. While PR #38 is **still unmerged**, run the production D1 workflow's
   **read-only preflight from `main`**. Confirm only the expected pending
   migrations, the pinned database identity and backup/restore readiness.
3. Obtain the owner's separate approval to use the workflow's `apply` option
   on `main`, type the database name and approve the protected environment.
   This modifies the database but does **not** deploy the app.
4. Run preflight again and confirm **zero pending migrations**. Do not merge
   PR #38 if the migration application or its verification failed.
5. Only now merge PR #38 into `main`. Workers Builds will deploy the feature
   automatically; verify production build success and then smoke-test document
   upload, preview, capacity warnings, approval, replan, Undo, task quotas,
   account deletion and downloadable calendar export.
6. If the Worker deployment fails, use the documented code rollback. Do not
   automatically restore D1 Time Travel: that rewinds customer data as well.

A local upgrade regression test in `worker/migrations.test.ts` verifies that
versions 0019–0020 apply on top of version 0018 without altering pre-existing
tasks. It also checks the one-active-pathway constraint and account deletion.

This is a release runbook, **not** authorisation to apply a production
migration, merge PR #38 or deploy production code.

## Health tracking (migration 0025)

`0025_health_tracking.sql` adds eight new tables (`health_profiles`,
`health_weigh_ins`, `health_recipes`, `health_meals`, `health_activities`,
`health_habit_days`, `health_supplements`, `health_supplement_doses`). It is
additive: it creates tables and indexes only and changes no existing rows. Every
table cascades on account deletion and is included in the account export.

The code tolerates the migration not being applied yet. The Health page says
it is "being set up", Health API writes return 503, the Goblin answers health
phrases by saying Health is off, and the account export skips the missing tables. Even so, apply
it **before** merging the Health PR, in the same order as above:

1. Run the read-only preflight from `main` and confirm `0025` is the only
   pending migration.
2. With the owner's separate approval, run `apply`.
3. Run preflight again and confirm zero pending migrations.
4. Merge, then smoke-test: turn Health on, log a supplement, weigh-in and
   meal, export, and delete health data.

This is a release runbook, **not** authorisation to apply the migration or merge.

## Safety model

| Guard                    | What it does                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Manual trigger only      | `workflow_dispatch`. Never runs on push, PR or a schedule.                                                                                                               |
| Preflight is the default | Read-only. It sends only `SELECT`s, using a **D1 Read** token.                                                                                                           |
| Typed confirmation       | `apply` needs `confirm_database` = `pocket-goblin`.                                                                                                                      |
| Branch lock              | `apply` must be started from `main`. This is enforced in the workflow and in the environment.                                                                            |
| Approval                 | The apply job waits on the `production-database` environment. Its write token exists only there.                                                                         |
| Re-check after approval  | Just before applying, the database is read again. If anything changed since preflight, the run stops.                                                                    |
| Additive only            | Pending migrations with `DROP`, `DELETE FROM`, `UPDATE … SET`, `TRUNCATE`, `ALTER … DROP/RENAME` or `REPLACE` are refused. Those must be applied by hand.                |
| Order                    | Files must be numbered `0001`… with no gaps. Wrangler applies them in file-name order. The run refuses if the database has a gap or migrations this branch doesn't know. |
| Untracked schema         | If app tables exist but there is no `d1_migrations` table, the run stops. Re-running `0001` would collide with them.                                                     |
| Restore point            | A D1 Time Travel bookmark is recorded before applying. Restoring is never automatic.                                                                                     |
| One at a time            | A concurrency group prevents parallel runs and never cancels one mid-apply.                                                                                              |
| Verify                   | After applying, the database is read again and must show zero pending migrations.                                                                                        |

The results of every run appear in the run's **Summary**: tables, applied and
pending migrations, the restore point, and any problems.

## One-time setup (GitHub and Cloudflare web UIs only)

### 1. Cloudflare API tokens (two, least privilege)

Go to Cloudflare dashboard → **My Profile → API Tokens → Create Token →
Create Custom Token**.

**Token A — preflight (read-only)**

- Name: `pocket-goblin-d1-read-github`
- Permissions: **Account → D1 → Read**
- Account Resources: **Include → _the account that owns pocket-goblin_** (only that account)
- TTL: set an end date if you like. Read-only, so a longer lifetime is acceptable.

**Token B — apply (write)**

- Name: `pocket-goblin-d1-migrate-github`
- Permissions: **Account → D1 → Edit** (the API reference calls this "D1 Write")
- Account Resources: **Include → _the account that owns pocket-goblin_** (only that account)
- TTL: short, for example a few days around a planned migration. Roll or delete it afterwards.

No other permissions are needed: no Workers, R2, Zone, DNS, SSL or User
permissions. `CLOUDFLARE_ACCOUNT_ID` is supplied, so Wrangler doesn't need to
look up account memberships.

> **Limitation:** Cloudflare D1 permissions apply to the whole account. They
> can't be restricted to one database. If another project (for example
> Side-Quest) has D1 databases in the **same** Cloudflare account, these tokens
> could technically reach them too. The workflow itself only addresses the
> pinned Pocket Goblin ID, and the short-lived Edit token limits the exposure.

### 2. Cloudflare account ID

Find it in the Cloudflare dashboard: **Workers & Pages → Overview**, right
sidebar, "Account ID". It is also in the dashboard URL after `dash.cloudflare.com/`.

### 3. GitHub settings

In the repository: **Settings → Secrets and variables → Actions**

- **Repository secret** `CLOUDFLARE_ACCOUNT_ID` = the account ID.

**Settings → Environments → New environment**

1. `production-database-readonly`
   - Environment secret `CLOUDFLARE_D1_READ_TOKEN` = Token A.
   - No reviewers needed.
2. `production-database`
   - Environment secret `CLOUDFLARE_D1_MIGRATE_TOKEN` = Token B.
   - **Required reviewers:** add yourself (`petabozanich6-hash`).
   - Leave **"Prevent self-review"** unticked. You are the only maintainer, so
     ticking it would mean nobody could approve.
   - **Deployment branches and tags:** choose **Selected branches and tags** and
     add `main`.

Don't put either token in a repository-level secret. Keeping Token B in the
gated environment means no workflow can use it without approval.

### 4. Make the workflow runnable

GitHub only shows **Run workflow** for workflows that exist on the default
branch (`main`). After this file is merged into `development`, open a PR from
`development` to `main` and merge it. Merging into `main` deploys nothing,
because no workflow deploys automatically.

## Running it

**Actions → D1 migrations (production) → Run workflow**

1. **Preflight first.** Branch `main`, action `preflight`. Read the Summary: the
   database identity, its tables, what is already applied, and what is pending.
2. **Apply** (only when you're ready). Branch `main`, action `apply`,
   confirm_database `pocket-goblin`. Preflight runs again. The run then pauses
   with **"Waiting for review"**. Open it, choose **Review deployments → tick
   production-database → Approve and deploy**. (GitHub calls every environment
   approval a "deployment". Nothing is deployed.)
3. The Summary reports ✅ applied and verified, or ❌ with Wrangler's output and
   the restore point.

If a migration fails, Wrangler rolls back that file and stops. Files applied
before it stay applied. Run preflight again to see what is still pending. To
undo everything, restore the recorded Time Travel bookmark yourself:

```bash
npx wrangler d1 time-travel restore pocket-goblin --bookmark=<bookmark from the run summary>
```

Restoring rewinds **all** data in the database to that moment, so any writes
made after it are lost.

## Troubleshooting authentication

Every run starts with **Check Cloudflare credentials (values never shown)**. It
reports whether each secret is present, its length, and any shape problems
(quotes, a `Bearer ` prefix, an ID pasted instead of the token). It then asks
Cloudflare, using read-only GETs:

1. Is the token recognised, and is it active? (`/user/tokens/verify`, or the
   account-token equivalent)
2. Is `CLOUDFLARE_ACCOUNT_ID` one of the accounts this token can access?
3. Can the token read D1 in that account, and is `pocket-goblin` there?

The step's Summary names the failing check and the fix. The database is not
contacted until this check passes.

Why this matters: the D1 endpoint returns the same
`401 — 10000: Authentication error` for an unrecognised token, a token ID
pasted instead of the token secret, a Global API Key, a doubled `Bearer`
prefix, and a missing header. This was confirmed against the live API with fake
credentials. The verify endpoint tells them apart (`1000: Invalid API Token`).

Spaces or line breaks around either secret are trimmed automatically and
reported as a warning.
