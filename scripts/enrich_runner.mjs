// JEE NEXUS — concurrent solution enrichment runner (bounded slices)
// Designed for the sandbox: each invocation processes a TIME-BOUNDED slice
// with concurrency + 429 backoff, checkpointed, newest exams first.
//   bun scripts/enrich_runner.mjs [seconds] [concurrency] [--web-sample N]
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs'
import { PrismaClient } from '@prisma/client'

// import the shared TS lib through bun's TS support (relative path, no alias)
import { enrichSolution, isThinSolution } from '../src/lib/enrich.ts'

const prisma = new PrismaClient()

const SECONDS = Number(process.argv[2] ?? 180)
const CONCURRENCY = Number(process.argv[3] ?? 4)
const WEB_SAMPLE = Math.max(0, Number(process.argv[4] ?? 0)) // first N get web research
const CHECKPOINT_FILE = 'scripts/enrich_checkpoint.json'
const DEAD = 'scripts/enrich_dead.json' // permanently failed ids

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback
  try { return JSON.parse(readFileSync(path, 'utf-8')) } catch { return fallback }
}

const cp = loadJson(CHECKPOINT_FILE, { done: [], failed: [], lastRun: '' })
const dead = new Set(loadJson(DEAD, []))

const deadline = Date.now() + SECONDS * 1000
let ok = 0, fail = 0, skipped = 0, idx = 0

async function processOne(qid, useWeb) {
  const t0 = Date.now()
  try {
    const res = await enrichSolution(qid, { skipWeb: !useWeb })
    if (res.ok && res.source !== 'skipped') { ok++; cp.done.push(qid); return `ok ${res.source}` }
    if (res.source === 'skipped') { skipped++; cp.done.push(qid); return 'skipped(rich)' }
    fail++
    cp.failed.push({ id: qid, error: (res.error ?? 'unknown').slice(0, 160) })
    if (cp.failed.length > 800) cp.failed = cp.failed.slice(-400)
    // permanently dead: no options/no correct answer — stop retrying forever
    if (/No correct option|no options|Question not found/.test(res.error ?? '')) {
      dead.add(qid)
      appendFileSync(DEAD, qid + '\n')
    }
    return `fail ${(res.error ?? '').slice(0, 80)}`
  } catch (e) {
    fail++
    const msg = String(e?.message ?? e)
    cp.failed.push({ id: qid, error: msg.slice(0, 160) })
    if (/429|Too many/i.test(msg)) throw e // bubble to worker for backoff
    return 'fail ' + msg.slice(0, 80)
  } finally {
    console.log(`[enrich] ${String(++idx).padStart(4)} ${qid} ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  }
}

async function worker(queue) {
  while (queue.length > 0 && Date.now() < deadline) {
    const job = queue.shift()
    if (!job) return
    let attempts = 0
    while (true) {
      try {
        await processOne(job.id, job.useWeb)
        break
      } catch (e) {
        attempts++
        if (attempts >= 3) { console.log(`[enrich] giving up on ${job.id} after ${attempts} tries`); break }
        const wait = Math.min(30_000, 4_000 * attempts) + Math.random() * 3_000
        console.log(`[enrich] rate-limited — backing off ${(wait / 1000).toFixed(0)}s`)
        await new Promise((r) => setTimeout(r, wait))
        if (Date.now() >= deadline) break
      }
    }
  }
}

async function main() {
  console.log(`[enrich] slice=${SECONDS}s concurrency=${CONCURRENCY} webSample=${WEB_SAMPLE} checkpoint=${cp.done.length} done`)
  const rows = await prisma.solution.findMany({
    where: { questionId: { notIn: cp.done } },
    select: {
      questionId: true, keyConcept: true, formulas: true, body: true, commonMistakes: true, verification: true,
      question: { select: { sourceYear: true } },
    },
  })
  const thin = rows
    .filter((s) => isThinSolution(s) && !dead.has(s.questionId))
    .sort((a, b) => (b.question.sourceYear ?? 0) - (a.question.sourceYear ?? 0))
  console.log(`[enrich] ${thin.length} thin remaining; slice takes ${Math.min(thin.length, 4000)}`)

  const queue = thin.slice(0, 4000).map((s, i) => ({ id: s.questionId, useWeb: i < WEB_SAMPLE }))
  const workers = Array.from({ length: CONCURRENCY }, () => worker(queue))
  await Promise.all(workers)
  cp.lastRun = new Date().toISOString()
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp))
  console.log(`[enrich] SLICE DONE ok=${ok} fail=${fail} skipped=${skipped} checkpoint=${cp.done.length}`)
}

main()
  .catch((e) => { console.error('[enrich] FATAL', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
