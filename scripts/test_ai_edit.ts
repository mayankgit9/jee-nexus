// Test: AI watermark removal on one heavy sample (z-ai-web-dev-sdk, backend only)
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'

const PROMPT = `This is a JEE exam geometry/physics figure covered in a tiled 'ExamGOAL.COM' watermark overlay and a dark background tint. Completely remove every watermark stamp, tiled logo box and background tint. Redraw the exact same clean exam diagram on a plain white background: keep every line, curve, circle, axis, point, tick mark and text label in the SAME position with the SAME meaning, drawn with crisp saturated blue strokes. Do not invent new geometric elements and do not delete any original ones.`

async function main() {
  const zai = await ZAI.create()
  const buf = fs.readFileSync('/tmp/wmtest/2026_orig.png')
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
  fs.writeFileSync('/tmp/wmtest/2026_ai.png', Buffer.from(b64, 'base64'))
  console.log(`done in ${Date.now() - t0}ms -> /tmp/wmtest/2026_ai.png`)
}

main().catch((e) => {
  console.error('FAILED:', e?.message ?? e)
  process.exit(1)
})
