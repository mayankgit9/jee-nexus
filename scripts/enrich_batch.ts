// JEE NEXUS — batch solution enrichment runner (background worker)
// Processes thin solutions newest-exam-first with checkpointing.
// Run: bun scripts/enrich_batch.ts [limit]
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { PrismaClient } from '@prisma/client'
import { enrichSolution, isThinSolution } from '../src/lib/enrich'

const prisma = new PrismaClient()

const LIMIT = Number(process.argv[2] ?? 400)
const CHECKPOINT_FILE = 'scripts/enrich_checkpoint.json'

interface Checkpoint {
  done: string[]
  failed: { id: string; error: string }[]
  lastRun: string
}

function loadCheckpoint(): Checkpoint {
  if (!existsSync(CHECKPOINT_FILE)) return { done: [], failed: [], lastRun: '' }
  try {
    return JSON.parse(readFileSync(CHECKPOINT_FILE, 'utf-8'))
  } catch {
    return { done: [], failed: [], lastRun: '' }
  }
}

function saveCheckpoint(cp: Checkpoint) {
  cp.lastRun = new Date().toISOString()
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp))
}

async function main() {
  const cp = loadCheckpoint()
  console.log(`[enrich] checkpoint: ${cp.done.length} done, ${cp.failed.length} failed`)

  const solutions = await prisma.solution.findMany({
    where: { questionId: { notIn: cp.done } },
    select: {
      questionId: true,
      keyConcept: true,
      formulas: true,
      body: true,
      commonMistakes: true,
      verification: true,
      question: { select: { sourceYear: true, verificationStatus: true } },
    },
  })
  const thin = solutions
    .filter((s) => isThinSolution(s))
    .sort((a, b) => (b.question.sourceYear ?? 0) - (a.question.sourceYear ?? 0))
  console.log(`[enrich] ${thin.length} thin solutions remaining; processing up to ${LIMIT}`)

  const slice = thin.slice(0, LIMIT)
  let ok = 0
  let fail = 0
  for (let i = 0; i < slice.length; i++) {
    const s = slice[i]
    const t0 = Date.now()
    try {
      const res = await enrichSolution(s.questionId)
      if (res.ok) {
        ok++
        cp.done.push(s.questionId)
      } else {
        fail++
        cp.failed.push({ id: s.questionId, error: res.error ?? 'unknown' })
        if (cp.failed.length > 500) cp.failed = cp.failed.slice(-300)
      }
      process.stdout.write(
        `[enrich] ${i + 1}/${slice.length} ok=${ok} fail=${fail} ${((Date.now() - t0) / 1000).toFixed(1)}s src=${res.source} ${res.error ?? ''}\n`
      )
    } catch (e) {
      fail++
      cp.failed.push({ id: s.questionId, error: String((e as Error)?.message ?? e).slice(0, 200) })
      console.error(`[enrich] crashed on ${s.questionId}:`, (e as Error)?.message)
    }
    if ((i + 1) % 5 === 0) saveCheckpoint(cp)
    // gentle pacing to avoid provider rate limits
    await new Promise((r) => setTimeout(r, 400))
  }
  saveCheckpoint(cp)
  console.log(`[enrich] DONE ok=${ok} fail=${fail}`)
}

main()
  .catch((e) => {
    console.error('[enrich] FATAL', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
