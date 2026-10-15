import { expect, test, type Page } from '@playwright/test'

/**
 * Launch journeys against local dev (local D1 only).
 */
const stamp = Date.now()
const password = 'LaunchPass!9'

async function register(page: Page, email: string, name: string) {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Register' }).click()
  await page.getByLabel('What should the goblin call you?').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /create account/i }).click()
  await expect(page).toHaveURL(/\/den/, { timeout: 20_000 })
}

test('four destinations, old links still work, no clutter', async ({
  page,
}) => {
  await register(page, `nav_${stamp}@example.com`, 'Nav Goblin')
  const nav = page.getByRole('navigation', { name: 'Main' }).first()
  await expect(nav.getByRole('link')).toHaveText([
    'Home',
    'Tell the Goblin',
    'My Life',
    'Settings',
  ])
  await expect(page.getByRole('link', { name: 'Goblin HQ' })).toHaveCount(0)

  for (const [old, now] of [
    ['/tasks', '/life/tasks'],
    ['/vault', '/life/documents'],
    ['/inbox', '/life/review'],
    ['/find', '/life/search'],
    ['/plan', '/life/plan'],
    ['/calendar', '/life/calendar'],
  ]) {
    await page.goto(old!)
    await expect(page).toHaveURL(new RegExp(`${now}$`))
  }
})

test('Journey D: a messy brain dump becomes separate, categorised suggestions', async ({
  page,
}) => {
  await register(page, `dump_${stamp}@example.com`, 'Dump Goblin')
  await page
    .getByLabel('What’s on your mind?')
    .fill(
      'Book the dentist on Tuesday. Buy oat milk. Pay the water bill by Friday.',
    )
  await page.getByRole('button', { name: 'Give it to the Goblin' }).click()
  // The clear shopping request just happens; the rest waits for a yes.
  await expect(
    page.getByText('Oat milk added to your shopping list.'),
  ).toBeVisible({ timeout: 15_000 })
  const keeps = page.getByRole('button', { name: /^keep$/i })
  await expect(keeps).toHaveCount(2, { timeout: 15_000 })
  for (let i = 0; i < 2; i += 1) {
    await page
      .getByRole('button', { name: /^keep$/i })
      .first()
      .click()
    await expect(page.getByRole('button', { name: /^keep$/i })).toHaveCount(
      1 - i,
    )
  }
  await page.goto('/life')
  await expect(page.getByRole('link', { name: /Open tasks/ })).toBeVisible()
})

test('questions get answers and overwhelm gets gentle help', async ({
  page,
}) => {
  await register(page, `ask_${stamp}@example.com`, 'Ask Goblin')
  await page
    .getByLabel('What’s on your mind?')
    .fill('What have I forgotten this week?')
  await page.getByRole('button', { name: 'Give it to the Goblin' }).click()
  await expect(
    page.getByText('“What have I forgotten this week?”'),
  ).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: /^keep$/i })).toHaveCount(0)

  await page
    .getByLabel('What’s on your mind?')
    .fill("I'm overwhelmed and don't know where to start")
  await page.getByRole('button', { name: 'Give it to the Goblin' }).click()
  await expect(
    page.getByRole('button', { name: 'Sort my day for me' }),
  ).toBeVisible()
})

test('Journey B: a returning user updates a task and signs out', async ({
  page,
}) => {
  const email = `return_${stamp}@example.com`
  await register(page, email, 'Return Goblin')
  await page.goto('/life/tasks')
  await page.getByLabel('Task', { exact: true }).fill('Water the plants')
  await page.getByRole('button', { name: 'Add task' }).click()
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page).toHaveURL(/\/$/)

  await page.getByRole('tab', { name: 'Sign in' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /enter the den/i }).click()
  await expect(page).toHaveURL(/\/den/)
  await expect(page.getByText('Water the plants')).toBeVisible()
})

test('Journey C (screens): forgot password never reveals whether an account exists', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Sign in' }).click()
  await page.getByRole('link', { name: 'Forgot your password?' }).click()
  await expect(
    page.getByRole('heading', { name: 'Forgot your password?' }),
  ).toBeVisible()
  await page.getByLabel('Email').fill(`nobody_${stamp}@example.com`)
  await page.getByRole('button', { name: 'Send me a reset link' }).click()
  await expect(page.getByText(/If an account uses that email/)).toBeVisible()

  await page.goto('/reset-password#token=not-a-real-token-but-long-enough')
  await page.getByLabel('New password (8+ characters)').fill('another pass 9')
  await page.getByLabel('Type it again').fill('another pass 9')
  await page.getByRole('button', { name: 'Save new password' }).click()
  await expect(page.getByText(/expired or was already used/)).toBeVisible()
})

test('Journey G: two accounts never see each other’s things', async ({
  browser,
}) => {
  const a = await browser.newPage()
  await register(a, `iso_a_${stamp}@example.com`, 'Iso A')
  await a.goto('/life/tasks')
  await a.getByLabel('Task', { exact: true }).fill(`Secret plan ${stamp}`)
  await a.getByRole('button', { name: 'Add task' }).click()
  await expect(a.getByText(`Secret plan ${stamp}`)).toBeVisible()

  const context = await browser.newContext()
  const b = await context.newPage()
  await register(b, `iso_b_${stamp}@example.com`, 'Iso B')
  await b.goto(`/life/search?q=${encodeURIComponent('Secret plan')}`)
  await expect(b.getByText(`Secret plan ${stamp}`)).toHaveCount(0)
  const api = await b.request.get('/api/tasks?status=all')
  expect(JSON.stringify(await api.json())).not.toContain(`Secret plan ${stamp}`)
  await context.close()
})

test('Journey I: capture and approve on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await register(page, `mobile_${stamp}@example.com`, 'Mobile Goblin')
  const tabBar = page.getByRole('navigation', { name: 'Main' }).last()
  await expect(tabBar).toBeVisible()
  await expect(tabBar.getByRole('link')).toHaveText([
    'Home',
    'Tell',
    'My Life',
    'Settings',
  ])

  await page.getByLabel('What’s on your mind?').fill('Call the bank tomorrow')
  await page.getByRole('button', { name: 'Give it to the Goblin' }).click()
  await page
    .getByRole('button', { name: /^keep$/i })
    .first()
    .click()
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)
  await page.screenshot({
    path: 'test-results/home-mobile.png',
    fullPage: true,
  })

  await tabBar.getByRole('link', { name: 'My Life' }).click()
  await expect(page).toHaveURL(/\/life$/)
  await page.screenshot({
    path: 'test-results/mylife-mobile.png',
    fullPage: true,
  })
})
