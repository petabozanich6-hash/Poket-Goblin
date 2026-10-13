# Product audit — Sprint 6

Audited against `development` after Sprint 5 (`3ea9731`) plus Sprint 6 repairs.
Evidence from: source inspection, `npm run check`, `scripts/smoke-sprint6.mjs`, and browser verification on `http://localhost:5173`.

## Classification key

| Status                      | Meaning                                       |
| --------------------------- | --------------------------------------------- |
| Implemented and tested      | Code path + automated and/or browser evidence |
| Implemented but untested    | Code exists; limited automated coverage       |
| Partially implemented       | Works for common paths; gaps remain           |
| Placeholder only            | UI/API stub without real behaviour            |
| Not implemented             | Missing                                       |
| Blocked by external service | Needs credentials / paid infra / approval     |

## Sprint 1 — Core

| Feature                            | Status                 | Evidence                                        |
| ---------------------------------- | ---------------------- | ----------------------------------------------- |
| Auth register/login/logout/session | Implemented and tested | `worker/routes/auth.ts`; smoke A; browser login |
| Den dashboard                      | Implemented and tested | `HomePage` + briefing; browser                  |
| Brain dump capture + review        | Implemented and tested | smoke A/B; capture fallback now saves notes     |
| Tasks CRUD + complete              | Implemented and tested | smoke A/D/F                                     |
| Built-in categories                | Implemented and tested | seeded migration; TaskForm                      |
| Capacity modes + daily plan        | Implemented and tested | settings + `/plan/today`; smoke C               |
| Local D1 persistence               | Implemented and tested | re-login persistence in smoke A                 |

## Sprint 2 — Life management

| Feature               | Status                   | Evidence                                                   |
| --------------------- | ------------------------ | ---------------------------------------------------------- |
| Calendar appointments | Implemented and tested   | smoke C/D; `CalendarPage`                                  |
| Reminders             | Implemented and tested   | smoke D                                                    |
| Recurring tasks       | Partially → repaired     | Was capture-only; Sprint 6 adds TaskForm + POST recurrence |
| Notes                 | Implemented and tested   | smoke D/F                                                  |
| Shopping lists        | Implemented and tested   | smoke B/D                                                  |
| Universal search      | Implemented and tested   | smoke D/E                                                  |
| Task history          | Implemented but untested | history routes + UI on Life                                |
| Dashboard summaries   | Implemented and tested   | `/dashboard/den`; smoke D                                  |

## Sprint 3 — Intelligence

| Feature                               | Status                      | Evidence                                   |
| ------------------------------------- | --------------------------- | ------------------------------------------ |
| Rule-based interpret/breakdown/assist | Implemented and tested      | unit + smoke B/C; Ask page                 |
| AI provider                           | Blocked by external service | Needs `AI_API_KEY`; honest status endpoint |
| Task breakdown accept                 | Implemented and tested      | intelligence + tiny-step accept            |
| Capacity-aware planning               | Implemented and tested      | `worker/lib/plan.ts` + magical priorities  |
| Memory list/save/delete               | Implemented but untested    | routes exist; light UI in Ask              |
| Usage limits                          | Implemented and tested      | 429 path in intelligence usage             |

## Sprint 4 — Exploring

| Feature                           | Status                   | Evidence                                    |
| --------------------------------- | ------------------------ | ------------------------------------------- |
| Document vault (local R2/memory)  | Implemented and tested   | smoke E upload/search/delete/isolation      |
| Document processing → suggestions | Partially implemented    | text extract works; OCR blocked             |
| Voice capture                     | Implemented but untested | browser SpeechRecognition in QuickCapture   |
| Unified review inbox              | Implemented and tested   | review routes; capture creates review_items |
| Email/calendar OAuth sync         | Placeholder / blocked    | Honest not-connected; no fake inbox         |

## Sprint 5 — Magical

| Feature                     | Status                 | Evidence                              |
| --------------------------- | ---------------------- | ------------------------------------- |
| Daily briefing              | Implemented and tested | smoke C; browser Den                  |
| Overwhelm mode              | Implemented and tested | browser calm mode                     |
| Tiny First Step             | Implemented and tested | smoke C                               |
| Rescue My Day               | Implemented and tested | smoke C dismiss without silent change |
| In-app nudges + quiet hours | Implemented and tested | settings + nudge API                  |
| Personalisation Settings    | Implemented and tested | Settings page + `/me/settings`        |
| Optional gamification       | Implemented and tested | achievements on complete; can disable |
| Floating capture            | Implemented and tested | AppShell FAB; browser                 |

## Cross-cutting

| Area                     | Status                    | Notes                                      |
| ------------------------ | ------------------------- | ------------------------------------------ |
| Multi-user isolation     | Implemented and tested    | smoke F + document steal rejected          |
| Auth rate limiting       | Implemented and tested    | Sprint 6 `rateLimit` + unit tests          |
| Session expiry UX        | Implemented and tested    | `pg:session-expired` → login               |
| Push/email notifications | Not implemented / blocked | In-app only by design                      |
| Production artwork       | Placeholder               | Visual identity docs; no crop/emoji mascot |

## Dead ends / debt found

- Nav had 11 equal-weight destinations → Sprint 6 groups primary vs secondary (still all reachable).
- Capture discarded unstructured text with 400 → **fixed** (fallback note).
- Capture client omitted timezone offset → **fixed**.
- Recurring tasks only via capture accept → **fixed** (Task form + API).
- Cache invalidation missed briefing/review after accept → **fixed**.
- No auth rate limit → **fixed**.
- Side-Quest 404 noise on Worker logs when ports collide — ignore; not Pocket Goblin routes.

## Fresh DB migrations

Migrations `0001`–`0005` apply cleanly via `npm run db:migrate:local`. Sprint 6 did not add a destructive migration and did not reset local user data.
