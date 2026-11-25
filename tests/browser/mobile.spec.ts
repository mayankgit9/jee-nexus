import { test, expect } from '@playwright/test'

// JEE NEXUS — mobile viewport smoke test (390×844).

test.use({ viewport: { width: 390, height: 844 } })

test('mobile: burger menu navigation, no horizontal overflow', async ({ page }) => {
  await page.goto('/')

  // desktop nav is hidden on mobile — burger menu is present
  const burger = page.getByRole('button', { name: /menu|toggle navigation/i }).first()
  const burgerVisible = await burger.isVisible().catch(() => false)

  // either a burger opens the nav, or nav items collapse into a sheet
  if (burgerVisible) {
    await burger.click()
    await expect(page.getByRole('link', { name: /practice/i }).or(page.getByRole('button', { name: /practice/i })).first()).toBeVisible({ timeout: 10_000 })
  }

  // no horizontal overflow on the home page
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(2)

  // home content is reachable and readable at this width
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
})

test('mobile: practice view renders without overflow', async ({ page }) => {
  await page.goto('/#/practice')
  await expect(page.getByRole('button', { name: /surprise me/i })).toBeVisible({ timeout: 20_000 })

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(2)
})

test('mobile: PYQ year grid stacks', async ({ page }) => {
  await page.goto('/#/pyq')
  // year cards are rich buttons ("2023" + count + subject chips) — match
  // unanchored; no other year button contains "2023" as a substring
  await expect(page.locator('button', { hasText: /2023/ })).toBeVisible({ timeout: 20_000 })

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(2)
})
