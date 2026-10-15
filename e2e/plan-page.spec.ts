import { expect, test } from '@playwright/test'

/**
 * The subscription area without Stripe set up (local dev): plans are shown
 * honestly, and Premium says "Coming soon" with nothing to buy.
 */
test('plan page shows Free and Premium, and nothing to buy before Stripe', async ({
  page,
}) => {
  const stamp = Date.now()
  await page.goto('/')
  await page.getByRole('tab', { name: 'Register' }).click()
  await page.getByLabel('What should the goblin call you?').fill('Plan Goblin')
  await page.getByLabel('Email').fill(`planpage_${stamp}@example.com`)
  await page.getByLabel('Password').fill('E2ePlanPage!9')
  await page.getByRole('button', { name: /create account/i }).click()
  await expect(page).toHaveURL(/\/den/, { timeout: 20_000 })

  await page.goto('/settings')
  await page.getByRole('link', { name: 'See plans' }).click()
  await expect(page).toHaveURL(/\/settings\/plan$/)
  await expect(page.getByRole('heading', { name: 'Your plan' })).toBeVisible()
  await expect(page.getByText('You’re on')).toContainText('Free')
  await expect(page.getByText('Coming soon')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Upgrade to Premium' }),
  ).toHaveCount(0)
  await page.screenshot({ path: 'test-results/plan-page.png', fullPage: true })
})
