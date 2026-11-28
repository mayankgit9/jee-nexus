// JEE NEXUS — AI watermark-remake worker (background)
// Takes the structural-clean output (tiles/border already removed, giant
// stamp text may remain) and asks the image-edit model to erase the leftover
// watermark text while preserving every geometric element.
// Processes scripts/heavy_ai_queue.txt (newest-exam-first), converts results
// back to the original file format via PIL, writes a done-log.
// Run: bun scripts/ai_watermark_worker.mjs
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs'
import { execFileSync } from 'child_process'
import ZAI from 'z-ai-web-dev-sdk'

const BASE = '/home/z/my-project'
const QUEUE = `${BASE}/scripts/heavy_ai_queue.txt`
const DONE_LOG = `${BASE}/scripts/heavy_ai_done.txt`
const FAIL_LOG = `${BASE}/scripts/heavy_ai_failed.txt`
const TMP = '/tmp/ai_wm_in.png'
const OUT = '/tmp/ai_wm_out.png'
const SUPABASE_REF = process.env.SUPABASE_REF ?? 'mxfiazcjcgqzqynmsefp'
const SUPABASE_PAT = process.env.SUPABASE_PAT ?? ''

const PROMPT = `This exam figure still contains leftover watermark text stamps (large "ExamGOAL.COM" letters, boxed logo stamps, stray letters like "EXS AM") and faint dotted grid remnants on a white background. Erase ALL of that watermark text and noise completely, filling with plain white. Keep every genuine geometric element exactly as-is: all lines, curves, circles, hatching, arrows, axis marks, points, chemical structure bonds, atom letters and small numeric coordinate labels must remain unchanged in position, size and shape. Output the same figure, watermark-free.`

async function main() {
  if (!existsSync(QUEUE)) {
    console.log('[aiworker] no queue file yet — nothing to do')
    return
  }
  const queue = readFileSync(QUEUE, 'utf-8').split('\n').map((s) => s.trim()).filter(Boolean)
  const done = new Set(existsSync(DONE_LOG) ? readFileSync(DONE_LOG, 'utf-8').split('\n').filter(Boolean) : [])
  const pending = queue.filter((rel) => !done.has(rel))
  console.log(`[aiworker] ${pending.length} of ${queue.length} pending`)
  if (pending.length === 0) return

  const zai = await ZAI.create()
  let ok = 0
  let fail = 0
  for (let i = 0; i < pending.length; i++) {
    const rel = pending[i]
    const t0 = Date.now()
    try {
      const src = `${BASE}/public/${rel}`
      // Input preference: pristine ORIGINAL (full content, watermark present)
      // -> structural-clean output (stamp partly removed). The edit model
      // erases watermark text far better when the underlying figure is intact.
      const orig = `${BASE}/pyq_originals/${rel}`
      let inputPath = src
      if (existsSync(orig)) inputPath = orig
      else {
        // git HEAD keeps every pre-clean original — extract to a temp file
        try {
          const bytes = execFileSync('git', ['-C', BASE, 'show', `HEAD:public/${rel}`], { maxBuffer: 64 * 1024 * 1024 })
          writeFileSync('/tmp/ai_wm_orig.bin', bytes)
          inputPath = '/tmp/ai_wm_orig.bin'
        } catch { /* not tracked — fall back to the cleaned file */ }
      }
      execFileSync('python3', ['-c', `from PIL import Image; Image.open('${inputPath}').convert('RGB').save('${TMP}')`], { timeout: 30000 })
      const buf = readFileSync(TMP)
      const response = await zai.images.generations.edit({
        prompt: PROMPT,
        images: [{ url: `data:image/png;base64,${buf.toString('base64')}` }],
        size: '1152x864',
      })
      const b64 = response?.data?.[0]?.base64
      if (!b64) throw new Error('no image in response')
      writeFileSync(OUT, Buffer.from(b64, 'base64'))
      // convert back to the original format/extension
      execFileSync('python3', ['-c', `from PIL import Image; im = Image.open('${OUT}').convert('RGB'); im.save('${src}', quality=90)`], { timeout: 30000 })
      appendFileSync(DONE_LOG, `${rel}\n`)
      // remake succeeded — un-hide rows that reference this figure (migration 0018)
      try {
        const siteUrl = '/' + rel
        execFileSync('curl', ['-s', '-X', 'POST',
          `https://api.supabase.com/v1/projects/${SUPABASE_REF}/database/query`,
          '-H', `Authorization: Bearer ${SUPABASE_PAT}`,
          '-H', 'Content-Type: application/json',
          '-d', JSON.stringify({ query: `UPDATE question_images SET hidden = false WHERE url = '${siteUrl}';` })],
          { timeout: 30000 })
      } catch { /* un-hide is best-effort; done-log allows a re-run */ }
      ok++
      console.log(`[aiworker] ${i + 1}/${pending.length} ok=${ok} fail=${fail} ${((Date.now() - t0) / 1000).toFixed(0)}s ${rel}`)
    } catch (e) {
      fail++
      appendFileSync(FAIL_LOG, `${rel}\t${String(e?.message ?? e).slice(0, 160)}\n`)
      console.error(`[aiworker] FAIL ${rel}: ${String(e?.message ?? e).slice(0, 120)}`)
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  console.log(`[aiworker] DONE ok=${ok} fail=${fail}`)
}

main().catch((e) => {
  console.error('[aiworker] FATAL', e?.message ?? e)
  process.exit(1)
})
