import { test, expect, type Page } from '@playwright/test'

// JEE NEXUS — community chat browser test: group creation, @mention
// autocomplete (keyboard + candidate filtering), mention toast with
// conversation deep-link, sidebar unread/mention markers, and the
// DM-wide "no mention autocomplete" rule.
//
// Uses pw-* emails so accounts can be identified and cleaned from a
// shared database (CI DBs are ephemeral). Signup goes through the API
// (page.request shares the browser context cookie jar, so the httpOnly
// session cookie persists for later page.goto calls).

const suffix = Date.now()
const A = {
  name: 'Mina Sender',
  email: `pw-chat-a-${suffix}@jee-nexus.dev`,
  password: 'pw-chat-pass-123',
}
const B = {
  // unique per run: the chat user search matches by NAME substring and
  // earlier probe runs leave same-named pw-* users behind, which would
  // make the search-result row ambiguous (strict mode violation)
  name: `Riya Playwright ${suffix}`,
  email: `pw-chat-b-${suffix}@jee-nexus.dev`,
  password: 'pw-chat-pass-123',
}
const GROUP = `Playwright Mention Squad ${suffix}`

async function signup(page: Page, u: { name: string; email: string; password: string }) {
  // signup is rate-limited to 5/min/IP — against the live site repeated
  // runs exhaust it, so retry after the window resets
  let res = await page.request.post('/api/auth/signup', { data: u })
  if (!res.ok()) {
    await new Promise((r) => setTimeout(r, 61_000))
    res = await page.request.post('/api/auth/signup', { data: u })
  }
  expect(res.ok()).toBeTruthy()
}

test('chat: group mention autocomplete → toast deep-link → sidebar markers → DM skip', async ({ browser }) => {
  test.setTimeout(300_000)

  // ---- two fresh users in separate browser contexts ----
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()
  await signup(pageA, A)
  await signup(pageB, B)

  // B parks on HOME (notification toasts are suppressed on /#/community)
  await pageB.goto('/#/')
  await expect(pageB.getByRole('heading', { level: 1 })).toContainText(/JEE Main/i, { timeout: 20_000 })

  // ---- A creates a study group with B ----
  await pageA.goto('/#/community')
  await expect(pageA.getByRole('button', { name: /new chat/i }).first()).toBeVisible({ timeout: 20_000 })
  await pageA.getByRole('button', { name: /new chat/i }).first().click()
  const dialog = pageA.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'New chat' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Study group' }).click()
  await dialog.getByPlaceholder(/Group name/).fill(GROUP)
  await dialog.getByPlaceholder(/Search students/).fill(B.name)
  // result row's accessible name includes the (privacy-masked) email —
  // match by display name instead, the email is shown as p•••••@…
  await dialog.getByRole('button', { name: new RegExp(B.name) }).click()
  await dialog.getByRole('button', { name: /create group/i }).click()

  // conversation auto-opens after creation
  await expect(pageA.locator('textarea')).toBeVisible({ timeout: 20_000 })
  await expect(pageA.getByPlaceholder(new RegExp(`Message ${GROUP}`))).toBeVisible()

  // ---- @mention autocomplete: word-bounded candidate resolution ----
  const composerA = pageA.locator('textarea')
  // no candidates for an unknown token → popup stays closed
  await composerA.fill('@zzz')
  await expect(pageA.getByRole('listbox', { name: 'Mention a member' })).toHaveCount(0)
  // a prefix of B's name resolves to the full display name
  await composerA.fill('@Riy')
  const listbox = pageA.getByRole('listbox', { name: 'Mention a member' })
  await expect(listbox).toBeVisible()
  await expect(listbox.getByRole('option', { name: B.name })).toBeVisible()
  await composerA.press('Enter')
  await expect(composerA).toHaveValue(`@${B.name} `)
  await composerA.fill(`@${B.name} welcome to the squad`)
  await pageA.getByRole('button', { name: 'Send message' }).click()
  // bubble-scoped: the sidebar preview also contains the message text
  const bubbleA = pageA.locator('div.whitespace-pre-wrap', { hasText: 'welcome to the squad' })
  await expect(bubbleA).toBeVisible({ timeout: 15_000 })

  // ---- B: mention toast → Open deep-links into the conversation ----
  const toastItem = pageB.locator('ol li').filter({ hasText: /mentioned you in/ })
  await expect(toastItem).toBeVisible({ timeout: 35_000 })
  await expect(toastItem).toContainText(`${A.name} mentioned you in ${GROUP}`)
  await toastItem.getByRole('button', { name: 'Open' }).click()

  // deep-link: hash carries the conversation id, group opens, mention chip
  // is highlighted inside the message bubble
  await expect(pageB).toHaveURL(/#\/community\?c=/)
  await expect(pageB.getByPlaceholder(new RegExp(`Message ${GROUP}`))).toBeVisible({ timeout: 20_000 })
  const bubbleB = pageB.locator('div.whitespace-pre-wrap', { hasText: 'welcome to the squad' })
  await expect(bubbleB).toBeVisible()
  const mentionChip = pageB.locator('[class*="bg-primary/15"]', { hasText: `@${B.name}` })
  await expect(mentionChip.first()).toBeVisible()

  // ---- B returns to the list (desktop keeps both panes — fresh mount
  // deselects the conversation); a second mention raises sidebar markers ----
  await pageB.goto('/#/community')
  const convItem = pageB.getByRole('button', { name: new RegExp(GROUP) })
  await expect(convItem).toBeVisible({ timeout: 15_000 })

  await composerA.fill(`@${B.name} ping two`)
  await pageA.getByRole('button', { name: 'Send message' }).click()

  // sidebar shows the rose unread pill + the "@ you" chip (10s sidebar poll)
  await expect(convItem.getByText('@ you')).toBeVisible({ timeout: 25_000 })
  await expect(convItem.locator('span.bg-rose-500')).toBeVisible()

  // opening the conversation clears both markers
  await convItem.click()
  await expect(pageB.getByPlaceholder(new RegExp(`Message ${GROUP}`))).toBeVisible({ timeout: 20_000 })
  await expect(pageB.locator('div.whitespace-pre-wrap', { hasText: 'ping two' })).toBeVisible()
  await expect(convItem.getByText('@ you')).toHaveCount(0)
  await expect(convItem.locator('span.bg-rose-500')).toHaveCount(0)

  // ---- DMs never trigger mention autocomplete ----
  // (sidebar — with its header New chat button — stays visible on desktop)
  await pageA.getByRole('button', { name: /new chat/i }).first().click()
  await expect(dialog.getByRole('heading', { name: 'New chat' })).toBeVisible()
  // default mode is Direct message — search B and click to start the DM
  await dialog.getByPlaceholder(/Search students/).fill(B.name)
  await dialog.getByRole('button', { name: new RegExp(B.name) }).click()
  await expect(pageA.getByPlaceholder('Type a message…')).toBeVisible({ timeout: 20_000 })

  await composerA.fill('@Riy')
  await expect(pageA.getByRole('listbox', { name: 'Mention a member' })).toHaveCount(0)
  await composerA.fill('plain dm, no mentions here')
  await pageA.getByRole('button', { name: 'Send message' }).click()
  await expect(pageA.locator('div.whitespace-pre-wrap', { hasText: 'plain dm, no mentions here' })).toBeVisible({ timeout: 15_000 })

  await ctxA.close()
  await ctxB.close()
})
