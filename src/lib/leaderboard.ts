// JEE NEXUS — leaderboard ranking core.
//
// Single source of truth for the community board metric: graded practice
// attempts + graded CBT/mock answers (same merge as the stats dashboard),
// ranked attempts desc → correct desc → least time asc. Shared by:
//   - GET  /api/leaderboard           (rolling / archived week windows, all-time)
//   - POST /api/leaderboard/snapshot  (pinned weekly winners, migration 0015)
// Keeping the merge in one place guarantees the hall of fame can never drift
// from what the live board actually showed for the same window.
import type { PrismaClient } from '@prisma/client'

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000
/** archive depth of GET /api/leaderboard?weekOffset (12 weeks back) */
export const WEEK_OFFSET_MAX_BOUND = 12
/** snapshot endpoint refuses windows older than this many weeks */
export const WINNER_WINDOW_MAX_AGE = 13

export interface RankedUser {
  userId: string
  attempts: number
  correct: number
  timeSeconds: number
  accuracy: number
}

export interface BoardWindow {
  /** inclusive lower bound (undefined = no lower bound, all-time) */
  since?: Date
  /** exclusive upper bound; undefined keeps the original trailing-7d shape */
  until?: Date
}

/**
 * Rank every user in the given window. Portable Prisma groupBy only (works
 * on PG prod + SQLite local dev) — no raw SQL, no date_trunc, so no
 * engine-specific drift.
 */
export async function computeRankedBoard(client: PrismaClient, window: BoardWindow): Promise<RankedUser[]> {
  const { since, until } = window
  const where = since
    ? until
      ? { createdAt: { gte: since, lt: until } }
      : { createdAt: { gte: since } }
    : {}

  const [byUser, byCorrect, examAnswers] = await Promise.all([
    client.attempt.groupBy({ by: ['userId'], where, _count: { _all: true }, _sum: { timeSpentSeconds: true } }),
    client.attempt.groupBy({ by: ['userId'], where: { ...where, isCorrect: true }, _count: { _all: true } }),
    // graded CBT/mock answers count toward the board too — mirrors the
    // stats dashboard (a mock-only student must not be invisible here).
    // Json-null filtering is skipped in SQL on purpose (DbNull subtleties)
    // and applied in JS below.
    client.examAttemptAnswer.findMany({
      where: { examAttempt: { status: { in: ['submitted', 'expired'] } } },
      select: {
        selectedOptions: true,
        numericalValue: true,
        isCorrect: true,
        timeSpentSeconds: true,
        updatedAt: true,
        examAttempt: { select: { userId: true } },
      },
      take: 20000,
    }),
  ])

  const stats = new Map<string, { attempts: number; correct: number; timeSeconds: number }>()
  for (const r of byUser) {
    stats.set(r.userId, { attempts: r._count._all, correct: 0, timeSeconds: r._sum.timeSpentSeconds ?? 0 })
  }
  for (const r of byCorrect) {
    const s = stats.get(r.userId)
    if (s) s.correct = r._count._all
  }
  for (const ea of examAnswers) {
    if (ea.selectedOptions === null && ea.numericalValue === null) continue // unattempted slot
    const t = ea.updatedAt.getTime()
    if (since && t < since.getTime()) continue
    if (until && t >= until.getTime()) continue
    const s = stats.get(ea.examAttempt.userId) ?? { attempts: 0, correct: 0, timeSeconds: 0 }
    s.attempts++
    if (ea.isCorrect === true) s.correct++
    s.timeSeconds += ea.timeSpentSeconds
    stats.set(ea.examAttempt.userId, s)
  }

  return [...stats.entries()]
    .map(([userId, v]) => ({ userId, ...v, accuracy: v.attempts > 0 ? v.correct / v.attempts : 0 }))
    .sort((a, b) => b.attempts - a.attempts || b.correct - a.correct || a.timeSeconds - b.timeSeconds)
}
