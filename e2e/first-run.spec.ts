import { expect, test } from '@playwright/test'

const stamp = Date.now()
const email = `e2e_${stamp}@example.com`
const password = 'E2eTestPass!9'
const name = 'E2E Goblin'

test.describe('Pocket Goblin first-run journey', () => {
  test('register, capture, keep suggestion, and search', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('tab', { name: 'Register' }).click()
    await page.getByLabel('What should the goblin call you?').fill(name)
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: /create account/i }).click()

    await expect(page).toHaveURL(/\/den/, { timeout: 20_000 })

    // Journey J: an empty account gets one calm message, not empty cards.
    await expect(page.getByText('All quiet in the cave. 👹')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Today' })).toHaveCount(0)

    // Journey A: capture on Home, approve in place, find it in My Life.
    await page.getByLabel('What’s on your mind?').fill('Buy milk tomorrow')
    await page.getByRole('button', { name: 'Give it to the Goblin' }).click()
    // A plain request just happens — no Keep/Skip step.
    await expect(
      page.getByText('Milk added to your shopping list.'),
    ).toBeVisible({ timeout: 15_000 })

    await page.getByRole('link', { name: 'My Life' }).first().click()
    await page.getByLabel('Search everything').fill('milk')
    await page.getByLabel('Search everything').press('Enter')
    await expect(page).toHaveURL(/\/life\/search\?q=milk/)
    await expect(page.getByText(/milk/i).first()).toBeVisible({
      timeout: 10_000,
    })
  })
})
