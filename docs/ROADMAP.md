# Roadmap

## Sprint 1 — Core application

- [x] Design system + goblin mascot
- [x] App shell + responsive nav
- [x] Auth (register/login/session)
- [x] Den dashboard
- [x] Brain dump capture + review
- [x] Tasks create/edit/complete
- [x] Built-in life categories
- [x] Capacity modes + daily plan
- [x] Local D1 persistence via Worker API

## Sprint 2 — Life management

- [x] Calendar + appointments (month/week/agenda)
- [x] Reminders (in-app due list, snooze/dismiss/complete)
- [x] Recurring tasks (rule + occurrence generation)
- [x] Notes (create/edit/pin/delete/search)
- [x] Shopping lists (default groceries + checkoff)
- [x] Universal search
- [x] Task history
- [x] Unified brain-dump → multi-type records
- [x] Den dashboard integration

Known follow-ups inside Sprint 2 scope:

- [ ] Richer series edit UI (edit-all fields) beyond skip / pause / stop
- [ ] Email/push notification delivery (architecture ready; not configured)
- [ ] Drag-reorder shopping items in the UI (API supports sortOrder)
- [ ] Recurring calendar events UI (schema supports series; task recurrence is primary)

## Sprint 3 — The goblin gets a brain

- [x] Central intelligence service + structured suggestion schema
- [x] AI provider abstraction (OpenAI-compatible) with rule-based fallback
- [x] Richer multi-action brain-dump extraction + review
- [x] Task breakdown (tiny / normal / detailed) with accept-selected
- [x] Capacity-aware planning (appointments + effort + mode)
- [x] Ask the goblin assistant (grounded in user data)
- [x] Follow-up suggestions (confirm date before create)
- [x] User-controlled memory (list / save / delete)
- [x] Per-user daily usage limits + failure handling

Requires credentials to claim live AI interpret:

- [ ] Configure `AI_PROVIDER` + `AI_API_KEY` (and optional base URL / model) in Worker secrets

## Sprint 4 — The goblin goes exploring

- [x] Private document vault (local R2 / storage abstraction)
- [x] Upload / list / rename / download / delete + search
- [x] Document processing pipeline → reviewable suggestions
- [x] Source links (document ↔ task/event/reminder)
- [x] Voice brain-dump (browser speech recognition + fallback)
- [x] Unified review inbox
- [x] Email + calendar OAuth foundations (honest not-connected states)
- [x] Processing jobs table + inline local processing

Requires credentials / approval before claiming live:

- [ ] Remote R2 bucket (paid/remote) — local R2 only for now
- [ ] OCR provider for scanned images
- [ ] Google / Microsoft OAuth client secrets + completed token exchange
- [ ] Live email/calendar sync

## Sprint 5 — Polish & release prep

- [ ] Account management
- [ ] Accessibility + performance pass
- [ ] Optional gamification depth
- [ ] Security review + deployment prep
- [ ] Swap placeholder imagery for dedicated exports from the official asset library (see `docs/VISUAL_IDENTITY.md`)
