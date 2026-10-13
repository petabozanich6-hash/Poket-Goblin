# Security — Pocket Goblin

## Threat model (summary)

Pocket Goblin stores personal life data (tasks, notes, documents, reminders). Primary risks: account takeover, cross-user data leaks, abuse of auth endpoints, and accidental exposure of document contents via logs or public storage.

## Controls in place

| Control            | Implementation                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------- |
| Password hashing   | PBKDF2-SHA256, 100k iterations (`worker/lib/passwords.ts`)                               |
| Sessions           | Opaque token, hashed at rest, HttpOnly + SameSite=Lax cookie                             |
| Secure cookie flag | Enabled when `ENVIRONMENT=production`                                                    |
| API authz          | Session middleware; queries filter by `user_id`                                          |
| Document access    | Authenticated download; storage keys user-scoped; no public bucket                       |
| Upload validation  | Size + MIME + magic-byte sniff (`validateUpload`)                                        |
| Auth rate limits   | In-memory per IP buckets on register/login (Sprint 6)                                    |
| AI boundaries      | Structured JSON validation; prompt-injection fence on assist; user confirm before writes |
| Secrets            | `.dev.vars` gitignored; no credentials in repo                                           |

## Verified isolation

`scripts/smoke-sprint6.mjs` journey F: Account B cannot patch Account A’s tasks/notes or delete events; document fetch denied; anonymous `/tasks` → 401.

## Known limitations

- CSRF: relies on SameSite=Lax + cookie not readable by JS; no separate CSRF token (acceptable for same-site SPA; revisit for cross-site embeds).
- Rate limits are per-isolate memory — resets on Worker recycle; fine for local/dev, strengthen for production edge.
- Default `AUTH_SECRET` fallback exists for local only — **must** set a strong secret before any shared deployment.
- OAuth token storage schema exists; live Google/Microsoft exchange not configured — do not claim OAuth secure-complete until tested.
- No push/email channels — reduces accidental PII leakage via third-party notification providers.
- Document contents must never be logged; current code paths avoid logging raw uploads.

## Reporting

Treat document and email (future) contents as untrusted. Instructions inside documents must never override application rules (prompt injection).
