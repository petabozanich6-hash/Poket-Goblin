import { expect, test } from '@playwright/test'

test('the Grand Tour is optional, replayable, responsive and remembered across sessions', async ({
  page,
  browser,
}) => {
  const email = `tour_${Date.now()}@example.com`
  const password = 'TourE2ePass!9'
  await page.goto('/')
  await page.getByRole('tab', { name: 'Register' }).click()
  await page.getByLabel('What should the goblin call you?').fill('Tour Goblin')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /create account/i }).click()
  await expect(page).toHaveURL(/\/den/, { timeout: 20_000 })

  await expect(
    page.getByRole('dialog', { name: 'Welcome to the Den' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Show me around' }).click()

  const titles = [
    'The Den',
    'Quick Capture',
    'Tasks & planning',
    'Documents',
    'Tell the Goblin',
    'Find your stuff',
    'Settings & your plan',
  ]
  const paths = [
    '/den',
    '/den',
    '/life/tasks',
    '/life/documents',
    '/tell',
    '/life/search',
    '/settings',
  ]
  for (let i = 0; i < titles.length; i += 1) {
    await expect(page).toHaveURL(new RegExp(`${paths[i]}$`))
    await expect(page.getByRole('dialog', { name: titles[i] })).toBeVisible()
    await expect(page.locator('[class*="spotlight"]')).toHaveCount(1)
    if (i === 3) {
      await expect(
        page.getByText(/Some document tools have Free plan limits/),
      ).toBeVisible()
    }
    if (i < titles.length - 1) {
      await page.getByRole('button', { name: 'Next' }).click()
    }
  }

  await page.getByRole('button', { name: 'Finish tour' }).click()
  await expect(
    page.getByRole('dialog', { name: 'The workshop is yours!' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Explore my Den' }).click()
  await expect(page).toHaveURL(/\/den$/)
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.reload()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goto('/settings')
  await page.getByRole('link', { name: /Take the Grand Tour/ }).click()
  await expect(page.getByRole('dialog', { name: 'The Den' })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)
  await page.getByRole('button', { name: 'Skip tour' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  const otherDevice = await browser.newContext()
  try {
    const second = await otherDevice.newPage()
    await second.goto('/')
    await second.getByRole('tab', { name: 'Sign in' }).click()
    await second.getByLabel('Email').fill(email)
    await second.getByLabel('Password').fill(password)
    await second.getByRole('button', { name: 'Enter the den' }).click()
    await expect(second).toHaveURL(/\/den/, { timeout: 20_000 })
    await expect(second.getByRole('dialog')).toHaveCount(0)
  } finally {
    await otherDevice.close()
  }
})
