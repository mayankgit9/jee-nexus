// JEE NEXUS — progressive hints derivation (Part K)
// Hints are DERIVED from the structured solution the app already stores —
// never fabricated independently of the actual solution:
//   Hint 1 = the concept recap      (solutions.key_concept)
//   Hint 2 = the direction of approach (first step heading + its lead sentence)
//   Hint 3 = the key formula / intermediate step (formulas[0] or step 2)
// Questions with only thin solutions get no hints until their solution is
// enriched — honest absence beats fake hints.
import { db } from '@/lib/db'

interface SolutionLike {
  keyConcept: string | null
  formulas: unknown
  body: string
}

/** Extract the Nth step block from a markdown-lite solution body. */
function extractStep(body: string, n: number): string | null {
  const steps = body.split(/\*\*Step\s+\d+[^*]*\*\*/i).filter((s) => s.trim().length > 0)
  const block = steps[n]
  if (!block) return null
  const lead = block
    .replace(/\$\$[\s\S]*?\$\$/g, ' … ') // display math compressed in the hint
    .replace(/\s+/g, ' ')
    .trim()
  const sentence = lead.split(/(?<=[.!?])\s/)[0] ?? lead
  return sentence.trim().slice(0, 300)
}

export function deriveHintsFromSolution(sol: SolutionLike): {
  hint1: string
  hint2: string | null
  hint3: string | null
} | null {
  if (!sol.keyConcept || sol.keyConcept.trim().length < 10) return null
  const formulas = Array.isArray(sol.formulas) ? (sol.formulas as string[]).filter((f) => typeof f === 'string') : []
  const hint1 = sol.keyConcept.replace(/\s+/g, ' ').trim().slice(0, 400)

  // Hint 2 — direction of approach: the opening line of the derivation, or
  // the first step's lead sentence when steps are structured.
  const step0 = extractStep(sol.body, 0)
  const hint2 = step0 && step0.length >= 20 ? step0.slice(0, 300) : null

  // Hint 3 — key formula / intermediate quantity (a formula they'd need, NOT
  // the final answer).
  const hint3 = formulas.length > 0 ? formulas[0].slice(0, 300) : extractStep(sol.body, 1)

  if (!hint2 && !hint3) return null
  return { hint1, hint2, hint3 }
}

/** Derive + persist hints for one question (idempotent upsert).
 *  Only runs for solutions that are rich enough — thin solutions get nothing. */
export async function deriveAndSaveHints(questionId: string): Promise<boolean> {
  const sol = await db.solution.findUnique({ where: { questionId } })
  if (!sol) return false
  const hints = deriveHintsFromSolution(sol)
  if (!hints) return false
  await db.questionHint.upsert({
    where: { questionId },
    update: { hint1: hints.hint1, hint2: hints.hint2, hint3: hints.hint3, source: 'derived', updatedAt: new Date() },
    create: { questionId, hint1: hints.hint1, hint2: hints.hint2, hint3: hints.hint3, source: 'derived' },
  })
  return true
}
