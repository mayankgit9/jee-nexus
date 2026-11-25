#!/usr/bin/env node
// Render the JEE NEXUS brand mark → PNG icons for PWA installability
// (192, 512, maskable 512, apple-touch 180) via the cached Chromium.
const { chromium } = require('playwright-core')
const fs = require('fs')
const path = require('path')
const os = require('os')

const EXE = path.join(os.homedir(), '.cache/ms-playwright/chromium-1200/chrome-linux64/chrome')
const PUB = path.resolve(__dirname, '..', 'public')
const svg = fs.readFileSync('/tmp/brand_icon.svg', 'utf8')

async function render(size, out, maskable) {
  // maskable: mark scaled into the inner ~70% safe zone (bg already fills)
  const inner = maskable ? Math.round(size * 0.7) : size
  const html = `<!doctype html><html><body style="margin:0;background:transparent">
  <div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;">
    <div style="width:${inner}px;height:${inner}px;">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div>
  </div></body></html>`
  const browser = await chromium.launch({ executablePath: EXE })
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  await page.setContent(html)
  const el = await page.$('div')
  await el.screenshot({ path: path.join(PUB, out), omitBackground: true })
  await browser.close()
  console.log('wrote', out, `${size}x${size}`)
}

;(async () => {
  await render(192, 'icon-192.png', false)
  await render(512, 'icon-512.png', false)
  await render(512, 'icon-maskable-512.png', true)
  await render(180, 'apple-touch-icon.png', false)
})()
