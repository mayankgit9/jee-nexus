import { Prisma } from '@prisma/client'
import { dbClient } from '@/lib/db'

/**
 * Daily Challenge (question of the day).
 *
 * Pick is DETERMINISTIC per IST day: FNV-1a hash of the date key selects an
 * index into the id-ordered eligible pool. Every visitor of the same IST day
 * gets the same question with no extra table or state; the pick only changes
 * if the bank itself changes (the corpus is closed, so in practice never).
 * Day boundary is IST (UTC+5:30) — the audience's natural "today", matching
 * how study streaks are counted.
 */

export const ELIGIBLE_WHERE: Prisma.QuestionWhereInput = {
  verificationStatus: { not: 'rejected' },
}

/** YYYY-MM-DD for "now" on the IST wall clock */
export function istDateKey(now: Date = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)
}

/** UTC instants covering the whole IST day `dateKey` (00:00 IST → 24:00 IST) */
export function istDayWindow(dateKey: string): { start: Date; end: Date } {
  const startMs = Date.parse(`${dateKey}T00:00:00Z`) - 5.5 * 3600 * 1000
  if (Number.isNaN(startMs)) throw new Error(`bad date key: ${dateKey}`)
  return { start: new Date(startMs), end: new Date(startMs + 24 * 3600 * 1000) }
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** The question id chosen for today (null when the bank is empty) */
export async function getDailyQuestionId(dateKey: string = istDateKey()): Promise<string | null> {
  const prisma = dbClient()
  const total = await prisma.question.count({ where: ELIGIBLE_WHERE })
  if (total === 0) return null
  const idx = fnv1a(`jee-nexus-daily:${dateKey}`) % total
  const rows = await prisma.question.findMany({
    where: ELIGIBLE_WHERE,
    select: { id: true },
    orderBy: { id: 'asc' },
    skip: idx,
    take: 1,
  })
  return rows[0]?.id ?? null
}
