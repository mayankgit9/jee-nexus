import { defineConfig, devices } from '@playwright/test'

// JEE NEXUS — Playwright browser suite.
// Runs against a dev server (CI: ephemeral Postgres; local: whatever the
// dev server is connected to). Test accounts use the pw-* prefix so they can
// be cleaned from a shared database afterwards.

export default defineConfig({
  testDir: 'tests/browser',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false, // sequential: shared DB + rate limits
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // stuck clicks/fills fail in 15s instead of burning the whole test timeout
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
})
