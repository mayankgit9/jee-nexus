import { test, expect } from '@playwright/test'

// JEE NEXUS — CBT examination runner browser test (the NTA-style core).
// Signs up a fresh pw-* account, creates a small custom test, runs the full
// exam flow: palette states, timer, answer, mark-for-review, NTA submit
// dialog, submission, result screen with per-section stats and review.

const email = `pw-cbt-${Date.now()}@jee-nexus.dev`
const password = 'pw-test-pass-123'

test('CBT: full exam lifecycle in the browser', async ({ page }) => {
  test.setTimeout(180_000)

  // ---- sign up ----
  await page.goto('/#/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.locator('#auth-name').fill('CBT Tester')
  await page.locator('#auth-email').fill(email)
  await page.locator('#auth-password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText(email)).toBeVisible({ timeout: 20_000 })

  // ---- create a small custom test (5 min, physics) ----
  await page.goto('/#/mock')
  await page.getByRole('button', { name: /create custom test/i }).click()
  // the dialog opens (role-scoped: the empty-state hint also mentions the words)
  await expect(page.getByRole('heading', { name: 'Create a custom test' })).toBeVisible()
  await page.locator('#ct-title').fill('PW Test — physics 2q')
  await page.getByRole('button', { name: 'Physics', exact: true }).click()
  await page.locator('#ct-count').fill('2')
  await page.locator('#ct-min').fill('5')
  await page.getByRole('button', { name: /generate & start/i }).click()

  // ---- the runner takes over the screen ----
  await expect(page.getByText(/Question 1 of/i)).toBeVisible({ timeout: 40_000 })

  // timer visible (mm:ss, starts at 05:00 or just under)
  const timer = page.locator('.font-mono', { hasText: /\d{2}:\d{2}/ }).first()
  await expect(timer).toBeVisible()

  // palette with 5-state legend and question grid (anchored to avoid matching 'Not answered')
  await expect(page.getByText(/^Answered \(/)).toBeVisible()
  await expect(page.getByText(/^Not visited \(/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Go to question 1' })).toBeVisible()

  // ---- answer question 1 ----
  const radio = page.locator('input[type="radio"]')
  const checkbox = page.locator('input[type="checkbox"]')
  const numerical = page.locator('#exam-num')

  if ((await radio.count()) > 0) {
    await radio.first().check()
  } else if ((await checkbox.count()) > 0) {
    await checkbox.first().check()
  } else {
    await numerical.fill('1.5')
  }

  // answered count updates in the legend (anchored — 'Not answered (' must not match)
  await expect(page.getByText(/^Answered \(1\)/)).toBeVisible()

  // ---- mark question 2 for review via palette, visit it ----
  await page.getByRole('button', { name: 'Go to question 2' }).click()
  await expect(page.getByText(/Question 2 of/i)).toBeVisible()
  await page.getByRole('button', { name: /mark for review/i }).click()
  // palette marked count updates (anchored — 'Ans+Marked (' must not match)
  await expect(page.getByText(/^Marked \(/)).toBeVisible()

  // ---- NTA submit dialog ----
  await page.getByRole('button', { name: /submit exam/i }).first().click()
  await expect(page.getByText('Submit examination?')).toBeVisible()
  // summary rows present (exact match — the palette legend has 'Not answered (0)' too)
  await expect(page.getByText('Not answered', { exact: true })).toBeVisible()
  await expect(page.getByText('Time remaining')).toBeVisible()

  // cancel first (dialog behaves), then submit for real
  await page.getByRole('button', { name: /continue exam/i }).click()
  await expect(page.getByText('Submit examination?')).toBeHidden()
  await page.getByRole('button', { name: /submit exam/i }).first().click()
  await page.getByRole('button', { name: /yes, submit/i }).click()

  // ---- after submission the app returns to the mock list; open the result ----
  await expect(page.getByRole('heading', { name: 'Attempt history' })).toBeVisible({ timeout: 40_000 })
  await page.getByRole('button', { name: /view result/i }).first().click()

  // ---- result screen ----
  await expect(page.getByText(/Question-wise review/)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/^Q1 /).first()).toBeVisible()
  // per-section breakdown appears for the physics section
  await expect(page.getByText(/physics/i).first()).toBeVisible()
}, )

test('CBT: resume keeps saved answers', async ({ page }) => {
  test.setTimeout(180_000)

  const email2 = `pw-resume-${Date.now()}@jee-nexus.dev`
  const examTitle = `PW Resume ${Date.now()}`
  await page.goto('/#/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.locator('#auth-name').fill('Resume Tester')
  await page.locator('#auth-email').fill(email2)
  await page.locator('#auth-password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText(email2)).toBeVisible({ timeout: 20_000 })

  await page.goto('/#/mock')
  await page.getByRole('button', { name: /create custom test/i }).click()
  await page.locator('#ct-title').fill(examTitle)
  await page.getByRole('button', { name: 'Chemistry', exact: true }).click()
  await page.locator('#ct-count').fill('2')
  await page.locator('#ct-min').fill('5')
  await page.getByRole('button', { name: /generate & start/i }).click()

  await expect(page.getByText(/Question 1 of/i)).toBeVisible({ timeout: 40_000 })

  // answer q1 then reload mid-exam
  const radio = page.locator('input[type="radio"]')
  const checkbox = page.locator('input[type="checkbox"]')
  const numerical = page.locator('#exam-num')

  // listener armed BEFORE the interaction (the POST fires on selection/blur)
  const answerSaved = page
    .waitForResponse((r) => r.url().includes('/api/exam/answer') && r.request().method() === 'POST', { timeout: 15_000 })
    .catch(() => null)

  if ((await radio.count()) > 0) {
    await radio.first().check()
  } else if ((await checkbox.count()) > 0) {
    await checkbox.first().check()
  } else {
    await numerical.fill('42')
    // blur the input so the numerical answer autosaves (onChange only updates local state)
    await numerical.blur()
  }
  await answerSaved

  const saveNextSaved = page
    .waitForResponse((r) => r.url().includes('/api/exam/answer') && r.request().method() === 'POST', { timeout: 15_000 })
    .catch(() => null)
  await page.getByRole('button', { name: /save & next/i }).click()
  await expect(page.getByText(/Question 2 of/i)).toBeVisible()
  await saveNextSaved
  await page.waitForTimeout(300)

  // reload — the exam list should offer re-entry into the same attempt.
  // The exam card is scoped by its unique title; the button inside the card
  // is used (the header user button would also match a loose /resume/ pattern).
  await page.reload()
  await page.goto('/#/mock')
  const examCard = page.locator('main .rounded-2xl, main [class*="border"]').filter({ hasText: examTitle }).first()
  await expect(examCard).toBeVisible({ timeout: 40_000 })
  await examCard.getByRole('button', { name: /re-attempt|start test/i }).click()
  // the runner restores the saved answer state (question 1 answered)
  await expect(page.getByText(/Question \d of/i)).toBeVisible({ timeout: 40_000 })
  await expect(page.getByText(/^Answered \(1\)/)).toBeVisible()
})
