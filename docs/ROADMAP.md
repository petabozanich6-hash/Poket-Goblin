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

Known follow-ups:

- [ ] Richer series edit UI (edit-all fields) beyond skip / pause / stop
- [ ] Email/push notification delivery (architecture ready; not configured)
- [ ] Drag-reorder shopping items in the UI (API supports sortOrder)
- [ ] Recurring calendar events UI (schema supports series; task recurrence is primary)

## Sprint 3 — The goblin gets a brain

- [x] Central intelligence service + structured suggestion schema
- [x] AI provider abstraction with rule-based fallback
- [x] Richer multi-action brain-dump extraction + review
- [x] Task breakdown with accept-selected
- [x] Capacity-aware planning
- [x] Ask the goblin assistant
- [x] Follow-up suggestions
- [x] User-controlled memory
- [x] Per-user daily usage limits

Requires credentials:

- [ ] Configure `AI_PROVIDER` + `AI_API_KEY` for live AI interpret

## Sprint 4 — The goblin goes exploring

- [x] Private document vault (local R2 / storage abstraction)
- [x] Upload / list / rename / download / delete + search
- [x] Document processing pipeline → reviewable suggestions
- [x] Source links
- [x] Voice brain-dump (browser speech recognition + fallback)
- [x] Unified review inbox
- [x] Email + calendar OAuth foundations (honest not-connected states)

Requires credentials / approval:

- [ ] Remote R2, OCR, live Google/Microsoft OAuth sync

## Sprint 5 — Make it magical

- [x] UX audit + daily briefing
- [x] Overwhelm mode, Tiny First Step, Rescue My Day
- [x] In-app nudges + quiet hours
- [x] Explainable prioritisation, floating capture, Settings
- [x] Optional gamification + personality docs

## Sprint 6 — Great goblin inspection

- [x] Product audit (`docs/PRODUCT_AUDIT.md`) with evidence-based status
- [x] End-to-end API journeys A–F (`npm run smoke:sprint6`)
- [x] Multi-user isolation verification
- [x] Capture never discards unstructured thoughts
- [x] Auth rate limiting + session-expiry recovery
- [x] Recurring tasks creatable from Task form
- [x] Navigation grouping + skip link
- [x] Cache invalidation across shelves after capture accept
- [x] Playwright first-run e2e + testing/security docs
- [x] Roadmap + architecture updated to match reality

## Sprint 7 — One goblin, one calm interface

- [x] Official single mascot prepared (transparent WebP/PNG)
- [x] Mascot only in Den welcome area
- [x] Removed repeated character art elsewhere
- [x] Restrained surface tokens; Lucide nav retained
- [x] Docs: `docs/ARTWORK_INTEGRATION.md`

Remaining limitations (honest):

- [ ] Live AI / OAuth / remote R2 / OCR / push-email
- [ ] Full WCAG audit beyond critical surfaces
- [ ] Production AUTH_SECRET + deployment hardening
