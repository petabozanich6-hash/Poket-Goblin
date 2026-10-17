import { expect, test } from '@playwright/test'

/**
 * Browser acceptance test for study document -> pathway -> calendar -> return.
 * Uses a new Free account with a small enough assessment to stay within its
 * task limit; no external AI, payments or production database are involved.
 */
const stamp = Date.now()

function futureDate(days: number): string {
  const date = new Date(Date.now() + days * 86_400_000)
  return `${date.getUTCDate()} ${date.toLocaleString('en', {
    month: 'long',
    timeZone: 'UTC',
  })} ${date.getUTCFullYear()}`
}

test('a study schedule becomes a reviewable path, downloadable calendar tasks and a saved plan', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Register' }).click()
  await page.getByLabel('What should the goblin call you?').fill('Study Goblin')
  await page.getByLabel('Email').fill(`pathway_${stamp}@example.com`)
  await page.getByLabel('Password').fill('PathwayE2ePass!9')
  await page.getByRole('button', { name: /create account/i }).click()
  await expect(page).toHaveURL(/\/den/, { timeout: 20_000 })

  await page.goto('/life/documents')
  await page.getByLabel(/Choose a bill, letter/).setInputFiles({
    name: 'University Study Schedule.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      [
        'University Study Schedule for Semester 2',
        'Week Commencing Topic Assessment',
        `1 ${futureDate(2)}`,
        'Module 1: Understanding evidence',
        `2 ${futureDate(9)}`,
        'Module 2: Research and sources',
      ].join('\n'),
    ),
  })
  await page.getByRole('button', { name: 'Feed it to the goblin' }).click()
  await expect(
    page.getByRole('button', { name: 'Preview my pathway' }),
  ).toBeVisible()

  await page
    .getByRole('combobox', { name: 'Planning window' })
    .selectOption('84')
  await page
    .getByRole('spinbutton', { name: 'Minutes available per study day' })
    .fill('240')
  await page.getByRole('checkbox', { name: 'Include weekends' }).check()
  await page.getByRole('button', { name: 'Preview my pathway' }).click()
  await expect(page.getByText(/proposed sessions/)).toBeVisible()
  const approve = page.getByRole('button', {
    name: 'Approve and add these study tasks',
  })
  if (!(await approve.isEnabled())) {
    console.log(
      'The study pathway was not approvable:',
      await page
        .locator('section[aria-label="Study pathway preview"]')
        .innerText(),
    )
  }
  await expect(approve).toBeEnabled()
  await page
    .getByRole('button', { name: 'Approve and add these study tasks' })
    .click()
  await expect(page.getByText(/Your study pathway is assigned/)).toBeVisible()
  await expect(page.getByText(/Proposed study step/)).toHaveCount(0)
  await expect(
    page.getByRole('link', {
      name: 'Download your calendar (.ics)',
    }),
  ).toHaveAttribute('href', /\/api\/calendar\/export\.ics\?tz=/)
  // The built-in calendar must show the saved sessions, not only exported
  // all-day task due dates. Use another tab to preserve the upload review.
  const calendarPage = await page.context().newPage()
  await calendarPage.goto('/life/calendar')
  await expect(
    calendarPage.getByRole('heading', { name: 'Calendar', exact: true }),
  ).toBeVisible()
  await expect(
    calendarPage.getByText(/Understanding evidence/).first(),
  ).toBeVisible()
  await expect(
    calendarPage.getByText(/min study · planned day/).first(),
  ).toBeVisible()
  await calendarPage.close()

  const calendar = await page.request.get('/api/calendar/export.ics')
  expect(calendar.status()).toBe(200)
  const content = await calendar.text()
  expect(content).toContain('BEGIN:VCALENDAR')
  expect(content).toContain('SUMMARY:To do:')
  expect(content).toContain('Understanding evidence')

  // The uploaded original can be discarded without losing the approved plan.
  await page
    .getByRole('button', { name: /Done — delete the file/ })
    .click()
  await expect(page.getByText('DOCUMENT DEVOURED!')).toBeVisible()
  await page.getByRole('button', { name: 'Feed me another' }).click()
  await expect(
    page.getByRole('heading', { name: 'Saved study pathways' }),
  ).toBeVisible()

  await page.getByRole('button', { name: /unfinished/ }).click()
  await expect(page.getByText('Saved study sessions')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Find new days for missed work' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Undo this pathway' }).click()
  await expect(page.getByText('Saved study sessions')).toHaveCount(0)
  await expect(
    page.getByRole('link', {
      name: 'Download your calendar (.ics)',
    }),
  ).toBeVisible()
  const afterUndo = await (
    await page.request.get('/api/calendar/export.ics')
  ).text()
  expect(afterUndo).not.toContain('SUMMARY:To do:')

  for (const [width, height] of [
    [390, 844],
    [1280, 900],
  ]) {
    await page.setViewportSize({ width: width!, height: height! })
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  }
})
