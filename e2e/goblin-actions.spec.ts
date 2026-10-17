import { expect, test, type Page } from '@playwright/test'

/**
 * The action-taking Goblin in a real browser (local D1 only):
 * no Keep/Skip for clear requests, completion puts things away, Undo works.
 */
const stamp = Date.now()

async function register(page: Page, email: string) {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Register' }).click()
  await page
    .getByLabel('What should the goblin call you?')
    .fill('Action Goblin')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('ActionPass!9')
  await page.getByRole('button', { name: /create account/i }).click()
  await expect(page).toHaveURL(/\/den/, { timeout: 20_000 })
}

async function tell(page: Page, text: string) {
  await page.getByLabel('What’s on your mind?').fill(text)
  await page.getByRole('button', { name: 'Give it to the Goblin' }).click()
}

test('milk: added, bought and put away in two sentences and zero approvals', async ({
  page,
}) => {
  await register(page, `milk_${stamp}@example.com`)
  let clicks = 0
  page.on('request', (r) => {
    if (
      r.method() === 'POST' &&
      /\/api\/(review|captures\/.+\/items)/.test(r.url())
    )
      clicks += 1
  })

  await tell(page, 'I need milk')
  await expect(
    page.getByText('Milk added to your shopping list.'),
  ).toBeVisible()
  await tell(page, "I've bought the milk")
  await expect(page.getByText('Milk crossed off your list! 👹')).toBeVisible()
  expect(clicks).toBe(0)

  await page.goto('/life/lists')
  await expect(
    page.getByRole('list', { name: 'Still to buy' }).getByText('Milk'),
  ).toHaveCount(0)
  await page.getByText(/Bought recently/).click()
  await expect(
    page.getByRole('list', { name: 'Bought recently' }).getByText('Milk'),
  ).toBeVisible()
})

test('Undo really undoes', async ({ page }) => {
  await register(page, `undo_${stamp}@example.com`)
  await tell(page, 'I need eggs')
  await expect(
    page.getByText('Eggs added to your shopping list.'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByText('Undone.')).toBeVisible()
  await page.goto('/life/lists')
  await expect(page.getByText('Nothing left to buy. 👹')).toBeVisible()
})

test('mixed sentence and a question about the list', async ({ page }) => {
  await register(page, `mixed_${stamp}@example.com`)
  await tell(page, 'I need milk')
  await expect(
    page.getByText('Milk added to your shopping list.'),
  ).toBeVisible()
  await tell(
    page,
    "I've bought the milk, but I still need bread, and remind me to call Mum tomorrow.",
  )
  await expect(page.getByText('Milk crossed off your list! 👹')).toBeVisible()
  await expect(
    page.getByText('Bread added to your shopping list.'),
  ).toBeVisible()
  await expect(page.getByText(/I’ll remind you to call mum/i)).toBeVisible()
  await tell(page, 'Did I buy milk?')
  await expect(page.getByText(/^Yes! You crossed Milk off/)).toBeVisible()
})

test('appointment moves ask first', async ({ page }) => {
  await register(page, `appt_${stamp}@example.com`)
  await tell(page, 'I have a dentist appointment on Friday at 3pm')
  await expect(
    page.getByText(/Added “Dentist appointment” to your calendar/),
  ).toBeVisible()
  await tell(page, 'Move my dentist appointment to Monday')
  await expect(
    page.getByText(/Shall I: move “Dentist appointment”/),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Yes', exact: true }).click()
  await expect(page.getByText(/^Done — move/)).toBeVisible()
})

test('Tell page keeps earlier actionable results visible after several messages', async ({
  page,
}) => {
  await register(page, `tell_history_${stamp}@example.com`)
  await page.goto('/tell')
  for (const item of ['apples', 'bananas', 'carrots', 'oranges']) {
    await tell(page, `I need ${item}`)
    await expect(
      page.getByText(new RegExp(`${item} added to your shopping list\\.`, 'i')),
    ).toBeVisible()
  }
  // Older Undo controls must not disappear when the fourth response arrives.
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(4)
})

test('Tell the Goblin accepts multiple files and keeps separate reviews', async ({
  page,
}) => {
  await register(page, `tell_files_${stamp}@example.com`)
  await page.goto('/tell')
  await page.getByLabel('Choose a document').setInputFiles([
    {
      name: 'first-bill.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Energy bill amount due $40 on 28 October 2030.'),
    },
    {
      name: 'second-letter.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Appointment on 22 November 2030 at 2pm.'),
    },
  ])
  await page.getByRole('button', { name: 'Give it to the Goblin' }).click()
  await expect(page.getByText('first-bill.txt', { exact: false })).toBeVisible()
  await expect(page.getByText('second-letter.txt', { exact: false })).toBeVisible()
})
