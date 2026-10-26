import { expect, test, type Page } from '@playwright/test'

/**
 * Health, end to end in a browser: consent, supplements, a recipe typed in with its per-serving numbers,
 * logging half a serve, macro goals from a preset, a weigh-in, logging by talking to the Goblin, the
 * Den reminder, and deleting all health data. (The screenshot reader needs Workers AI and is covered by
 * worker tests; recipe links need the internet and are covered by worker tests with a stubbed page.)
 */
async function register(page: Page) {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Register' }).click()
  await page
    .getByLabel('What should the goblin call you?')
    .fill('Health Goblin')
  await page.getByLabel('Email').fill(`health_${Date.now()}@example.com`)
  await page.getByLabel('Password').fill('HealthE2ePass!9')
  await page.getByRole('button', { name: /create account/i }).click()
  await expect(page).toHaveURL(/\/den/, { timeout: 20_000 })
  // The optional site tour opens for new accounts; skip it (it's remembered).
  await page
    .getByRole('dialog', { name: 'Welcome to the Den' })
    .waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: 'I’ll figure it out' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

test('Health: turn on, supplements, a recipe with macros, weigh-in, talk to the Goblin, delete', async ({
  page,
}) => {
  await register(page)
  await page.goto('/life/health')

  // Off until an explicit yes.
  await expect(page.getByTestId('health-consent')).toBeVisible()
  await expect(page.getByTestId('health-enable')).toBeDisabled()
  await page.getByTestId('health-consent-check').check()
  await page.getByTestId('health-enable').click()
  await expect(page.getByTestId('health-tab-today')).toBeVisible()

  // Supplements.
  await page.getByLabel('Name').fill('Faction Labs Deficit Clinical')
  await page.getByLabel('Caffeine mg').fill('200')
  await page.getByTestId('supp-add').click()
  await expect(page.getByText('Faction Labs Deficit Clinical')).toBeVisible()
  await expect(page.getByLabel('Name')).toHaveValue('')
  await page.getByLabel('Name').fill('Voost multivitamin')
  await page.getByTestId('supp-add').click()
  await expect(page.getByTestId('supplements-due')).toHaveText(
    '2 still to take today.',
  )
  // Close the add form so the tick buttons show.
  await page.getByText('Add or remove').click()
  await page.getByTestId('take-Voost multivitamin').click()
  await expect(page.getByTestId('supplements-due')).toHaveText(
    '1 still to take today.',
  )

  // The Den shows what's left.
  await page.goto('/den')
  await expect(page.getByTestId('health-nudge')).toContainText(
    'Faction Labs Deficit Clinical',
  )

  // Goals from a preset.
  await page.goto('/life/health')
  await page.getByTestId('health-tab-goals').click()
  await page.getByLabel('Calories (kcal)').fill('1900')
  await page.getByTestId('preset-higher_protein').click()
  await expect(page.getByLabel('Protein (g)')).toHaveValue('143')
  await page.getByTestId('health-save-goals').click()
  await expect(page.getByTestId('health-goals-saved')).toBeVisible()

  // A recipe typed in from the Mob panel, logged as half a serve for dinner.
  await page.getByTestId('health-tab-recipes').click()
  await page.getByTestId('analyse-type').click()
  await page.getByTestId('analyse-type-go').click()
  const preview = page.getByTestId('recipe-preview')
  await preview
    .getByLabel('Recipe name')
    .fill('Pork Belly Benedict With Gochujang Hollandaise')
  await preview.getByLabel('Calories (kcal)', { exact: true }).fill('1071')
  await preview.getByLabel('Protein (g)', { exact: true }).fill('30')
  await preview.getByLabel('Carbs (g)').fill('51')
  await preview.getByLabel('Fat (g)', { exact: true }).fill('83')
  await preview.getByLabel('Sodium (mg)').fill('1870')
  await page.getByTestId('recipe-log-as').selectOption('dinner')
  await preview.getByLabel('Servings eaten').fill('0.5')
  await page.getByTestId('recipe-save').click()
  await expect(page.getByTestId('recipe-list')).toContainText(
    'Pork Belly Benedict',
  )

  await page.getByTestId('health-tab-today').click()
  await expect(page.getByTestId('meal-list')).toContainText(
    '0.5 × Pork Belly Benedict',
  )
  await expect(page.getByTestId('bar-calories')).toContainText(
    '536 of 1900 kcal',
  )
  await expect(page.getByTestId('bar-protein')).toContainText('15 of 143 g')

  // A weigh-in.
  await page.getByTestId('health-tab-weight').click()
  await page.getByLabel('Weight (kg)').fill('92.4')
  await page.getByTestId('weigh-save').click()
  await expect(page.getByTestId('weight-average')).toHaveText('92.4 kg')

  // Tell the Goblin.
  await page.goto('/den')
  await page
    .getByLabel('What’s on your mind?')
    .fill('walked 30 minutes and I drank 2 glasses of water')
  await page.getByRole('button', { name: 'Give it to the Goblin' }).click()
  await expect(page.getByText(/30 minutes of walk logged/)).toBeVisible({
    timeout: 15_000,
  })
  await page.goto('/life/health')
  await expect(page.getByTestId('bar-this-week')).toContainText(
    '30 of 150 minutes',
  )
  await expect(page.getByTestId('habit-water')).toHaveText('2 / 8')

  // Phone width: nothing overflows sideways.
  await page.setViewportSize({ width: 390, height: 844 })
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)

  // Delete it all.
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByTestId('health-tab-goals').click()
  await page.getByText('Delete my health data').first().click()
  await page.getByLabel('Type DELETE to confirm').fill('DELETE')
  await page.getByTestId('health-delete').click()
  await expect(page.getByTestId('health-consent')).toBeVisible()
})
