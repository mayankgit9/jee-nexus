import { test, expect } from '@playwright/test'

// JEE NEXUS — auth flow browser test.
// Uses the pw-* email prefix so the account can be identified and cleaned
// from a shared database (CI DBs are ephemeral).

const email = `pw-${Date.now()}@jee-nexus.dev`
const password = 'pw-test-pass-123'

test('home renders with live question counts', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/JEE Main/i)
  // subject cards with live counts eventually render
  await expect(page.getByText('Physics', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Chemistry', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Mathematics', { exact: true }).first()).toBeVisible()
})

test('signup → signed-in state → sign out → login again', async ({ page }) => {
  // go to the login/profile view
  await page.goto('/#/login')
  await expect(page.getByText('Welcome back')).toBeVisible()

  // switch to signup mode
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText('Create your free account')).toBeVisible()

  await page.locator('#auth-name').fill('Playwright Tester')
  await page.locator('#auth-email').fill(email)
  await page.locator('#auth-password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()

  // signed-in profile state
  await expect(page.getByText(email)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Playwright Tester')).toBeVisible()

  // sign out
  await page.getByRole('button', { name: /sign out/i }).click()
  // the auth card returns (in the last-used mode — signup here)
  await expect(page.locator('#auth-email')).toBeVisible({ timeout: 20_000 })

  // switch the form back to login mode (scoped to main — the header also has a Sign in button)
  await page.locator('main').getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Welcome back')).toBeVisible()

  // log back in
  await page.locator('#auth-email').fill(email)
  await page.locator('#auth-password').fill(password)
  await page.locator('main').getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText(email)).toBeVisible({ timeout: 20_000 })
})
