// Test: pass 2 — remove residual watermark text from pass-1 output
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'

const PROMPT = `This clean exam diagram still contains leftover watermark text fragments (letters like "GOA", "EXS AM", "AAS AM", "LMS AM", "ExamGOAL.COM" and stray boxed stamps). Erase ALL of that residual text completely. Keep every actual diagram element — lines, curves, circles, ellipse, axes, arrowheads, points, tick marks and the small coordinate labels near points — exactly unchanged in position and shape. Result: only the pure geometry on a plain white background.`

async function main() {
  const zai = await ZAI.create()
  const buf = fs.readFileSync('/tmp/wmtest/2026_ai.png')
  const dataUrl = `data:image/png;base64,${buf.toString('base64')}`
  const t0 = Date.now()
  const response = await zai.images.generations.edit({
    prompt: PROMPT,
    images: [{ url: dataUrl }],
    size: '1152x864',
  })
  const b64 = response?.data?.[0]?.base64
  if (!b64) {
    console.error('no image returned', JSON.stringify(response).slice(0, 400))
    process.exit(1)
  }
  fs.writeFileSync('/tmp/wmtest/2026_ai2.png', Buffer.from(b64, 'base64'))
  console.log(`done in ${Date.now() - t0}ms -> /tmp/wmtest/2026_ai2.png`)
}

main().catch((e) => {
  console.error('FAILED:', e?.message ?? e)
  process.exit(1)
})
