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
        `Assessment 1 Research essay (40%) due ${futureDate(19)}`,
      ].join('\n'),
    ),
  })
  await page.getByRole('button', { name: 'Feed it to the goblin' }).click()
  await expect(page.getByRole('button', { name: 'Preview my pathway' })).toBeVisible()

  await page.getByRole('button', { name: 'Preview my pathway' }).click()
  await expect(page.getByText(/proposed sessions/)).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Approve and add these study tasks' }),
  ).toBeEnabled()
  await page.getByRole('button', { name: 'Approve and add these study tasks' }).click()
  await expect(page.getByText('Saved study sessions')).toBeVisible()
  const calendar = await page.request.get('/api/calendar/export.ics')
  expect(calendar.status()).toBe(200)
  const content = await calendar.text()
  expect(content).toContain('BEGIN:VCALENDAR')
  expect(content).toContain('SUMMARY:To do:')
  expect(content).toContain('Research essay')

  // The uploaded original can be discarded without losing the approved plan.
  await page.getByRole('button', { name: /Done — skip the rest and delete the file/ }).click()
  await expect(page.getByText('DOCUMENT DEVOURED!')).toBeVisible()
  await page.getByRole('button', { name: 'Feed me another' }).click()
  await expect(page.getByRole('heading', { name: 'Saved study pathways' })).toBeVisible()

  await page.getByRole('button', { name: /unfinished/ }).click()
  await expect(page.getByText('Saved study sessions')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Find new days for missed work' })).toBeVisible()
  await page.getByRole('button', { name: 'Undo this pathway' }).click()
  await expect(page.getByText('Saved study sessions')).toHaveCount(0)
  const afterUndo = await (await page.request.get('/api/calendar/export.ics')).text()
  expect(afterUndo).not.toContain('SUMMARY:To do:')

  for (const [width, height] of [[390, 844], [1280, 900]]) {
    await page.setViewportSize({ width: width!, height: height! })
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  }
})
