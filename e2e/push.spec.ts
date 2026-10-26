import { expect, test } from '@playwright/test'

/**
 * Notifications in a real browser, up to the push service itself (which a
 * test browser can't reach): the Den offers them, the device registers, the
 * minute run finds a due reminder, and the service worker, woken the way a
 * push service would wake it, shows the reminder's words fetched from us.
 *
 * Needs the local Worker started with VAPID keys and scheduled-event testing:
 *   npm run push:keys   # then
 *   wrangler dev --port 8787 --local --test-scheduled \
 *     --var VAPID_PUBLIC_KEY:… --var VAPID_PRIVATE_KEY:… (plus the usual vars)
 * Skipped otherwise.
 */
const WORKER = 'http://127.0.0.1:8787'
const FAKE_DEVICE = 'https://fcm.googleapis.com/fcm/send/e2e-test-device'

test('notifications: offer, register, deliver a due reminder', async ({
  page,
  context,
  baseURL,
}) => {
  await context.grantPermissions(['notifications'])
  await page.goto('/')
  await page.getByRole('tab', { name: 'Register' }).click()
  await page.getByLabel('What should the goblin call you?').fill('Push Goblin')
  await page.getByLabel('Email').fill(`push_${Date.now()}@example.com`)
  await page.getByLabel('Password').fill('PushE2ePass!9')
  await page.getByRole('button', { name: /create account/i }).click()
  await expect(page).toHaveURL(/\/den/, { timeout: 20_000 })
  await page
    .getByRole('dialog', { name: 'Welcome to the Den' })
    .waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: 'I’ll figure it out' }).click()

  const status = await (await page.request.get('/api/push')).json()
  test.skip(!status.configured, 'Worker started without VAPID keys')

  // The Den offers notifications; "Not now" puts it away.
  await expect(page.getByTestId('push-nudge')).toBeVisible()
  await page.getByRole('button', { name: 'Not now' }).click()
  await expect(page.getByTestId('push-nudge')).toHaveCount(0)

  // Install the service worker the way "Turn on" does, then register a device
  // directly (a test browser has no route to a real push service).
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    await navigator.serviceWorker.ready
  })
  const cdp = await context.newCDPSession(page)
  const registrationId = new Promise<string>((resolve) => {
    cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
      const r = registrations.find((x) => x.scopeURL.startsWith(baseURL!))
      if (r && !r.isDeleted) resolve(r.registrationId)
    })
  })
  await cdp.send('ServiceWorker.enable')
  expect(
    (
      await page.request.post('/api/push/subscriptions', {
        data: { endpoint: FAKE_DEVICE, timezone: 'Australia/Sydney' },
      })
    ).status(),
  ).toBe(201)

  // A reminder due now, then the minute run.
  await page.request.post('/api/reminders', {
    data: { title: 'Take the bins out', remindAt: new Date().toISOString() },
  })
  const tick = await fetch(`${WORKER}/cdn-cgi/handler/scheduled?cron=*+*+*+*+*`)
  expect(tick.ok).toBe(true)

  // Wake the service worker as a push service would.
  await cdp.send('ServiceWorker.deliverPushMessage', {
    origin: new URL(baseURL!).origin,
    registrationId: await registrationId,
    data: '',
  })
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const reg = await navigator.serviceWorker.ready
          return (await reg.getNotifications()).map((n) => ({
            title: n.title,
            body: n.body,
          }))
        }),
      { timeout: 10_000 },
    )
    .toEqual([{ title: 'Reminder', body: 'Take the bins out' }])

  // Settings shows the device controls, laid out for a phone.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/settings#notifications')
  await expect(
    page.getByRole('heading', { name: 'Notifications' }),
  ).toBeVisible()
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)
})

test('notifications: turn on from Settings, choose check-ins, turn off', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['notifications'])
  // Stand in for the browser's push service, which a test browser can't reach.
  await page.addInitScript((endpoint) => {
    let current: PushSubscription | null = null
    const fake = {
      endpoint,
      unsubscribe: async () => {
        current = null
        return true
      },
    } as unknown as PushSubscription
    PushManager.prototype.subscribe = async () => (current = fake)
    PushManager.prototype.getSubscription = async () => current
  }, FAKE_DEVICE)
  await page.goto('/')
  await page.getByRole('tab', { name: 'Register' }).click()
  await page.getByLabel('What should the goblin call you?').fill('Push Goblin')
  await page.getByLabel('Email').fill(`push_on_${Date.now()}@example.com`)
  await page.getByLabel('Password').fill('PushE2ePass!9')
  await page.getByRole('button', { name: /create account/i }).click()
  await expect(page).toHaveURL(/\/den/, { timeout: 20_000 })
  await page
    .getByRole('dialog', { name: 'Welcome to the Den' })
    .waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: 'I’ll figure it out' }).click()
  const status = await (await page.request.get('/api/push')).json()
  test.skip(!status.configured, 'Worker started without VAPID keys')

  await page.goto('/settings#notifications')
  await page.getByTestId('push-turn-on').click()
  await expect(page.getByTestId('push-on')).toBeVisible()
  await expect(page.getByTestId('push-morning')).toBeChecked()
  await page.getByLabel('Evening check-in at').click()
  await expect(page.getByLabel('Evening check-in at')).toBeChecked()
  await page.getByLabel('Evening check-in time').fill('19:30')
  await expect
    .poll(
      async () =>
        (await (await page.request.get('/api/push')).json()).preferences,
    )
    .toMatchObject({
      eveningEnabled: true,
      eveningTime: '19:30',
      morningEnabled: true,
    })
  expect((await (await page.request.get('/api/push')).json()).devices).toBe(1)

  await page.setViewportSize({ width: 390, height: 844 })
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)

  await page.getByTestId('push-turn-off').click()
  await expect(page.getByTestId('push-turn-on')).toBeVisible()
  expect((await (await page.request.get('/api/push')).json()).devices).toBe(0)
})
