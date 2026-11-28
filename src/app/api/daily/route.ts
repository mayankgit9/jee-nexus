import { NextRequest } from 'next/server'
import { dbClient } from '@/lib/db'
import { clientIp, getSessionUser, jsonError, rateLimit } from '@/lib/auth'
import { toPublicQuestion, toPublicSolution } from '@/lib/questions'
import { getDailyQuestionId, istDateKey, istDayWindow } from '@/lib/daily'

/**
 * Daily Challenge (Part I, personalized — 0019).
 *
 * Guests: the deterministic community pick (identical for everyone,
 * unchanged scoring — FNV-1a of the IST date, same as before).
 * Signed-in students: a PERSONALIZED pick — deterministic per (user, day)
 * from a pool built from the student's own data:
 *   weak chapters (30-day accuracy < 60% with ≥ 3 graded attempts),
 *   Mistake-Notebook chapters, revision-due chapters, difficulty balanced
 *   by recent 7-day accuracy, preferring never-attempted questions.
 * Personalization NEVER affects leaderboard scoring — the challenge is
 * graded through the same /api/questions/submit path as any practice
 * question, and the leaderboard logic is untouched.
 */
export async function GET(req: NextRequest) {
  try {
    await rateLimit(`daily:${clientIp(req)}`, 60, 60_000)
    const prisma = dbClient()
    const date = istDateKey()
    const user = await getSessionUser()

    let qid: string | null = null
    let personalized = false

    if (user) {
      qid = await getPersonalizedDailyId(user.id, date)
      personalized = Boolean(qid)
    }
    if (!qid) qid = await getDailyQuestionId(date)

    if (!qid) {
      return Response.json({ date, question: null, attemptedCount: 0, answered: null })
    }

    const window = istDayWindow(date)

    const [attemptedCount, question] = await Promise.all([
      prisma.attempt.count({
        where: { questionId: qid, createdAt: { gte: window.start, lt: window.end } },
      }),
      prisma.question.findUnique({
        where: { id: qid },
        include: {
          subject: true,
          chapter: true,
          options: true,
          images: { where: { hidden: false } },
          solution: { include: { question: { include: { images: { where: { hidden: false } } } } } },
          ...(user ? { bookmarks: { where: { userId: user.id }, select: { id: true } } } : {}),
        },
      }),
    ])

    if (!question || question.verificationStatus === 'rejected') {
      return Response.json({ date, question: null, attemptedCount, answered: null })
    }

    let answered: {
      isCorrect: boolean | null
      selectedOptions?: number[]
      numericalValue?: string
      submittedAt: string
    } | null = null
    let personal: Record<string, unknown> | null = null

    if (user) {
      const a = await prisma.attempt.findFirst({
        where: {
          userId: user.id,
          questionId: qid,
          createdAt: { gte: window.start, lt: window.end },
        },
        orderBy: { createdAt: 'desc' },
      })
      if (a) {
        answered = {
          isCorrect: a.isCorrect,
          ...(Array.isArray(a.selectedOptions)
            ? { selectedOptions: (a.selectedOptions as unknown[]).map(Number) }
            : {}),
          ...(a.numericalValue ? { numericalValue: a.numericalValue } : {}),
          submittedAt: a.createdAt.toISOString(),
        }
      }
      personal = await buildPersonalContext(user.id, question.chapter.key, question.subject.key)
    }

    const payload: Record<string, unknown> = {
      date,
      question: toPublicQuestion(question),
      attemptedCount,
      answered,
      personalized,
    }
    // The solution ships ONLY to users who already completed today's challenge
    if (answered && question.solution) payload.solution = toPublicSolution(question.solution)
    if (personal) payload.personal = personal
    return Response.json(payload)
  } catch (err) {
    return jsonError(err)
  }
}

// ---------- personalization (server-side only, deterministic per user+day) ----------

function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

const istDay = (d: Date) => new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)

