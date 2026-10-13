# Floot inventory — required migration inputs

**Status:** Awaiting original Floot source.  
This checklist is based on the known Pocket Goblin feature set. Fill in
concrete paths, names, and schemas when the export is available. Do not guess
implementation details.

## How to use

For each section, paste the real Floot path or mark `N/A`.  
Update checkboxes as items are located and copied into this repo.

---

## 1. Application shell & tooling

| Item                  | Needed | Floot location (TBD)      | Notes                                         |
| --------------------- | ------ | ------------------------- | --------------------------------------------- |
| Package manifest      | Yes    | `package.json` / lockfile | Confirm React, Router, Query, Lucide versions |
| TypeScript config     | Yes    | `tsconfig*.json`          | Align strictness with this repo               |
| Build config          | Yes    | Vite/Webpack/etc.         | Prefer Vite; adapt if Floot differs           |
| Env templates         | Yes    | `.env*` (redact secrets)  | Map to `.env.example` / `.dev.vars.example`   |
| Router definition     | Yes    | routes file(s)            | Preserve path structure where possible        |
| Global styles / theme | Yes    | global CSS / tokens       | Goblin theme tokens, fonts                    |
| App entry / providers | Yes    | `main` / `App`            | Auth + Query providers                        |

---

## 2. Feature areas (UI)

Known product capabilities — locate corresponding Floot modules:

| Feature                               | Required artefacts                          | Floot path(s) | Migrated? |
| ------------------------------------- | ------------------------------------------- | ------------- | --------- |
| Authentication (sign-in / session UI) | pages, forms, guards                        | _TBD_         | [ ]       |
| Smart task capture                    | capture UI, parsers, shortcuts              | _TBD_         | [ ]       |
| Voice dictation                       | mic UI, speech hooks, permissions copy      | _TBD_         | [ ]       |
| AI-assisted organisation              | prompts UI, suggestion lists, accept/reject | _TBD_         | [ ]       |
| Capacity-aware planning               | capacity settings, day/week views           | _TBD_         | [ ]       |
| Task management                       | lists, detail, status, filters              | _TBD_         | [ ]       |
| Email integrations                    | connect UI, inbox/task linking              | _TBD_         | [ ]       |
| Document uploads                      | upload controls, previews, attachments      | _TBD_         | [ ]       |
| Goblin-themed interface               | layout chrome, illustrations, copy          | _TBD_         | [ ]       |

### Component checklist

List every shared and feature component when source arrives:

```
# Example format — replace with real inventory
# src/components/Button.tsx
# src/features/tasks/TaskList.tsx
```

_Pending Floot export._

---

## 3. API endpoints

Enumerate Floot HTTP/RPC routes. Target home: Cloudflare Worker.

| Method | Path / procedure | Auth  | Purpose               | Floot handler path | Worker target  |
| ------ | ---------------- | ----- | --------------------- | ------------------ | -------------- |
| _TBD_  | _TBD_            | _TBD_ | Auth                  | _TBD_              | `worker/`      |
| _TBD_  | _TBD_            | _TBD_ | Tasks CRUD            | _TBD_              | `worker/`      |
| _TBD_  | _TBD_            | _TBD_ | Capture / AI          | _TBD_              | `worker/`      |
| _TBD_  | _TBD_            | _TBD_ | Voice / transcription | _TBD_              | `worker/`      |
| _TBD_  | _TBD_            | _TBD_ | Email sync / OAuth    | _TBD_              | `worker/`      |
| _TBD_  | _TBD_            | _TBD_ | Uploads               | _TBD_              | `worker/` + R2 |
| _TBD_  | _TBD_            | _TBD_ | Capacity / planning   | _TBD_              | `worker/`      |

OpenAPI / route tables from Floot (if any): _TBD_

---

## 4. Database schemas

Target: Cloudflare D1 (SQLite). Do not provision until this section is complete.

| Table / collection   | Purpose                 | Floot definition path | Notes for D1    |
| -------------------- | ----------------------- | --------------------- | --------------- |
| users                | Accounts                | _TBD_                 |                 |
| sessions / auth      | Sessions/tokens         | _TBD_                 |                 |
| tasks                | Task entities           | _TBD_                 |                 |
| tags / labels        | Organisation            | _TBD_                 |                 |
| capacity / planning  | Energy/time budgets     | _TBD_                 |                 |
| integrations         | Email OAuth tokens etc. | _TBD_                 | Encrypt secrets |
| attachments metadata | File references         | _TBD_                 | Blobs → R2      |
| AI / capture logs    | Optional audit          | _TBD_                 | Privacy review  |

Also collect:

- [ ] Indexes and unique constraints
- [ ] Enums / status values used in UI
- [ ] Seed / demo data (if any)
- [ ] Migration history from Floot (if any)

---

## 5. Assets & media

| Asset class         | Examples              | Floot path | Target in repo                 |
| ------------------- | --------------------- | ---------- | ------------------------------ |
| Brand / goblin art  | illustrations, mascot | _TBD_      | `src/assets/` or `public/`     |
| Icons (non-Lucide)  | custom SVGs           | _TBD_      | `src/assets/`                  |
| Fonts               | webfonts / licenses   | _TBD_      | `public/fonts/` + license file |
| Sound (if any)      | feedback audio        | _TBD_      | `public/`                      |
| User-upload samples | fixtures for tests    | _TBD_      | gitignored or `fixtures/`      |

License / attribution notes: _TBD_

---

## 6. Integrations & external services

| Integration        | Used for               | Client vs server | Env vars (names only) | Floot config path |
| ------------------ | ---------------------- | ---------------- | --------------------- | ----------------- |
| Auth provider      | Login                  | _TBD_            | _TBD_                 | _TBD_             |
| AI provider        | Organisation / capture | Server only      | _TBD_                 | _TBD_             |
| Speech / STT       | Voice dictation        | _TBD_            | _TBD_                 | _TBD_             |
| Email provider     | Ingest / send          | Server only      | _TBD_                 | _TBD_             |
| Object storage     | Documents              | Server           | → R2                  | _TBD_             |
| Analytics (if any) | Product metrics        | _TBD_            | _TBD_                 | _TBD_             |

**Rule:** No real credentials in this document or in git.

---

## 7. Auth & security artefacts

- [ ] Auth flow diagrams or middleware code
- [ ] Session cookie / JWT shape
- [ ] Role / permission model (if any)
- [ ] CORS and allowed origins
- [ ] File upload validation rules
- [ ] Rate limiting behaviour
- [ ] Content security policy (if configured)

---

## 8. Tests & fixtures

| Kind             | Floot path | Action               |
| ---------------- | ---------- | -------------------- |
| Unit tests       | _TBD_      | Port with components |
| E2E tests        | _TBD_      | Re-point at new URLs |
| Fixtures / mocks | _TBD_      | Sanitize PII         |

---

## 9. Data export (for cutover)

- [ ] User export format documented
- [ ] Attachment binary export method
- [ ] OAuth token re-consent plan (likely required; cannot always migrate tokens)
- [ ] Retention / deletion policy notes

---

## 10. Intake package checklist (what to provide next)

When ready, supply from Floot:

1. Full application source tree (frontend + backend).
2. Database schema dump or ORM models.
3. List of environment variable **names** (values via secure channel).
4. Static assets and font licenses.
5. API route list or generated docs.
6. Notes on any Floot platform APIs that must be replaced (hosted auth, file
   storage, cron, etc.).

Until that package arrives, this repository remains a **migration-ready shell**
with a temporary landing page only.
