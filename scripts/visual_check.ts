// Visual check: PYQ question detail with original exam figure
import { chromium } from '@playwright/test'

const base = process.env.BASE_URL ?? 'http://localhost:3000'

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })

  // home
  await page.goto(base + '/', { waitUntil: 'networkidle' })
  await page.screenshot({ path: '/tmp/shot_home.png' })

  // PYQ library year grid
  await page.goto(base + '/#/pyq', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: '/tmp/shot_pyq.png' })

  // 2019 physics list
  await page.goto(base + '/#/pyq?year=2019&subject=physics', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: '/tmp/shot_pyq_2019.png' })

  // find a question with an image via API and open it directly
  const res = await fetch(base + '/api/pyq?year=2019&subject=physics&limit=100')
  const data = await res.json()
  const withImg = (data.questions || []).find((q: { images?: unknown[] }) => (q.images || []).length > 0)
  console.log('question with image:', withImg?.publicId, '| images:', withImg?.images?.length)
  if (withImg) {
    await page.goto(base + '/#/pyq?year=2019&subject=physics&q=' + withImg.publicId, { waitUntil: 'networkidle' })
    await page.waitForTimeout(3000)
    await page.screenshot({ path: '/tmp/shot_question.png', fullPage: false })
    // scroll to the figure
    const img = page.locator('img[src*="/pyq/"]').first()
    if (await img.count()) {
      await img.scrollIntoViewIfNeeded()
      await page.waitForTimeout(1200)
      await page.screenshot({ path: '/tmp/shot_figure.png' })
      const natural = await img.evaluate((el: HTMLImageElement) => el.naturalWidth)
      console.log('exam figure naturalWidth:', natural)
    }
  }
  await browser.close()
  console.log('done')
}

main().catch((e) => { console.error(e); process.exit(1) })
