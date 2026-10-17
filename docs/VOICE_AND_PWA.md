# Talk to the Goblin & the installable app

“Throw the chaos at the Goblin. Let the Goblin sort it out.” One tap, one
sentence, job done — from any screen, or straight from the home screen.

Status: implemented on `claude/pocket-goblin-pwa-voice-991yas`, **not merged or
deployed**. Needs production migration `0013_goblin_voice.sql` (see “Before
production”).

## What was built

| Area                    | Where                                                                             |
| ----------------------- | --------------------------------------------------------------------------------- |
| Manifest, icons         | `public/manifest.webmanifest`, `public/icons/*` (from the official mascot)        |
| Service worker          | `public/sw.js` (app shell only, never `/api/*`), `public/offline.html`            |
| Registration, install   | `src/lib/pwa.ts`, `src/features/pwa/*` (install help, update prompt)              |
| Voice route             | `/voice` → `src/pages/VoicePage.tsx` (no dashboard around it)                     |
| Floating microphone     | `src/features/voice/VoiceFab.tsx` on every main screen                            |
| Speech in / out         | `src/features/voice/speech.ts`, `tts.ts` (browser APIs only)                      |
| Offline capture         | `src/features/voice/offlineQueue.ts`, `useOfflineSync.ts`                         |
| Personalisation UI      | Settings → **Get to Know Your Goblin** (`GoblinSettings.tsx`)                     |
| Understanding           | `shared/goblin/address.ts`, `conversation.ts`, `language.ts` (extended)           |
| Replies in chosen style | `shared/goblin/voiceStyle.ts`                                                     |
| Conversation API        | `POST /api/goblin/converse` → `worker/lib/goblin/converse.ts`                     |
| Profile / expressions   | `/api/goblin/profile`, `/api/goblin/expressions` → `worker/lib/goblin/profile.ts` |
| Schema                  | `migrations/0013_goblin_voice.sql`                                                |

## How a request flows

1. **Capture** — tap the microphone (or type). Push-to-talk keeps listening
   through natural pauses and stops after ~2.5 s of quiet, 60 s total, or a tap.
2. **Transcript** — the browser’s `SpeechRecognition` / `webkitSpeechRecognition`.
3. **Address removed** — “Oi Goblin,” “Excuse me, good sir Mr Goblin, might I
   trouble you for…”, “Yo Gobbo,” and the person’s own names are stripped.
   No name or phrase is ever required.
4. **Expressions** — the person’s taught phrases are swapped for what they said
   they mean (interpretation only).
5. **Understanding** — conversational concepts (a time, schedule words, “can
   wait”, a pointer like “them”, undo, yes/no) are recognised; record requests
   go to the existing action engine (`worker/lib/goblin/act.ts`).
6. **Validation & authorisation** — every operation is a typed plan; every SQL
   statement is scoped by the signed-in user’s id. Speech is treated as
   untrusted input: it only ever selects among fixed plan types.
7. **Confirmation** — safe, reversible single additions happen straight away
   with Undo. Bulk or consequential changes (moving tasks, changing or
   cancelling appointments) are proposed and need a “yes”. Appointments are
   never moved automatically.
8. **Execute → verify** — the reply is built from what the database actually
   did; nothing is announced before it succeeds.
9. **Reply** — one short line in the chosen style (facts first; humour only
   after the facts, never during anything sensitive), optionally spoken.

Anything the rules can’t place is never lost: it goes to the existing
brain-dump review (“kept for you to check”), which uses Workers AI when the
budget allows and the rule engine otherwise.

## What people can say (examples covered by tests)

- Shopping: “I need milk”, “Milk.”, “Also bread.”, “We’re out of washing
  powder”, “Chuck milk on the shopping list”, “Put coffee on my list”,
  “…ensure dairy products are included in my next expedition to the supermarket”.
- Tasks/reminders: “Remind me to call Mum on Thursday”, “I need to pay that bill
  before Friday”, “Add washing the car to my tasks”, “I forgot to call the
  dentist”, “The washing needs doing”.
