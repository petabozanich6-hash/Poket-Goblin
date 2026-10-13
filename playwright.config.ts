import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Assume `npm run dev` is already running locally so we don't fight ports.
  // Set PLAYWRIGHT_WEB_SERVER=1 to auto-start.
  webServer: process.env.PLAYWRIGHT_WEB_SERVER
    ? {
        command: 'npm run dev',
        url: 'http://127.0.0.1:5173',
        reuseExistingServer: true,
        timeout: 120_000,
      }
    : undefined,
})
