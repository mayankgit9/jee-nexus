// JEE NEXUS — spaced repetition engine (Part D)
// Interval ladder: 1 → 3 → 7 → 14 → 30 days, adaptive by performance.
// Correct answers generally INCREASE the interval, incorrect DECREASE it,
// and the student's self-rating (easy/medium/difficult) modulates the step.
// A question stays in the notebook/queue even after one correct answer.
import { db } from '@/lib/db'

export const REVISION_INTERVALS = [1, 3, 7, 14, 30] as const

export interface ReviewOutcome {
  wasCorrect: boolean
  selfRating?: 'easy' | 'medium' | 'difficult' | null
}

/** Next interval (days) given the current one and the review outcome.
 *  Ladder movement:
 *  - correct + easy        → step up by 2 rungs (capped at 30)
 *  - correct + medium/none → step up by 1 rung
 *  - correct + difficult    → stay (consolidate before stretching)
 *  - wrong                  → drop to 1 day (full reset of the ladder)
 */
export function nextIntervalDays(currentDays: number, outcome: ReviewOutcome): number {
  const idx = REVISION_INTERVALS.indexOf(currentDays as (typeof REVISION_INTERVALS)[number])
  const rung = idx === -1 ? 0 : idx
  if (!outcome.wasCorrect) return REVISION_INTERVALS[0]
  if (outcome.selfRating === 'easy') return REVISION_INTERVALS[Math.min(rung + 2, REVISION_INTERVALS.length - 1)]
  if (outcome.selfRating === 'difficult') return REVISION_INTERVALS[Math.min(rung, REVISION_INTERVALS.length - 1)]
  return REVISION_INTERVALS[Math.min(rung + 1, REVISION_INTERVALS.length - 1)]
}

/** ISO date helpers (IST is the audience's wall clock) */
export function istDayKey(d: Date = new Date()): string {
  return new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)
}

/** Upsert a schedule row — never duplicates (unique userId+questionId). */
export async function scheduleRevision(
  userId: string,
  questionId: string,
  source: string,
  opts: { dueAt?: Date; intervalDays?: number } = {}
): Promise<void> {
  const dueAt = opts.dueAt ?? new Date()
  await db.revisionSchedule.upsert({
    where: { userId_questionId: { userId, questionId } },
    update: { active: true, ...(opts.dueAt ? { dueAt } : {}), ...(opts.intervalDays ? { intervalDays: opts.intervalDays } : {}) },
    create: {
      userId,
      questionId,
      source,
      dueAt,
      intervalDays: opts.intervalDays ?? REVISION_INTERVALS[0],
    },
  })
}

/** Apply a review: moves the ladder, records the attempt, timestamps. */
export async function recordReview(
  userId: string,
  questionId: string,
  outcome: ReviewOutcome,
  meta: { hintsUsed?: number; timeSpentSeconds?: number } = {}
): Promise<void> {
  const schedule = await db.revisionSchedule.findUnique({
    where: { userId_questionId: { userId, questionId } },
  })
  const now = new Date()
  const currentDays = schedule?.intervalDays ?? REVISION_INTERVALS[0]
  const interval = nextIntervalDays(currentDays, outcome)
  const dueAt = new Date(now.getTime() + interval * 24 * 3600 * 1000)

  if (schedule) {
    await db.revisionSchedule.update({
      where: { id: schedule.id },
      data: {
        dueAt,
        intervalDays: interval,
        consecutiveCorrect: outcome.wasCorrect ? (schedule.consecutiveCorrect ?? 0) + 1 : 0,
        consecutiveWrong: outcome.wasCorrect ? 0 : (schedule.consecutiveWrong ?? 0) + 1,
        selfRating: outcome.selfRating ?? schedule.selfRating,
        lastResult: outcome.wasCorrect,
        lastReviewedAt: now,
        updatedAt: now,
      },
    })
  } else {
    await db.revisionSchedule.create({
      data: {
        userId,
        questionId,
        source: 'manual',
        dueAt,
        intervalDays: interval,
        consecutiveCorrect: outcome.wasCorrect ? 1 : 0,
        consecutiveWrong: outcome.wasCorrect ? 0 : 1,
        selfRating: outcome.selfRating,
        lastResult: outcome.wasCorrect,
        lastReviewedAt: now,
      },
    })
  }

  const id = schedule?.id
  await db.revisionAttempt.create({
    data: {
      userId,
      questionId,
      ...(id ? { scheduleId: id } : {}),
      wasCorrect: outcome.wasCorrect,
      hintsUsed: meta.hintsUsed ?? 0,
      timeSpentSeconds: meta.timeSpentSeconds ?? 0,
      selfRating: outcome.selfRating ?? null,
    },
  })
}

/** Mistake-notebook aware auto-schedule: when a student answers wrong in
 *  practice, the question enters the revision queue due tomorrow (unless
 *  an earlier/shorter due date is already scheduled). */
export async function autoScheduleOnMistake(userId: string, questionId: string): Promise<void> {
  const existing = await db.revisionSchedule.findUnique({
    where: { userId_questionId: { userId, questionId } },
  })
  if (existing && !existing.active) {
    await db.revisionSchedule.update({
      where: { id: existing.id },
      data: { active: true, dueAt: new Date(), intervalDays: REVISION_INTERVALS[0], updatedAt: new Date() },
    })
    return
  }
  if (existing) return // already scheduled — the queue stays honest, no dupes
  await scheduleRevision(userId, questionId, 'mistake', {
    dueAt: new Date(Date.now() + REVISION_INTERVALS[0] * 24 * 3600 * 1000),
  })
}

/** Chapter/subject/custom bulk scheduling (used by revision-session starters). */
export async function scheduleBulk(
  userId: string,
  questionIds: string[],
  source: string,
  opts: { dueAt?: Date } = {}
): Promise<number> {
  if (questionIds.length === 0) return 0
  const dueAt = opts.dueAt ?? new Date()
  const existing = await db.revisionSchedule.findMany({
    where: { userId, questionId: { in: questionIds } },
    select: { questionId: true, active: true },
  })
  const existingIds = new Set(existing.map((e) => e.questionId))
  const toCreate = questionIds.filter((q) => !existingIds.has(q)).map((questionId) => ({
    userId,
    questionId,
    source,
    dueAt,
    intervalDays: REVISION_INTERVALS[0],
  }))
  // reactivate deactivated rows among the selection
  const toReactivate = existing.filter((e) => !e.active).map((e) => e.questionId)
  if (toReactivate.length) {
    await db.revisionSchedule.updateMany({
      where: { userId, questionId: { in: toReactivate } },
      data: { active: true },
    })
  }
  if (toCreate.length) {
    await db.revisionSchedule.createMany({ data: toCreate, skipDuplicates: true })
  }
  return toCreate.length + toReactivate.length
}
