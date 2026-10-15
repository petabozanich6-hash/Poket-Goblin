import { expect, test } from '@playwright/test'

/**
 * Document Devourer in a real browser against local dev (local D1 only).
 */
const stamp = Date.now()
const password = 'E2eDevourPass!9'
const BILL = `Bright Energy\nYour electricity bill\nAmount due: €84.20\nPayment due: 28 October 2030\nRef ${stamp}`

test('Just sort it: approve, skip, devour — the task stays, the file goes', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Register' }).click()
  await page.getByLabel('What should the goblin call you?').fill('Paper Goblin')
  await page.getByLabel('Email').fill(`devour_${stamp}@example.com`)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /create account/i }).click()
  await expect(page).toHaveURL(/\/den/, { timeout: 20_000 })

  await page.goto('/life/documents')
  await expect(
    page.getByRole('heading', { name: 'Feed the Document Devourer' }),
  ).toBeVisible()
  await expect(page.getByLabel(/Just sort it/)).toBeChecked()

  await page.getByLabel(/Choose a bill, letter/).setInputFiles({
    name: 'october-bill.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(BILL),
  })
  await page.getByRole('button', { name: 'Feed it to the goblin' }).click()

  await expect(
    page.getByText(/electricity bill for €84\.20 due on 28 October 2030/),
  ).toBeVisible()
  await expect(
    page.getByText('not kept — deleted when you finish'),
  ).toBeVisible()
  await page.screenshot({
    path: 'test-results/devourer-review.png',
    fullPage: true,
  })

  // The Goblin acts first: both are added straight away, with Undo.
  await expect(
    page.getByText(/Added 2 things to your tasks and calendar\./),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByText(/Added 2 things/)).toHaveCount(0)

  // After Undo, pick by hand: keep the task, skip the reminder.
  const task = page.locator('li').filter({ hasText: 'Pay electricity bill' })
  await task.getByRole('button', { name: 'Yes, add it' }).click()
  await expect(task).toHaveCount(0)
  const reminder = page
    .locator('li')
    .filter({ hasText: 'Electricity bill due' })
  await reminder.getByRole('button', { name: 'Skip' }).click()
  await expect(reminder).toHaveCount(0)

  await page.getByRole('button', { name: /Done — delete the file/ }).click()
  await expect(page.getByText('DOCUMENT DEVOURED!')).toBeVisible()
  await expect(
    page.getByText('1 important bit rescued. Paperwork eliminated.'),
  ).toBeVisible()

  // Nothing kept, nothing waiting.
  expect(
    (await (await page.request.get('/api/documents')).json()).documents,
  ).toEqual([])
  expect(
    (
      await (
        await page.request.get('/api/documents?retention=temporary')
      ).json()
    ).documents,
  ).toEqual([])

  // The approved task is in Tasks; the skipped reminder was never created.
  await page.goto('/life/tasks')
  await expect(page.getByText('Pay electricity bill')).toBeVisible()

  // Keep mode puts the file in the vault.
  await page.goto('/life/documents')
  await page.getByLabel(/Keep this document/).check()
  await page.getByLabel(/Choose a bill, letter/).setInputFiles({
    name: 'insurance.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      `Your home insurance renewal notice. Renewal date: 1 December 2030. Ref ${stamp}`,
    ),
  })
  await page.getByRole('button', { name: 'Feed it to the goblin' }).click()
  await expect(page.getByText('saved in your vault')).toBeVisible()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Kept documents' }),
  ).toBeVisible()
  await expect(page.getByText('insurance.txt')).toBeVisible()

  for (const size of [
    { name: 'mobile', width: 390, height: 844 },
    { name: 'desktop', width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(size)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
    await page.screenshot({
      path: `test-results/devourer-${size.name}.png`,
      fullPage: true,
    })
  }
})
