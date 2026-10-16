import { execFileSync } from 'node:child_process'

import { expect, test, type Page } from '@playwright/test'

/**
 * Goblin HQ end to end, against `npm run dev` (Vite + wrangler dev with the
 * LOCAL D1 database only). A local account is promoted with the same kind of
 * INSERT the production promotion workflow performs, and Chromium's virtual
 * WebAuthn authenticator stands in for Touch ID / a security key.
 */
const stamp = Date.now()
const password = 'E2eHqPass!9'
const ownerEmail = `hq_owner_${stamp}@example.com`
const userEmail = `hq_user_${stamp}@example.com`

function localD1(sql: string) {
  execFileSync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      'pocket-goblin',
      '--local',
      // Match `wrangler dev --persist-to <dir>` when testing a separate database.
      ...(process.env.E2E_D1_PERSIST
        ? ['--persist-to', process.env.E2E_D1_PERSIST]
        : []),
      '--command',
      sql,
    ],
    { stdio: 'pipe' },
  )
}

async function register(page: Page, email: string, name: string) {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Register' }).click()
  await page.getByLabel('What should the goblin call you?').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /create account/i }).click()
  await expect(page).toHaveURL(/\/den/, { timeout: 20_000 })
  const me = await page.request.get('/api/me')
  return ((await me.json()) as { user: { id: string } }).user.id
}

async function addVirtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
}

test.describe.serial('Goblin HQ', () => {
  test('ordinary customers never see or reach Goblin HQ', async ({ page }) => {
    await register(page, userEmail, 'Ordinary Goblin')
    await expect(page.getByRole('link', { name: 'Goblin HQ' })).toHaveCount(0)

    await page.goto('/hq')
    await expect(page).toHaveURL(/\/den/)

    const api = await page.request.get('/api/admin/overview')
    expect(api.status()).toBe(404)
    const write = await page.request.put('/api/admin/settings/features', {
      headers: {
        'X-Pocket-Goblin-Admin': '1',
        Origin: 'http://localhost:5173',
      },
      data: {
        value: {
          registrationsOpen: false,
          documentUploads: true,
          aiProvider: true,
        },
      },
    })
    expect(write.status()).toBe(404)
  })

  test('the Owner secures HQ with a passkey and manages the platform', async ({
    page,
  }) => {
    const ownerId = await register(page, ownerEmail, 'Owner Goblin')
    expect(ownerId).toMatch(/^user_[0-9a-f]{32}$/)
    localD1(
      `INSERT INTO user_roles (id, user_id, role, granted_by, reason) VALUES ('e2e_role_${stamp}', '${ownerId}', 'owner', 'e2e', 'e2e');` +
        `INSERT INTO user_entitlements (id, user_id, entitlement, source, status, granted_by) VALUES ('e2e_ent_${stamp}', '${ownerId}', 'owner_premium', 'admin', 'active', 'e2e');`,
    )
    await addVirtualAuthenticator(page)

    await page.goto('/settings')
    await expect(page.getByText('Owner Premium')).toBeVisible()
    await expect(page.getByText(ownerId)).toBeVisible()

    await page.getByRole('link', { name: 'Goblin HQ' }).click()
    await expect(
      page.getByRole('heading', { name: /secure goblin hq/i }),
    ).toBeVisible()

    // Before the step-up, admin data is refused even for the Owner.
    expect((await page.request.get('/api/admin/overview')).status()).toBe(401)

    await page.getByLabel('Your Pocket Goblin password').fill(password)
    await page.getByLabel('Name this passkey').fill('E2E authenticator')
    await page.getByRole('button', { name: 'Add passkey' }).click()

    await expect(
      page.getByRole('heading', { name: /confirm it’s you/i }),
    ).toBeVisible()
    await page.getByRole('button', { name: /confirm with passkey/i }).click()

    await expect(
      page.getByRole('heading', { name: /goblin hq/i, level: 1 }),
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible()
    await expect(page.getByText('Not configured').first()).toBeVisible()

    // Customers: find the ordinary account; metadata only.
    await page.getByRole('link', { name: 'Customers' }).click()
    await page.getByLabel('Search by email or account ID').fill(userEmail)
    await page.getByRole('button', { name: 'Search' }).click()
    await page.getByRole('link', { name: userEmail }).click()
    await expect(page.getByRole('heading', { name: userEmail })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Usage' })).toBeVisible()

    // Settings: an announcement reaches every customer.
    const message = `HQ e2e notice ${stamp}`
    await page.getByRole('link', { name: 'Platform settings' }).click()
    await page.getByLabel('Show announcement').check()
    await page.getByLabel(/^Message \(plain text/).fill(message)
    await page
      .locator('form')
      .filter({ hasText: 'Show announcement' })
      .getByRole('button', { name: 'Save' })
      .click()
    await expect(page.getByText('Saved.')).toBeVisible()
    await page.reload()
    await expect(
      page.getByRole('status').filter({ hasText: message }),
    ).toBeVisible()

    // Audit log shows the change.
    await page.getByRole('link', { name: 'Audit log' }).click()
    await expect(
      page.getByRole('cell', { name: 'settings.update' }).first(),
    ).toBeVisible()

    // Responsive: the dashboard renders without horizontal overflow.
    for (const size of [
      { name: 'desktop', width: 1280, height: 900 },
      { name: 'tablet', width: 820, height: 1180 },
      { name: 'mobile', width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size)
      await page.goto('/hq')
      await expect(
        page.getByRole('heading', { name: 'Customers' }),
      ).toBeVisible()
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      )
      expect(overflow, `${size.name} horizontal overflow`).toBeLessThanOrEqual(
        1,
      )
      await page.screenshot({
        path: `test-results/goblin-hq-${size.name}.png`,
        fullPage: true,
      })
    }

    // Tidy the shared local database: hide the announcement again.
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/hq/settings')
    await page.getByLabel('Show announcement').uncheck()
    await page
      .locator('form')
      .filter({ hasText: 'Show announcement' })
      .getByRole('button', { name: 'Save' })
      .click()
    await expect(page.getByText('Saved.')).toBeVisible()
  })
})
