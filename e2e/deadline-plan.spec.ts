import { expect, test } from '@playwright/test'

/**
 * Panic button, a document turned into a plan in one tap, and the plan in
 * the person's own phone calendar. Local dev only.
 */
const stamp = Date.now()
const password = 'E2ePlanPass!9'

function inDays(n: number) {
  const d = new Date(Date.now() + n * 86_400_000)
  return `${d.getUTCDate()} ${d.toLocaleString('en', { month: 'long', timeZone: 'UTC' })} ${d.getUTCFullYear()}`
}

test('panic button, plan from a document, and phone calendar', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Register' }).click()
  await page.getByLabel('What should the goblin call you?').fill('Planner')
  await page.getByLabel('Email').fill(`plan_${stamp}@example.com`)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /create account/i }).click()
  await expect(page).toHaveURL(/\/den/, { timeout: 20_000 })

  // The panic button is always on Home, and starts with a breath.
  await page.getByRole('button', { name: /Panic button/ }).click()
  await expect(
    page.getByRole('heading', { name: 'You’re okay. Let’s slow down.' }),
  ).toBeVisible()
  await page.screenshot({ path: 'test-results/plan-panic.png' })
  await page.getByRole('button', { name: 'I’m ready' }).click()
  await expect(
    page.getByRole('button', { name: 'Clear my day for me' }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Leave calm mode' })
    .or(page.getByRole('button', { name: 'Back to the den' }))
    .first()
    .click()

  // Any document with deadlines becomes a plan.
  await page.goto('/life/documents')
  await page.getByLabel(/Choose a bill, letter/).setInputFiles({
    name: 'project-brief.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      [
        `Project brief ${stamp}`,
        `Research proposal (40%) due ${inDays(40)}`,
        `URGENT: return the signed safety form by ${inDays(1)}`,
      ].join('\n'),
    ),
  })
  await page.getByRole('button', { name: 'Feed it to the goblin' }).click()
  await expect(page.getByText(/^I found 2 dates/)).toBeVisible()
  // Everything certain is added straight away; nothing to approve.
  await expect(
    page.getByText(/Added 8 things to your tasks and calendar\./),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Your plan' })).toHaveCount(0)
  await page.screenshot({
    path: 'test-results/plan-review.png',
    fullPage: true,
  })

  // The urgent part is at the top of Home, today.
  await page.goto('/den')
  await expect(
    page.getByText('Return the signed safety form straight away'),
  ).toBeVisible()

  // Due dates are in the calendar, and the phone link works.
  await page.goto('/life/calendar')
  await expect(page.getByText('Due: Research proposal')).toBeVisible()
  await page
    .getByRole('button', { name: 'Keep my phone calendar up to date' })
    .click()
  await expect(
    page.getByRole('link', { name: 'iPhone or Mac' }),
  ).toHaveAttribute('href', /^webcal:\/\/.+\/api\/ics\/[A-Za-z0-9_-]{43}\.ics$/)
  await page.screenshot({
    path: 'test-results/plan-calendar.png',
    fullPage: true,
  })
  const url = await page.getByLabel('Your private calendar link').inputValue()
  const feed = await page.request.get(url)
  expect(feed.status()).toBe(200)
  expect(await feed.text()).toContain('SUMMARY:Due: Research proposal')
})
