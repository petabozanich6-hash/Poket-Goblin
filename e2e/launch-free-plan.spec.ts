import { expect, test, type Page } from '@playwright/test'

/**
 * A brand-new customer on the permanent Free plan, in a real browser: sign
 * up, use the everyday features, meet a Free limit with a clear way out,
 * find the plan page, and read Terms/Privacy while signed out.
 */
const stamp = Date.now()

async function register(page: Page, email: string) {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Register' }).click()
  await page.getByLabel('What should the goblin call you?').fill('New Goblin')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('FreePlanPass!9')
  await page.getByRole('button', { name: /create account/i }).click()
  await expect(page).toHaveURL(/\/den/, { timeout: 20_000 })
}

test('a new Free customer can organise, meets a limit kindly, and finds Premium', async ({
  page,
}) => {
  await register(page, `free_${stamp}@example.com`)

  // Notes: the sixth is refused with an upgrade path, nothing is lost.
  await page.goto('/life/lists')
  await page.getByRole('button', { name: 'Notes', exact: true }).click()
  for (let i = 1; i <= 6; i++) {
    await page.getByLabel('Title').fill(`Note ${i}`)
    await page.getByRole('button', { name: 'Save note' }).click()
    if (i <= 5)
      await expect(
        page
          .getByRole('heading', { name: `Note ${i}` })
          .or(page.getByText(`Note ${i}`).first()),
      ).toBeVisible()
  }
  await expect(page.getByText(/Free includes 5 notes/).first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'see Premium' })).toBeVisible()

  // Reminders: a dated reminder saves.
  await page.getByRole('button', { name: 'Reminders', exact: true }).click()
  await page.getByLabel('Reminder').fill('Call the dentist')
  await page.locator('input[type="datetime-local"]').fill('2030-01-01T09:00')
  await page
    .getByRole('button', { name: /remind/i })
    .last()
    .click()
  await expect(
    page.getByText(/add your Goblin calendar to your phone/),
  ).toBeVisible()

  // The plan page shows Free's real allowances and Premium.
  await page.getByRole('link', { name: 'see Premium' }).click()
  await expect(page.getByRole('heading', { name: 'Your plan' })).toBeVisible()
  await expect(page.getByText(/3 .*a day|3 times a day/i).first()).toBeVisible()

  // Terms and Privacy are public and accurate.
  await page.context().clearCookies()
  await page.goto('/terms')
  await expect(
    page.getByRole('heading', { name: /Terms of Service/ }),
  ).toBeVisible()
  await expect(page.getByText('5 notes')).toBeVisible()
  await page.getByRole('link', { name: 'Privacy' }).first().click()
  await expect(page.getByText(/Cloudflare Workers AI/).first()).toBeVisible()
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)
  if (process.env.E2E_SCREENSHOTS)
    await page.screenshot({
      path: `${process.env.E2E_SCREENSHOTS}/privacy.png`,
    })
})
