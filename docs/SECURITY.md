# Security — Pocket Goblin

## Threat model (summary)

Pocket Goblin stores personal life data (tasks, notes, documents, reminders). Primary risks: account takeover, cross-user data leaks, abuse of auth endpoints, and accidental exposure of document contents via logs or public storage.

## Controls in place

| Control            | Implementation                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------- |
| Password hashing   | PBKDF2-SHA256, 100k iterations (`worker/lib/passwords.ts`)                                    |
| Sessions           | Opaque token, hashed at rest, HttpOnly + SameSite=Lax cookie                                  |
| Secure cookie flag | Enabled when `ENVIRONMENT=production` (the `wrangler.toml` default)                           |
| API authz          | Session middleware; queries filter by `user_id`                                               |
| Cross-record links | Link targets (task/event/reminder ids) must belong to the caller (`worker/lib/ownership.ts`)  |
| AUTH_SECRET        | Production fails closed (503) without a 32+ character secret                                  |
| CORS               | Allowlist only (`worker/lib/cors.ts`); the SPA and API share one origin                       |
| Security headers   | CSP, frame denial, nosniff, referrer policy: `public/_headers` (SPA) + `secureHeaders` (API)  |
| Document access    | Authenticated download; storage keys user-scoped; no public bucket                            |
| Upload validation  | Size + MIME + magic-byte sniff (`validateUpload`)                                             |
| Auth rate limits   | Durable D1 counters (`auth_rate_limits`, hashed keys) for sign-in, sign-up, reset, verify     |
| Login lockout      | 10 wrong passwords per email per 15 min, whatever the IP (same reply for unknown accounts)    |
| CSRF               | Cross-site state-changing requests refused (Sec-Fetch-Site / Origin check, `worker/index.ts`) |
| Account emails     | Hashed single-use tokens; reset links revoked on password change; change/reset notices        |
| AI boundaries      | Structured JSON validation; prompt-injection fence on assist; user confirm before writes      |
| Secrets            | `.dev.vars` gitignored; no credentials in repo                                                |

## Verified isolation

`scripts/smoke-sprint6.mjs` journey F: Account B cannot patch Account A’s tasks/notes or delete events; document fetch denied; anonymous `/tasks` → 401.

## Known limitations

- CSRF: SameSite=Lax plus a server-side refusal of cross-site state-changing requests. Requests without browser headers (curl, Stripe) are left to their own checks (signatures, sessions).
- Auth limits are durable in D1 (migration 0018). Other limits (AI bursts aside, which are atomic in D1) are still per-isolate memory and act as abuse brakes only.
- The per-email lockout can be triggered by someone who knows an address (it pauses sign-in for 15 minutes; password reset still works).
- The `AUTH_SECRET` fallback is used only outside production; production refuses to serve without a real secret.
- HSTS is not set yet (domain-wide decision, pending owner approval).
- OAuth token storage schema exists; live Google/Microsoft exchange not configured — do not claim OAuth secure-complete until tested.
- No push channel. Account emails (verification, reset, password-changed) go through Cloudflare Email Service; bodies are never logged.
- Document contents must never be logged; current code paths avoid logging raw uploads.

## Reporting

Treat document and email (future) contents as untrusted. Instructions inside documents must never override application rules (prompt injection).