- The day: “What’s on today?”, “What’s the damage tomorrow?”, “What fresh hell
  awaits?”, “Anything happening this weekend?”, “Am I free Thursday afternoon?”,
  “Lord Reginald, kindly review today’s appointments”.
- Priorities: “What’s overdue?”, “What’s absolutely essential today?”,
  “I’ve forgotten what I was supposed to be doing”, “Help me work out what matters”.
- Deferring: “Which ones can wait?” → “Move them” → “Yes”; “Can we make
  tomorrow’s problem tomorrow’s problem?” (proposes, then asks).
- Correcting: “Actually, remove that”, “Undo”, “No, leave it”.
- Brain dumps: “We need milk, and I forgot to call the dentist, and the washing
  needs doing” → three real records.

A bare word that isn’t clearly shopping (“Passport”) gets one question with
buttons rather than a guess.

**Honest limits.** Understanding is deterministic: it recognises concepts and
common phrasings, not every possible sentence. Elaborate or unusual wording
falls through to the review flow rather than acting. The Goblin understands
English; other recognition languages transcribe but may not be understood.

## Personalisation (“Get to Know Your Goblin”, all optional)

Name (default “Goblin” — always still recognised), nicknames, style
(Friendly / Professional / Chaotic / Quiet), humour (none / a little / plenty),
reply length, spoken replies, voice, speed, volume, speech language,
hands-free availability, and taught expressions (“When I say X, I mean Y”;
up to 50, editable, deletable). **Reset personalisation** deletes the profile,
expressions and follow-up context. Expressions cannot bypass confirmations:
the meaning goes through exactly the same engine (tested).

## Hands-free (optional, off by default)

Enabled in settings, then started explicitly on the voice screen. It:

- only runs while Pocket Goblin is open and visible (stops when hidden);
- acts only on speech that starts with one of the Goblin’s names, or a
  follow-up within 20 s of a reply; other talk in the room is discarded unseen;
- stops after 5 minutes, after 90 s with nothing addressed to it, or after a
  bounded number of browser-initiated restarts; never loops;
- pauses the microphone while the Goblin is speaking;
- is unavailable (push-to-talk remains) where recognition isn’t supported.

**No system-wide wake word.** No website can listen while the app is closed,
suspended or the device is locked, and this one doesn’t try.

## Browser support (as implemented; real devices not yet tested)

| Browser                    | Install                                   | Voice input                                                      | Shortcuts (long-press)      |
| -------------------------- | ----------------------------------------- | ---------------------------------------------------------------- | --------------------------- |
| Android Chrome             | Install prompt / menu                     | Yes (Google’s servers)                                           | Yes, “Talk to Goblin”       |
| Samsung Internet           | Avoid WebAPK install while Play Protect warnings persist; use Chrome or browser | Varies by version — feature-detected               | Support varies; verify      |
| iPhone/iPad Safari         | Share → Add to Home Screen (instructions) | Safari 14.5+ (Apple, server or on-device)                        | Not supported by iOS        |
| iOS installed web app      | —                                         | Historically unreliable in home-screen mode; typing always works | Not supported               |
| Desktop Chrome / Edge      | Install icon / prompt                     | Yes (vendor servers)                                             | Yes, in the app’s jump list |
| Desktop Safari (macOS 14+) | File → Add to Dock                        | Yes                                                              | No                          |
| Firefox                    | Android only                              | No (typing offered automatically)                                | No                          |

Verified automatically: headless Chromium (Playwright) for install
conditions (manifest + service worker), offline save-and-sync, the voice flow
with a scripted recogniser, denied permission, missing recognition, phone
layout and personalisation. **Not verified:** any physical phone, real speech
services, Samsung Internet, Safari/iOS.

\n**Android Play Protect / Samsung Internet (October 2026):** Samsung Internet
may generate a PWA installation package that Play Protect blocks with
“built for an older version of Android” and missing privacy protections.
This is a browser-generated Android package issue, not a setting in the
website's web manifest. The in-app install button is suppressed in Samsung
Internet. Users are directed to try current Chrome, or simply use the
website; if any browser shows a security warning, cancel rather than bypass
it. Chrome installation is not guaranteed on every device. Do not recommend
disabling Play Protect. Track upstream reports at
https://github.com/SamsungInternet/support/issues/123 and
https://issuetracker.google.com/issues/569517876.
\n
## Offline

