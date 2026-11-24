// DOM check: does the PYQ question detail render the original exam figure?
import { chromium } from '@playwright/test'

const base = process.env.BASE_URL ?? 'http://localhost:3000'

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })

  const res = await fetch(base + '/api/pyq?year=2019&subject=physics&limit=100')
  const data = await res.json()
  const withImg = (data.questions || []).find((q: { images?: unknown[] }) => (q.images || []).length > 0)
  console.log('target question:', withImg.publicId, '| image url:', withImg.images[0].url)

  // how does PyqView navigate to a question? dump the year->subject flow instead:
  await page.goto(base + '/#/pyq', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  // click the 2019 year card
  const year2019 = page.getByText(/2019/).first()
  await year2019.click()
  await page.waitForTimeout(2500)
  // click Physics subject
  const physics = page.getByRole('button', { name: /physics/i }).first()
  if (await physics.count()) { await physics.click(); await page.waitForTimeout(2500) }
  // click the first question row that mentions the target publicId
  const row = page.getByText(withImg.publicId).first()
  console.log('question row visible:', await row.isVisible().catch(() => false))
  if (await row.isVisible().catch(() => false)) {
    await row.click()
    await page.waitForTimeout(3000)
  }
  const imgs = await page.locator('img[src*="/pyq/"]').all()
  console.log('exam-figure <img> count on page:', imgs.length)
  for (const im of imgs.slice(0, 3)) {
    console.log('  src=', await im.getAttribute('src'),
      '| naturalWidth=', await im.evaluate((el: HTMLImageElement) => el.naturalWidth))
  }
  const attribution = await page.getByText(/original exam|ExamSIDE/i).count()
  console.log('attribution/badge text nodes:', attribution)
  await page.screenshot({ path: '/tmp/shot_question.png' })
  await browser.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
