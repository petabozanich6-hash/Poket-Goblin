import { expect, test, type Page } from '@playwright/test'

/**
 * Talk to the Goblin and the installable app, in a real browser.
 *
 * Headless Chromium has no speech service, so SpeechRecognition is replaced
 * by a scripted stand-in: the test "says" words and the real app, API and
 * database do the rest. Service-worker checks need a production build
 * (E2E_PRODUCTION=1, e.g. `npm run build` + `wrangler dev` on :8787).
 */
const stamp = Date.now()
const production = Boolean(process.env.E2E_PRODUCTION)

const FAKE_SPEECH = `
  window.__said = [];
  class FakeRecognition {
    constructor() { window.__rec = this; this.results = []; }
    start() { window.__said.push('start'); }
    stop() { this.onend && this.onend(); }
    abort() { this.onend && this.onend(); }
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
  window.__say = (text) => {
    const r = window.__rec;
    r.results.push({ 0: { transcript: text }, isFinal: true, length: 1 });
    r.onresult && r.onresult({ resultIndex: r.results.length - 1, results: r.results });
    setTimeout(() => r.stop(), 50);
  };
  window.__deny = () => {
    const r = window.__rec;
    r.onerror && r.onerror({ error: 'not-allowed' });
    r.onend && r.onend();
  };
`

async function register(page: Page, email: string) {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Register' }).click()
  await page.getByLabel('What should the goblin call you?').fill('Voice Tester')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('VoicePass!9')
  await page.getByRole('button', { name: /create account/i }).click()
  await expect(page).toHaveURL(/\/den/, { timeout: 20_000 })
}

test('one tap, one sentence: milk goes on the real list, with Undo', async ({
  page,
}) => {
  await page.addInitScript(FAKE_SPEECH)
  await register(page, `voice_${stamp}@example.com`)

  // The microphone is on every main screen.
  await page.getByRole('button', { name: 'Talk to Goblin' }).click()
  // First time only: the speech-processing notice, then listening starts.
  await page.getByRole('button', { name: /OK, start listening/ }).click()
  await expect(page.getByText('Listening…')).toBeVisible()
  await page.evaluate(() =>
    (window as unknown as { __say: (t: string) => void }).__say(
      'Oi Goblin, we need milk',
    ),
  )
  await expect(page.getByText(/^Milk added\./)).toBeVisible()
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByText('Undone.')).toBeVisible()

  // Typing works in the same place.
  await page.getByLabel(/Or type to/).fill('What’s on today?')
  await page.getByLabel(/Or type to/).press('Enter')
  await expect(page.getByText(/today/i).last()).toBeVisible()
})

test('/voice opens straight to the microphone; denied permission is explained', async ({
  page,
}) => {
  await page.addInitScript(FAKE_SPEECH)
  await page.addInitScript(() => localStorage.setItem('pg:speech-notice', '1'))
  await register(page, `voice_deny_${stamp}@example.com`)
  await page.goto('/voice?listen=1')
  await expect(
    page.getByRole('heading', { name: 'Talk to Goblin' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Talk to Goblin' }).click()
  await page.evaluate(() =>
    (window as unknown as { __deny: () => void }).__deny(),
  )
  await expect(page.getByText(/Microphone access is blocked/)).toBeVisible()
  // Text still works.
  await page.getByLabel(/Or type to/).fill('Buy bread')
  await page.getByLabel(/Or type to/).press('Enter')
  await expect(page.getByText(/Bread added/).first()).toBeVisible()
})

test('no speech recognition: typing is offered instead', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>
    delete w.SpeechRecognition
    delete w.webkitSpeechRecognition
  })
  await register(page, `voice_none_${stamp}@example.com`)
  await page.goto('/voice')
  await expect(
    page.getByText(/Voice isn’t available in this browser/),
  ).toBeVisible()
  await expect(page.getByLabel(/Or type to/)).toBeFocused()
})

test('installable: manifest and service worker', async ({ page }) => {
  test.skip(!production, 'needs a production build')
  await page.goto('/')
  const manifest = await page.evaluate(async () => {
    const href = document
      .querySelector('link[rel=manifest]')
      ?.getAttribute('href')
    return href ? (await fetch(href)).json() : null
  })
  expect(manifest.display).toBe('standalone')
  const scope = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready
    return reg.scope
  })
  expect(scope).toMatch(/\/$/)
})

test('offline: a typed thought is kept on the device, then sent once', async ({
  page,
  context,
}) => {
  test.skip(!production, 'needs a production build')
  await register(page, `voice_offline_${stamp}@example.com`)
  await page.goto('/voice')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await context.setOffline(true)
  await page.getByLabel(/Or type to/).fill('I need eggs')
  await page.getByLabel(/Or type to/).press('Enter')
  await expect(page.getByText(/Saved on this device/).first()).toBeVisible()
  // The app shell still loads offline.
  await page.reload()
  await expect(page.getByText(/1 saved on this device/)).toBeVisible()
  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.getByText(/Sent 1 thought/)).toBeVisible({
    timeout: 15_000,
  })
  const items = await page.evaluate(async () =>
    (await fetch('/api/shopping', { credentials: 'include' })).json(),
  )
  expect(
    JSON.stringify(items).match(/Eggs/g)?.length ?? 0,
  ).toBeGreaterThanOrEqual(1)
})

test('phone layout: the microphone is reachable and nothing scrolls sideways', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 740 })
  await page.addInitScript(FAKE_SPEECH)
  await register(page, `voice_phone_${stamp}@example.com`)
  const mic = page.getByRole('button', { name: 'Talk to Goblin' })
  const box = await mic.boundingBox()
  const tabs = await page
    .getByRole('navigation', { name: 'Main' })
    .last()
    .boundingBox()
  expect(box && tabs && box.y + box.height <= tabs.y).toBe(true)
  expect(box!.width).toBeGreaterThanOrEqual(44)
  if (process.env.E2E_SCREENSHOTS)
    await page.screenshot({
      path: `${process.env.E2E_SCREENSHOTS}/den-phone.png`,
    })
  await page.goto('/voice')
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  )
  expect(overflow).toBe(false)
  if (process.env.E2E_SCREENSHOTS)
    await page.screenshot({
      path: `${process.env.E2E_SCREENSHOTS}/voice-phone.png`,
    })
})

test('Get to Know Your Goblin: rename it and it answers to the new name', async ({
  page,
}) => {
  await register(page, `voice_name_${stamp}@example.com`)
  await page.goto('/settings#goblin')
  await expect(
    page.getByRole('heading', { name: 'Get to Know Your Goblin' }),
  ).toBeVisible()
  await page.getByLabel('Its name').fill('Lord Reginald')
  await page.getByLabel(/Nicknames/).fill('Gobbo, Gerald')
  await page.getByRole('button', { name: 'Save names' }).click()
  await expect(page.getByText('Saved.')).toBeVisible()
  await page.getByRole('button', { name: 'Quiet', exact: true }).click()
  await page.goto('/voice')
  await expect(
    page.getByRole('heading', { name: 'Talk to Lord Reginald' }),
  ).toBeVisible()
  await page
    .getByLabel(/Or type to/)
    .fill('Yo Gobbo, chuck milk on the shopping list')
  await page.getByLabel(/Or type to/).press('Enter')
  await expect(page.getByText('Milk added.', { exact: true })).toBeVisible()
})
