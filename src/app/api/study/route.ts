import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, jsonError, HttpError, rateLimit } from '@/lib/auth'
import { Prisma } from '@prisma/client'

/**
 * Study dashboard — syllabus tracker & calendar (Part J, migration 0019).
 *
 * GET /api/study → chapter status map per subject, today's real activity
 * (questions attempted + mock answers graded), daily target, 12-week IST
 * activity calendar, mock history, revision history, weekly progress.
 * PATCH /api/study → set chapter status { chapterId, status } or
 *                     daily target { targetQuestions }
 *
 * Activity = real graded submissions only (practice attempts + graded exam
 * answers) — passive page visits are never counted.
 */

const CHAPTER_STATUSES = ['not_started', 'learning', 'completed', 'revision_required', 'strong'] as const

function istDayKey(d: Date): string {
  return new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)
}
function istStartOfDay(d: Date): Date {
  const shifted = new Date(d.getTime() + 5.5 * 3600 * 1000)
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 5.5 * 3600 * 1000)
}

export async function GET() {
  try {
    const user = await requireUser()
    const now = new Date()
    const todayStart = istStartOfDay(now)
    const todayEnd = new Date(todayStart.getTime() + 24 * 3600 * 1000)
    const weekAgo = new Date(todayStart.getTime() - 6 * 24 * 3600 * 1000)
    const calendarStart = new Date(todayStart.getTime() - 83 * 24 * 3600 * 1000) // 12 weeks
    const calendarEnd = todayEnd

    const [progressRows, targetRow, chapters, todayAttempts, todayExamAnswers, weekAttempts, weekExam, calendarPr, calendarEx, mockHistory, revisionWeek] =
      await Promise.all([
        db.chapterProgress.findMany({
          where: { userId: user.id },
          select: { chapterId: true, status: true, updatedAt: true },
        }),
        db.dailyTarget.findUnique({ where: { userId: user.id } }),
        db.chapter.findMany({
          select: {
            id: true, key: true, name: true, unit: true,
            subject: { select: { key: true, name: true } },
            _count: { select: { questions: true } },
          },
          orderBy: { order: 'asc' },
        }),
        db.attempt.count({ where: { userId: user.id, createdAt: { gte: todayStart, lt: todayEnd } } }),
        db.examAttemptAnswer.count({
          where: { examAttempt: { userId: user.id }, isCorrect: { not: null }, updatedAt: { gte: todayStart, lt: todayEnd } },
        }),
        db.attempt.findMany({
          where: { userId: user.id, createdAt: { gte: weekAgo } },
          select: { isCorrect: true, createdAt: true, question: { select: { subject: { select: { key: true } } } } },
        }),
        db.examAttemptAnswer.findMany({
          where: { examAttempt: { userId: user.id }, updatedAt: { gte: weekAgo }, isCorrect: { not: null } },
          select: { isCorrect: true, updatedAt: true, examAttempt: { select: { exam: { select: { subjectKey: true } } } } },
        }),
        db.attempt.findMany({
          where: { userId: user.id, createdAt: { gte: calendarStart, lt: calendarEnd } },
          select: { createdAt: true, isCorrect: true },
        }),
        db.examAttemptAnswer.findMany({
          where: { examAttempt: { userId: user.id }, updatedAt: { gte: calendarStart, lt: calendarEnd }, isCorrect: { not: null } },
          select: { updatedAt: true, isCorrect: true },
        }),
        db.examAttempt.findMany({
          where: { userId: user.id, status: 'submitted' },
          orderBy: { submittedAt: 'desc' },
          take: 10,
          select: {
            id: true, submittedAt: true, totalMarks: true, maxMarks: true, timeSpentSeconds: true,
            exam: { select: { title: true, kind: true } },
          },
        }),
        db.revisionAttempt.findMany({
          where: { userId: user.id, reviewedAt: { gte: weekAgo } },
          select: { wasCorrect: true },
        }),
      ])

    // chapter status map keyed by chapter id
    const statusById = new Map(progressRows.map((p) => [p.chapterId, p]))
    const subjects: Record<string, {
      name: string
      totalChapters: number
      byStatus: Record<string, number>
      chapters: { id: string; key: string; name: string; unit: string | null; status: string; updatedAt: string | null; questionCount: number }[]
    }> = {}
    for (const c of chapters) {
      const sk = c.subject.key
      subjects[sk] = subjects[sk] ?? { name: c.subject.name, totalChapters: 0, byStatus: {}, chapters: [] }
      subjects[sk].totalChapters++
      const status = statusById.get(c.id)?.status ?? 'not_started'
      subjects[sk].byStatus[status] = (subjects[sk].byStatus[status] ?? 0) + 1
      subjects[sk].chapters.push({
        id: c.id, key: c.key, name: c.name, unit: c.unit, status,
        updatedAt: statusById.get(c.id)?.updatedAt?.toISOString() ?? null,
        questionCount: c._count.questions,
      })
    }

    // IST-day calendar of REAL graded activity
    const dayMap = new Map<string, { count: number; correct: number }>()
    for (const a of calendarPr) {
      const k = istDayKey(a.createdAt)
      const e = dayMap.get(k) ?? { count: 0, correct: 0 }
      e.count++
      if (a.isCorrect) e.correct++
      dayMap.set(k, e)
    }
    for (const a of calendarEx) {
      const k = istDayKey(a.updatedAt)
      const e = dayMap.get(k) ?? { count: 0, correct: 0 }
      e.count++
      if (a.isCorrect) e.correct++
      dayMap.set(k, e)
    }
    const calendar: { date: string; count: number; correct: number }[] = []
    for (let i = 0; i < 84; i++) {
      const day = new Date(calendarStart.getTime() + i * 24 * 3600 * 1000)
      const k = istDayKey(day)
      const e = dayMap.get(k)
      calendar.push({ date: k, count: e?.count ?? 0, correct: e?.correct ?? 0 })
    }

    // weekly progress (per IST day, Mon-labelled)
    const weekly: { date: string; count: number; correct: number }[] = []
    for (let i = 0; i < 7; i++) {
      const day = new Date(weekAgo.getTime() + i * 24 * 3600 * 1000)
      const k = istDayKey(day)
      const e = dayMap.get(k)
      weekly.push({ date: k, count: e?.count ?? 0, correct: e?.correct ?? 0 })
    }

    const weekTotal = weekAttempts.length + weekExam.length
    const weekCorrect = weekAttempts.filter((a) => a.isCorrect).length + weekExam.filter((a) => a.isCorrect).length
    const revisionCorrect = revisionWeek.filter((r) => r.wasCorrect).length

    return Response.json({
      subjects,
      today: {
        questions: todayAttempts + todayExamAnswers,
        target: targetRow?.targetQuestions ?? 20,
        targetMet: todayAttempts + todayExamAnswers >= (targetRow?.targetQuestions ?? 20),
      },
      week: {
        total: weekTotal,
        correct: weekCorrect,
        accuracy: weekTotal > 0 ? Math.round((100 * weekCorrect) / weekTotal) : null,
        perDay: weekly,
        revised: revisionWeek.length,
        revisionCorrect,
      },
      calendar,
      mocks: mockHistory.map((m) => ({
        id: m.id,
        title: m.exam.title,
        kind: m.exam.kind,
        submittedAt: m.submittedAt,
        score: m.totalMarks,
        maxMarks: m.maxMarks,
        percentage: m.maxMarks && m.maxMarks > 0 && m.totalMarks !== null ? Math.round((100 * (m.totalMarks ?? 0)) / m.maxMarks) : null,
        timeSpentSeconds: m.timeSpentSeconds,
      })),
    })
  } catch (err) {
    return jsonError(err)
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser()
    await rateLimit(`study-update:${user.id}`, 60, 60_000)
    const body = await req.json()

    // daily target
    if (body.targetQuestions !== undefined) {
      const t = Math.min(Math.max(Number(body.targetQuestions) || 20, 5), 200)
      await db.dailyTarget.upsert({
        where: { userId: user.id },
        update: { targetQuestions: t, updatedAt: new Date() },
        create: { userId: user.id, targetQuestions: t },
      })
      return Response.json({ ok: true, targetQuestions: t })
    }

    // chapter status
    const chapterId = String(body.chapterId ?? '')
    const status = String(body.status ?? '')
    if (!chapterId || !CHAPTER_STATUSES.includes(status as (typeof CHAPTER_STATUSES)[number])) {
      throw new HttpError(400, 'chapterId and a valid status are required')
    }
    const chapter = await db.chapter.findUnique({ where: { id: chapterId }, select: { id: true } })
    if (!chapter) throw new HttpError(404, 'Chapter not found')
    await db.chapterProgress.upsert({
      where: { userId_chapterId: { userId: user.id, chapterId } },
      update: { status, updatedAt: new Date() },
      create: { userId: user.id, chapterId, status },
    })
    return Response.json({ ok: true })
  } catch (err) {
    return jsonError(err)
  }
}
