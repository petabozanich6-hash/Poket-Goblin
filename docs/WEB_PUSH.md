# Web Push — safe release plan

Status: **feature PR only** until D1 migration 0024 has been applied and VAPID secrets have been configured.
This is **browser Web Push for the existing PWA**, not native Apple/Android push.

## What it sends
- Opt-in per signed-in device, via Settings. Never asks automatically or sends marketing.
- Generic lock-screen text only (the service worker never shows task titles, health notes or support message contents).
- A visible notification when a reminder is due, polled by the 5-minute Cloudflare Cron Trigger, with durable deduplication.
- A visible notification when Goblin HQ replies to a support thread.
- One recipient/account's endpoints are scoped to their authenticated session. Logout/account deletion revokes server subscription rows through ON DELETE CASCADE.
- Uses the user's existing quiet-hour preferences in the device's IANA timezone.
- No notification history database of private content; no AI service or external push provider account.

## Requirements and manual configuration (owner)
1. Create a *separate schema-only PR* with `migrations/0024_web_push.sql`, merge it into main, run D1 migrations (production) preflight, then the protected apply run. Verify zero pending migrations. **Do not deploy the feature before step 1.**
2. Generate a fresh ES256 / P-256 VAPID key pair securely, e.g.
   `npx web-push generate-vapid-keys` (use `npx -p web-push web-push generate-vapid-keys` if necessary).
3. In Cloudflare Worker secrets (never in wrangler.toml or repository), set:
   - `VAPID_PUBLIC_KEY`: uncompressed P-256 point, base64url (~87 chars);
   - `VAPID_PRIVATE_KEY`: P-256 private scalar, base64url (~43 chars);
   - `VAPID_SUBJECT`: a real `mailto:` support contact or an https URL.
   Keep the public/private keys together, don't rotate silently: changing keys invalidates existing device subscriptions.
4. Confirm secrets appear in deployed `pocket-goblin` Worker. The Settings card reports 'not configured' until all three are present/valid.
5. Merge feature PR after required CI, verify automatic Workers Build, then smoke-test Android Chrome, desktop Chrome/Firefox, and Safari; iOS 16.4+ requires Home Screen installation before permission can be requested.
6. Confirm a new reminder causes one push, snooze causes one *new* push after snooze expires, and HQ reply causes one push. Test quiet hours, opt-out, logout, expired sessions, and suspended users.

No endpoint URLs or VAPID private key should be printed in logs. Subscriptions only allow known Mozilla/Google/Apple push service hosts, preventing SSRF. Network failures never block reminders or owner replies.

## Honest limitations
- Generic alerts link to the Den; no confidential data in push messages.
- Cron runs every five minutes, not exact-to-the-second.
- In-app nudges remain in-app; only explicit reminders + owner support replies trigger push.
- Permission is browser-controlled. Denied permission must be changed in browser/device settings.
- Subscription renewal after a browser rotates its endpoint requires enabling again in Settings.
- If a user signs out, their session-scoped subscription stops working, even if the device still reports browser permission; re-enable after the next sign in.
