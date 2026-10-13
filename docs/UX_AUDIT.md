# UX audit — Sprint 5 (pre-build)

Audited against `development` at Sprint 4 tip (`a3317f7`). Only verified behaviour is listed as working.

## What genuinely works (Sprints 1–4)

| Area                                      | Status                                    |
| ----------------------------------------- | ----------------------------------------- |
| Auth, sessions, multi-user D1 isolation   | Working                                   |
| Den dashboard summary cards               | Working (list-heavy, not a briefing)      |
| Brain dump + review + multi-type accept   | Working                                   |
| Tasks, capacity plan, categories          | Working                                   |
| Calendar, reminders, notes, shopping      | Working                                   |
| Universal search (LIKE)                   | Working but shallow                       |
| Ask / intelligence with rule fallback     | Working                                   |
| Document vault (local R2) + review inbox  | Working                                   |
| Voice capture (browser SpeechRecognition) | Working where supported                   |
| OAuth / email / calendar sync             | Foundations only — honest “not connected” |

## Critical / high priority (fix before new magic)

1. **Den is a dashboard wall** — many equal-weight cards; ADHD load is high. Needs a briefing that surfaces what matters.
2. **No overwhelm escape hatch** — capacity mode exists but no calm single-focus mode.
3. **Task breakdown is Ask-page oriented** — “Help me start” is not on the task list; `breakdown/accept` always creates a _new_ parent instead of attaching steps to an existing task.
4. **Nav overload** — 10 primary destinations + theme/logout; Settings missing; capture only on Den/Dump.
5. **Search hrefs** — notes → `/notes`, shopping → `/shopping` (redirects); documents not searched.
6. **Gamification copy** — random cheer in TaskList; no opt-in depth or milestones; personality inconsistent.
7. **Notification prefs** — reminders exist in-app; no quiet hours, frequency, or mute controls.
8. **Accessibility gaps** — mobile nav is horizontal scroll only; overwhelm/focus modes absent; some icon buttons need clearer labels; touch targets vary.

## Medium priority

- Contextual actions (remind / link / prepare) are incomplete across entity types.
- No persistent global capture control.
- No Rescue My Day path when a plan collapses.
- Personalisation limited to capacity + theme + gamification flag.
- Empty/error/loading states uneven across pages.

## Low / deferred

- Richer recurrence series edit UI (known Sprint 2 follow-up).
- Live email/calendar/OCR/remote R2 (needs credentials/approval).
- Push/email delivery channels (not configured — must stay opt-in and honest).

## Prioritised Sprint 5 response

1. Ship briefing, overwhelm mode, tiny first step (on existing tasks), Rescue My Day.
2. In-app nudges + quiet hours (no fake push).
3. Explainable prioritisation + universal capture + contextual actions + search fixes.
4. Personality docs + optional gamification + Settings personalisation.
5. Accessibility and reliability pass on touched surfaces.