- The app shell (HTML, built JS/CSS, icons) is cached; pages open offline.
- `/api/*` is **never** cached: no personal data is stored by the service worker.
- Typed thoughts while offline are saved on the device (per account, with a
  request id), shown as “Saved on this device”, and sent when the connection
  returns. The request id makes re-sends safe: the server replays its first
  answer instead of acting twice.
- Offline items are understood as of when they were said (within 7 days).
  “Yes”, “undo” and “move them” are never applied late.
- Voice recognition generally needs a connection; offline, the screen says so
  and offers typing.
- Signing out with unsent thoughts asks first.

## Privacy & security

- No audio is recorded or stored. A one-time notice explains that the browser’s
  speech service converts speech to text (and where), before the mic is used.
- Microphone state is always visible (listening / working / not listening /
  blocked / unavailable); Cancel discards the words; “Stop talking” interrupts speech.
- Transcripts are not stored. Server tables hold: preferences, taught phrases,
  record ids for a 10-minute follow-up window, and replay records (response
  only, deleted after 2 days by the hourly job). Exported in “Your data”
  where they are the person’s content; all removed with the account.
- All queries are scoped by the authenticated user; cross-account undo,
  replay ids and expressions are covered by tests.
- Rate limit: 60 conversation turns per user per minute.
- `Permissions-Policy: microphone=(self)` was already in place.

## Costs

| Function                      | Runs on                      | Cost                                                                             |
| ----------------------------- | ---------------------------- | -------------------------------------------------------------------------------- |
| Speech-to-text                | The person’s browser         | Free to Pocket Goblin                                                            |
| Spoken replies                | Browser `speechSynthesis`    | Free                                                                             |
| Understanding, replies, undo  | Existing Worker + D1 (rules) | Normal Worker/D1 usage, tiny                                                     |
| Leftover thoughts → review    | Existing brain-dump path     | Workers AI only within the existing caps (`AI_DAILY_GLOBAL_LIMIT = 5`/day today) |
| Service worker, offline queue | Browser                      | Free                                                                             |

No new services, keys, subscriptions or bindings. The conversation endpoint
makes **no AI calls**. With the global AI cap at 5/day, almost all
understanding is rule-based; raising the cap is an owner decision.

## Before production

1. Review and merge (not done; no deployment performed).
2. Apply `0013_goblin_voice.sql` with the approval-gated workflow
   (`docs/D1_MIGRATIONS.md`) **before** the Worker deploy.
3. Deploy; confirm `https://pocketgoblin.org/manifest.webmanifest` and
   `/sw.js` return 200 with `Cache-Control: no-cache`.
4. Run the device checklist below.
5. Update the privacy policy draft (speech-processing section added).

## Device checklist for the owner

- [ ] Android Chrome: install from the prompt; icon and name correct; long-press → “Talk to Goblin” opens `/voice`.
- [ ] Android: first tap shows the speech notice; “OK” starts listening; “I need milk” adds Milk; Undo works.
- [ ] Android: deny the microphone → clear message; typing still works; re-allow in site settings.
- [ ] Samsung Internet: install via menu; check whether shortcuts and voice are offered.
- [ ] iPhone Safari: install via Share → Add to Home Screen; open from the icon; tap the mic (if voice is missing in home-screen mode, typing must work).
- [ ] iPhone: spoken replies on; pick a voice; “Stop talking” interrupts.
- [ ] Airplane mode: open the installed app; type “buy eggs” → “Saved on this device”; reconnect → sent once, Eggs appears once.
- [ ] Hands-free (enable in settings): “Goblin, what’s on today?” works; unrelated chat is ignored; locking the phone stops it.
- [ ] Desktop Chrome/Edge: install; update prompt appears after a new deploy and reloads only when pressed.
- [ ] Log out with an unsent offline thought → asked first.
