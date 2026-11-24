import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'fs'

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// JEE NEXUS — PYQ library browser test: year grid → subject → chapter → question detail.
// The year GRID cards contain "N questions"; home-page year shortcut chips do not —
// filter by that to avoid transition-animation races.

function pyqYearCard(page: Page, year: number) {
  return page.locator('button', { hasText: String(year) }).filter({ hasText: /questions/ })
}

test('pyq: year grid shows real counts only', async ({ page }) => {
  await page.goto('/#/pyq')
  // the PYQ view header is present (page fully transitioned from home)
  await expect(page.getByText(/Browse previous year questions/i)).toBeVisible({ timeout: 20_000 })

  const y2023 = pyqYearCard(page, 2023)
  await expect(y2023).toBeVisible()
  await expect(y2023).toBeEnabled()
  await expect(y2023.getByText(/questions/)).toBeVisible()
})

test('pyq: navigate year → subject → question detail', async ({ page }) => {
  await page.goto('/#/pyq')
  await expect(page.getByText(/Browse previous year questions/i)).toBeVisible({ timeout: 20_000 })

  // open a seeded year
  await pyqYearCard(page, 2023).click()
  // the year breakdown renders (heading + subject cards with question counts)
  await expect(page.getByRole('heading', { name: /JEE Main 2023/i })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: /Physics.*questions/i })).toBeVisible()

  // subject cards render; open physics (the subject card shows a question count)
  const physics = page.locator('button', { hasText: /Physics/i }).filter({ hasText: /questions/i }).first()
  await expect(physics).toBeVisible({ timeout: 20_000 })
  await physics.click()

  // question list appears
  const questionRow = page.locator('button', { hasText: /Shift/i }).first()
  await expect(questionRow).toBeVisible({ timeout: 20_000 })

  // open the question detail (readOnly card) — back button + exam metadata visible
  await questionRow.click()
  await expect(page.getByRole('button', { name: /back to list/i })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/JEE Main 2023/).first()).toBeVisible()
  // the chapter chip shows SOME taxonomy chapter name (question set is real
  // PYQ data, so the chapter varies — match any chapter from taxonomy.json)
  const chapters = (JSON.parse(readFileSync('data/taxonomy.json', 'utf-8')).subjects as { chapters: { name: string }[] }[])
    .flatMap((s) => s.chapters.map((c) => c.name))
  const anyChapter = new RegExp(`^(?:${chapters.map(escapeRegExp).join('|')})$`, 'i')
  await expect(page.locator('[data-slot="chip"], [class*="chip"], span', { hasText: anyChapter }).first()).toBeVisible({ timeout: 15_000 })
})

test('pyq: chapter filter from breakdown', async ({ page }) => {
  await page.goto('/#/pyq/2023')
  const physics = page.locator('button', { hasText: /Physics/i }).filter({ hasText: /questions/i }).first()
  await expect(physics).toBeVisible({ timeout: 20_000 })
  // physics card exposes chapter buttons beneath it
  const chapterBtn = page.locator('button', { hasText: /Q$/i }).first()
  await expect(chapterBtn).toBeVisible()
  await chapterBtn.click()
  await expect(page.getByText(/Chapter filter/i)).toBeVisible({ timeout: 20_000 })
})
