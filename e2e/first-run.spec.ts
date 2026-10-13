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
    await expect(page.getByRole('heading', { name: /the den/i })).toBeVisible()

    await page.getByRole('button', { name: /open quick capture/i }).click()
    await page.getByLabel('Brain dump').fill('Buy milk tomorrow')
    await page.getByRole('button', { name: /give it to the goblin/i }).click()

    await page.getByRole('link', { name: 'Dump', exact: true }).click()
    const keep = page.getByRole('button', { name: /^keep$/i }).first()
    await expect(keep).toBeVisible({ timeout: 15_000 })
    await keep.click()

    await page.getByRole('link', { name: 'Find' }).click()
    await page.getByLabel('Search').fill('milk')
    await expect(page.getByText(/milk/i).first()).toBeVisible({
      timeout: 10_000,
    })
  })
})
