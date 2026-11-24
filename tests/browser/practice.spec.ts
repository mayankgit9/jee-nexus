import { test, expect, type Page } from '@playwright/test'

// JEE NEXUS — practice flow browser test: random question → answer → graded → solution.
// NOTE 1: QuestionCard options are Radix controls wrapped in <label> — click the
//         label, not the control (direct control clicks double-toggle).
// NOTE 2: always wait for the question card header ("Question 1 / 1") before
//         locating options — the filter panel also contains checkboxes and
//         stays mounted until the session API resolves (race).

async function startSurpriseQuestion(page: Page) {
  await page.goto('/#/practice')
  const surprise = page.getByRole('button', { name: /surprise me/i })
  await expect(surprise).toBeVisible({ timeout: 20_000 })
  await surprise.click()

  // the question card header appears once the session API resolves
  await expect(page.getByText(/Question 1 \/ 1/)).toBeVisible({ timeout: 30_000 })
}

async function answerCurrent(page: Page, numericalValue = '3.47') {
  // the session view replaces the filter panel, so option labels are unambiguous
  const optionLabel = page.locator('main label', { has: page.locator('[role="radio"], [role="checkbox"]') })
  const numerical = page.locator('input[inputmode="decimal"]')

  if ((await optionLabel.count()) > 0) {
    await optionLabel.first().click()
  } else {
    await numerical.first().fill(numericalValue)
  }
  // the submit button enables once the answer registers
  await expect(page.getByRole('button', { name: /submit answer/i })).toBeEnabled({ timeout: 10_000 })
}

test('practice: surprise question → answer → submit → solution renders', async ({ page }) => {
  await startSurpriseQuestion(page)
  await answerCurrent(page)

  await page.getByRole('button', { name: /submit answer/i }).click()

  // graded result banner + detailed solution appear
  await expect(page.getByText(/Correct!|Incorrect|Skipped/).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Detailed Solution')).toBeVisible({ timeout: 30_000 })
  // 'Concept' block renders only for questions that have a keyConcept
  // (real PYQ solutions keep the official explanation in body only) — either
  // the Concept block or the solution body prose must be present.
  const concept = page.getByText('Concept').first()
  const solutionProse = page.locator('main').getByText(/Given|From|Consider|answer/i).first()
  await expect(concept.or(solutionProse).first()).toBeVisible({ timeout: 15_000 })
})

test('practice session summary after finishing', async ({ page }) => {
  await startSurpriseQuestion(page)
  await answerCurrent(page, '1')

  await page.getByRole('button', { name: /submit answer/i }).click()
  await expect(page.getByText('Detailed Solution')).toBeVisible({ timeout: 30_000 })

  // single-question session: finish → summary with stats and New session
  await page.getByRole('button', { name: /finish session/i }).click()
  await expect(page.getByRole('button', { name: /new session/i })).toBeVisible({ timeout: 30_000 })
})