async function getPersonalizedDailyId(userId: string, date: string): Promise<string | null> {
  const prisma = dbClient()
  const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000)
  const since7 = new Date(Date.now() - 7 * 24 * 3600 * 1000)

  // Weak chapters: own accuracy < 60% across ≥ 3 graded attempts (practice +
  // graded mock answers), from the last 30 days.
  const [practiceAgg, examAgg] = await Promise.all([
    prisma.attempt.groupBy({
      by: ['questionId'],
      where: { userId, createdAt: { gte: since30 }, isCorrect: { not: null } },
      _count: { _all: true },
    }),
    prisma.examAttemptAnswer.findMany({
      where: { examAttempt: { userId, createdAt: { gte: since30 } }, isCorrect: { not: null } },
      select: { isCorrect: true, examQuestion: { select: { question: { select: { id: true, chapter: { select: { key: true } } } } } } },
      take: 4000,
    }),
  ])
  // chapter-wise accuracy needs chapter keys — pull attempts with chapter info
  const practiceDetailed = await prisma.attempt.findMany({
    where: { userId, createdAt: { gte: since30 }, isCorrect: { not: null } },
    select: { isCorrect: true, question: { select: { id: true, chapter: { select: { key: true } } } } },
    take: 4000,
  })
  const chapterStats = new Map<string, { c: number; t: number }>()
  for (const a of practiceDetailed) {
    const k = a.question.chapter.key
    const e = chapterStats.get(k) ?? { c: 0, t: 0 }
    e.t++
    if (a.isCorrect) e.c++
    chapterStats.set(k, e)
  }
  for (const e of examAgg) {
    const k = e.examQuestion.question.chapter.key
    const s = chapterStats.get(k) ?? { c: 0, t: 0 }
    s.t++
    if (e.isCorrect) s.c++
    chapterStats.set(k, s)
  }
  const weakChapters = [...chapterStats.entries()]
    .filter(([, v]) => v.t >= 3 && v.c / v.t < 0.6)
    .sort((a, b) => a[1].c / a[1].t - b[1].c / b[1].t)
    .map(([k]) => k)

  // Mistake notebook + revision-due chapters
  const [mistakeChapters, dueChapters] = await Promise.all([
    prisma.mistakeEntry.findMany({
      where: { userId },
      select: { question: { select: { chapter: { select: { key: true } } } } },
      take: 200,
    }),
    prisma.revisionSchedule.findMany({
      where: { userId, active: true, dueAt: { lte: new Date() } },
      select: { question: { select: { chapter: { select: { key: true } } } } },
      take: 200,
    }),
  ])
  const focusChapters = new Set<string>([
    ...weakChapters.slice(0, 6),
    ...mistakeChapters.map((m) => m.question.chapter.key),
    ...dueChapters.map((d) => d.question.chapter.key),
  ])

  // Already-attempted questions (any time) — prefer never-attempted ones
  const attemptedIds = new Set<string>([
    ...practiceAgg.map((p) => p.questionId),
    ...(await prisma.examAttemptAnswer.findMany({
      where: { examAttempt: { userId } },
      select: { examQuestion: { select: { questionId: true } } },
      take: 8000,
    })).map((e) => e.examQuestion.questionId),
  ])

  // Difficulty balance from recent 7-day accuracy
  const recentRows = await prisma.attempt.findMany({
    where: { userId, createdAt: { gte: since7 }, isCorrect: { not: null } },
    select: { isCorrect: true },
    take: 1000,
  })
  const recentAcc = recentRows.length >= 3 ? recentRows.filter((r) => r.isCorrect).length / recentRows.length : 0.5
  const preferDifficulties = recentAcc > 0.7 ? ['medium', 'hard'] : recentAcc < 0.4 ? ['easy', 'medium'] : ['easy', 'medium', 'hard']

  // Candidate pools (deterministic ordering by id for a stable pool)
  const preferDifficultiesFiltered = preferDifficulties.filter((d): d is 'easy' | 'medium' | 'hard' =>
    ['easy', 'medium', 'hard'].includes(d)
  )
  const focusWhere = {
    verificationStatus: { not: 'rejected' as const },
    ...(focusChapters.size ? { chapter: { key: { in: [...focusChapters] } } } : {}),
    difficulty: { in: preferDifficultiesFiltered },
  }
  let pool = await prisma.question.findMany({
    where: { ...focusWhere, id: { notIn: [...attemptedIds] } },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: 500,
  })
  if (pool.length === 0) {
    pool = await prisma.question.findMany({
      where: focusWhere,
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 500,
    })
  }
  if (pool.length === 0) return null
  const idx = fnv1a(`jee-nexus-daily-personal:${userId}:${date}`) % pool.length
  return pool[idx].id
}

