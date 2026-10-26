# Push notifications

Opt-in web push for Pocket Goblin: reminders when they're due, a morning
check-in (on by default once someone turns notifications on), an optional
evening check-in, and a heads-up when Goblin HQ replies to a support message.

## How it works

1. **Turning on** (Settings → Notifications, or the Den prompt): the browser
   asks for permission, subscribes with our VAPID public key, and the app
   posts the push endpoint and the device's time zone to
   `POST /api/push/subscriptions`. Only known push-service hosts are
   accepted (Google FCM, Mozilla, Apple, Microsoft WNS). The device is
   tied to the session that registered it, so signing out removes it. The
   app re-registers on every open, which moves a device to a new session
   after signing back in.
2. **Every minute** (Cron Trigger `* * * * *`, `runPushTick` in
   `worker/lib/push/deliver.ts`):
   - It queues reminders that just came due (or whose snooze ran out) and
     check-ins whose local time has arrived, into `push_notices`. Notices
     hold a kind and a record id or day, never text, and are unique, so
     nothing is announced twice.
   - It sends each person's devices an **empty** VAPID-signed push. There
     are at most 40 sends per run; the rest go the next minute.
   - Goblin HQ replies wait out the person's quiet hours. Reminders don't:
     the person chose that time.
   - Devices whose push service answers 404/410 are forgotten. Devices whose
     session ran out get one last wake, which shows "sign back in", and are
     then forgotten.
3. **On the device**, the service worker (`public/sw.js`) fetches
   `GET /api/push/notices?endpoint=…` with the session cookie and shows what
   comes back. Each device shows each notice once. Reminder notifications
   have Done and "In 10 min" buttons where the platform supports them
   (Android, desktop).

No notification text passes through Google, Apple, Mozilla or Microsoft. On
lock screens, check-ins show counts only. A reminder shows its own text.

## Owner setup (required before it works)

Until both secrets are set, the app shows "Notifications are nearly ready"
and the minute run does nothing.

1. Apply migrations `0024_web_push.sql` and `0026_push_notifications.sql`
   through the approval-gated D1 workflow (`docs/D1_MIGRATIONS.md`). Both
   are additive.
2. Generate the key pair once, on your own computer:

   ```sh
   npm run push:keys
   ```

3. In the Cloudflare dashboard, go to Workers & Pages → pocket-goblin →
   Settings → Variables and Secrets, and add both values as **Secrets** (not
   plain variables): `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`.
   Alternatively, run `npx wrangler secret put VAPID_PUBLIC_KEY` and the same
   for the private key. Secrets survive deploys.
   Optional: `VAPID_SUBJECT` (defaults to `mailto:support@pocketgoblin.org`).
4. Keep the private key safe. Changing the keys later means everyone has to
   turn notifications on again.

The `* * * * *` Cron Trigger in `wrangler.toml` takes effect on the next
deploy. It costs one short invocation a minute and returns immediately while
the secrets or tables are missing.

## iPhone and iPad

Safari only delivers web push to the **home-screen app** (iOS/iPadOS 16.4
or later). In Safari the Settings card explains this. Once someone opens
Pocket Goblin from the home screen, the Turn on button appears.

## Testing locally

- Unit and integration tests: `npx vitest run worker/push.test.ts`. They
  check VAPID signatures, endpoint allow-listing, local-time check-ins,
  quiet hours, de-duplication, gone and expired devices, and the export.
- Browser test: `e2e/push.spec.ts`. Start the local Worker with
  `--test-scheduled` and both `--var VAPID_…` keys; the spec skips
  otherwise. A test browser can't reach a real push service, so the spec
  registers a stand-in endpoint and wakes the service worker through the
  DevTools protocol.