async function buildPersonalContext(userId: string, chapterKey: string, subjectKey: string) {
  const prisma = dbClient()
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000)

  // streak (same rules as /api/stats)
  const streakDays = new Set<string>()
  const [streakAttempts, streakExam] = await Promise.all([
    prisma.attempt.findMany({
      where: { userId, createdAt: { gte: new Date(Date.now() - 120 * 24 * 3600 * 1000) } },
      select: { createdAt: true },
    }),
    prisma.examAttemptAnswer.findMany({
      where: { examAttempt: { userId }, updatedAt: { gte: new Date(Date.now() - 120 * 24 * 3600 * 1000) } },
      select: { updatedAt: true, selectedOptions: true, numericalValue: true },
    }),
  ])
  for (const a of streakAttempts) streakDays.add(istDay(a.createdAt))
  for (const e of streakExam) {
    if (e.selectedOptions === null && e.numericalValue === null) continue
    streakDays.add(istDay(e.updatedAt))
  }
  let streakCurrent = 0
  let cursor = new Date(Date.now() + 5.5 * 3600 * 1000)
  cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate()))
  if (!streakDays.has(cursor.toISOString().slice(0, 10))) cursor = new Date(cursor.getTime() - 86400 * 1000)
  while (streakDays.has(cursor.toISOString().slice(0, 10))) {
    streakCurrent++
    cursor = new Date(cursor.getTime() - 86400 * 1000)
  }

  // this week's activity (IST days)
  const weekStart = new Date(Date.now() + 5.5 * 3600 * 1000)
  const ws = new Date(Date.UTC(weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate()) - 6 * 86400 * 1000 - 5.5 * 3600 * 1000)
  const [weekAttempts, weekExam] = await Promise.all([
    prisma.attempt.findMany({ where: { userId, createdAt: { gte: ws } }, select: { createdAt: true, isCorrect: true } }),
    prisma.examAttemptAnswer.findMany({
      where: { examAttempt: { userId }, updatedAt: { gte: ws }, isCorrect: { not: null } },
      select: { updatedAt: true, isCorrect: true },
    }),
  ])
  const weekByDay = new Map<string, { count: number; correct: number }>()
  for (const a of weekAttempts) {
    const k = istDay(a.createdAt)
    const e = weekByDay.get(k) ?? { count: 0, correct: 0 }
    e.count++
    if (a.isCorrect) e.correct++
    weekByDay.set(k, e)
  }
  for (const a of weekExam) {
    const k = istDay(a.updatedAt)
    const e = weekByDay.get(k) ?? { count: 0, correct: 0 }
    e.count++
    if (a.isCorrect) e.correct++
    weekByDay.set(k, e)
  }
  const weekly = [...weekByDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, v]) => ({ day, ...v }))

  // 30-day subject breakdown + this chapter's personal history
  const [subjectRows, chapterAttempts, examChapterRows] = await Promise.all([
    prisma.attempt.findMany({
      where: { userId, createdAt: { gte: since }, isCorrect: { not: null } },
      select: { isCorrect: true, question: { select: { subject: { select: { key: true } } } } },
      take: 4000,
    }),
    prisma.attempt.findMany({
      where: { userId, question: { chapter: { key: chapterKey } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { isCorrect: true, createdAt: true },
    }),
    prisma.examAttemptAnswer.count({
      where: {
        examAttempt: { userId },
        isCorrect: { not: null },
        examQuestion: { question: { chapter: { key: chapterKey } } },
      },
    }),
  ])
  const subjectBreakdown: Record<string, { total: number; correct: number; accuracy: number }> = {}
  for (const r of subjectRows) {
    const k = r.question.subject.key
    subjectBreakdown[k] = subjectBreakdown[k] ?? { total: 0, correct: 0, accuracy: 0 }
    subjectBreakdown[k].total++
    if (r.isCorrect) subjectBreakdown[k].correct++
  }
  for (const v of Object.values(subjectBreakdown)) v.accuracy = v.total > 0 ? Math.round((100 * v.correct) / v.total) : 0

  return {
    streak: { current: streakCurrent, activeToday: streakDays.has(istDay(new Date())) },
    weekly,
    subjectBreakdown,
    chapterHistory: {
      chapterKey,
      attempts: chapterAttempts.length + examChapterRows,
      recent: chapterAttempts.map((a) => ({ isCorrect: a.isCorrect, at: a.createdAt })),
    },
  }
}
