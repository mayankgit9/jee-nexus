import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, jsonError, HttpError, rateLimit } from '@/lib/auth'
import { toPublicQuestion } from '@/lib/questions'
import { scheduleBulk } from '@/lib/revision'
import { Prisma } from '@prisma/client'

/**
 * Today's Revision — spaced repetition (Part D, migration 0019).
 *
 * GET /api/revision            → dashboard (due today, overdue, upcoming,
 *                                revised this week, accuracy, subject progress)
 * GET /api/revision?pool=due&count=N
 *                              → due questions as PublicQuestion[] (answers
 *                                never ship — grading happens on submit)
 * POST /api/revision            → start a session from a pool:
 *   { source: 'notebook'|'bookmarks'|'chapter'|'subject'|'custom',
 *     chapterKey?, subjectKey?, questionIds?, count? }
 *                              → bulk-schedules the pool (dedup by design)
 *                                and returns the due questions
 * PATCH /api/revision           → manual reschedule { questionId, days } /
 *                                self-rating { questionId, selfRating } /
 *                                pause { questionId, active: false }
 * DELETE /api/revision?questionId= → remove from the queue
 *
 * All reads/writes are scoped to the session user — the queue is private.
 */

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser()
    const pool = req.nextUrl.searchParams.get('pool')
    const now = new Date()

    if (pool === 'due') {
      const count = Math.min(Math.max(Number(req.nextUrl.searchParams.get('count') ?? 15), 1), 40)
      const due = await db.revisionSchedule.findMany({
        where: { userId: user.id, active: true, dueAt: { lte: now } },
        orderBy: { dueAt: 'asc' },
        take: count,
        include: {
          question: {
            include: {
              subject: true, chapter: true, options: true,
              images: { where: { hidden: false } },
              bookmarks: { where: { userId: user.id }, select: { id: true } },
            },
          },
        },
      })
      return Response.json({
        questions: due.map((d) => toPublicQuestion(d.question)),
        schedule: due.map((d) => ({
          questionId: d.questionId,
          dueAt: d.dueAt,
          intervalDays: d.intervalDays,
          source: d.source,
          lastResult: d.lastResult,
          consecutiveWrong: d.consecutiveWrong,
        })),
      })
    }

    // ---- dashboard ----
    const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000)
    const [dueToday, overdue, upcoming, activeCount, weekAttempts, subjectRows] = await Promise.all([
      db.revisionSchedule.count({ where: { userId: user.id, active: true, dueAt: { lte: endOfIstDay(now) } } }),
      db.revisionSchedule.count({ where: { userId: user.id, active: true, dueAt: { lt: startOfIstDay(now) } } }),
      db.revisionSchedule.findMany({
        where: { userId: user.id, active: true, dueAt: { gt: endOfIstDay(now) } },
        orderBy: { dueAt: 'asc' },
        take: 200,
        select: { dueAt: true, question: { select: { subject: { select: { key: true } } } } },
      }),
      db.revisionSchedule.count({ where: { userId: user.id, active: true } }),
      db.revisionAttempt.findMany({
        where: { userId: user.id, reviewedAt: { gte: weekAgo } },
        select: { wasCorrect: true, question: { select: { subject: { select: { key: true } } } } },
      }),
      db.revisionSchedule.findMany({
        where: { userId: user.id, active: true },
        select: {
          dueAt: true, source: true,
          question: { select: { subject: { select: { key: true, name: true } }, chapter: { select: { key: true, name: true } } } },
        },
        take: 500,
      }),
    ])

    const subjectProgress: Record<string, { name: string; due: number; scheduled: number; accuracy: number; revised: number }> = {}
    for (const s of ['physics', 'chemistry', 'mathematics']) subjectProgress[s] = { name: s, due: 0, scheduled: 0, accuracy: 0, revised: 0 }
    for (const r of subjectRows) {
      const sk = r.question.subject.key
      if (!subjectProgress[sk]) continue
      subjectProgress[sk].scheduled++
      if (r.dueAt <= now) subjectProgress[sk].due++
    }
    const accuracyBySubject: Record<string, { c: number; t: number }> = {}
    let correct = 0
    let gradedTotal = 0
    for (const a of weekAttempts) {
      if (a.wasCorrect !== null && a.wasCorrect !== undefined) {
        gradedTotal++
        if (a.wasCorrect) correct++
        const sk = a.question.subject.key
        accuracyBySubject[sk] = accuracyBySubject[sk] ?? { c: 0, t: 0 }
        accuracyBySubject[sk].t++
        if (a.wasCorrect) accuracyBySubject[sk].c++
        subjectProgress[sk].revised++
      }
    }
    for (const sk of Object.keys(subjectProgress)) {
      const acc = accuracyBySubject[sk]
      subjectProgress[sk].accuracy = acc && acc.t > 0 ? Math.round((100 * acc.c) / acc.t) : 0
    }

    const upcomingBuckets: { day: string; count: number }[] = []
    for (let i = 1; i <= 7; i++) {
      const dayStart = new Date(endOfIstDay(now).getTime() + (i - 1) * 24 * 3600 * 1000)
      const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000)
      upcomingBuckets.push({
        day: istKey(dayStart),
        count: upcoming.filter((u) => u.dueAt > dayStart && u.dueAt <= dayEnd).length,
      })
    }

    return Response.json({
      dueToday,
      overdue,
      scheduled: activeCount,
      revisedThisWeek: weekAttempts.length,
      revisionAccuracy: gradedTotal > 0 ? Math.round((100 * correct) / gradedTotal) : null,
      subjectProgress,
      upcoming: upcomingBuckets,
    })
  } catch (err) {
    return jsonError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    await rateLimit(`revision-start:${user.id}`, 20, 60_000)
    const body = await req.json()
    const source = String(body.source ?? 'due')
    const count = Math.min(Math.max(Number(body.count ?? 15), 1), 40)
    const now = new Date()

    if (source === 'due') {
      const due = await db.revisionSchedule.findMany({
        where: { userId: user.id, active: true, dueAt: { lte: now } },
        orderBy: { dueAt: 'asc' },
        take: count,
        include: {
          question: {
            include: {
              subject: true, chapter: true, options: true,
              images: { where: { hidden: false } },
              bookmarks: { where: { userId: user.id }, select: { id: true } },
            },
          },
        },
      })
      return Response.json({ questions: due.map((d) => toPublicQuestion(d.question)) })
    }

    // Build the pool for the requested source, then schedule it (dedup via
    // unique(userId, questionId) — existing rows are never duplicated).
    let ids: string[] = []
    if (source === 'notebook') {
      const rows = await db.mistakeEntry.findMany({
        where: { userId: user.id },
        orderBy: { lastMistakeAt: 'desc' },
        take: 300,
        select: { questionId: true },
      })
      ids = rows.map((r) => r.questionId)
    } else if (source === 'bookmarks') {
      const rows = await db.bookmark.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 300,
        select: { questionId: true },
      })
      ids = rows.map((r) => r.questionId)
    } else if (source === 'chapter' || source === 'subject') {
      const chapterKey = typeof body.chapterKey === 'string' ? body.chapterKey : null
      const subjectKey = typeof body.subjectKey === 'string' ? body.subjectKey : null
      const where: Prisma.QuestionWhereInput = { verificationStatus: { not: 'rejected' } }
      if (chapterKey) where.chapter = { key: chapterKey }
      else if (subjectKey) where.subject = { key: subjectKey }
      else throw new HttpError(400, 'chapterKey or subjectKey is required')
      const rows = await db.question.findMany({
        where,
        select: { id: true },
        take: 500,
        orderBy: { id: 'asc' },
      })
      ids = rows.map((r) => r.id)
    } else if (source === 'custom') {
      const raw = Array.isArray(body.questionIds) ? body.questionIds : []
      ids = raw.map(String).slice(0, 200)
      if (ids.length === 0) throw new HttpError(400, 'questionIds is required for custom collections')
      const valid = await db.question.findMany({ where: { id: { in: ids } }, select: { id: true } })
      ids = valid.map((v) => v.id)
    } else {
      throw new HttpError(400, 'Unknown source')
    }

    if (ids.length === 0) return Response.json({ questions: [], scheduled: 0, message: 'Nothing to revise yet' })

    await scheduleBulk(user.id, ids, source)

    // Serve the newest-scheduled first for a fresh session (due now).
    const due = await db.revisionSchedule.findMany({
      where: { userId: user.id, questionId: { in: ids }, active: true, dueAt: { lte: new Date() } },
      orderBy: [{ lastReviewedAt: 'asc' }, { dueAt: 'asc' }],
      take: count,
      include: {
        question: {
          include: {
            subject: true, chapter: true, options: true,
            images: { where: { hidden: false } },
            bookmarks: { where: { userId: user.id }, select: { id: true } },
          },
        },
      },
    })
    return Response.json({
      questions: due.map((d) => toPublicQuestion(d.question)),
      scheduled: ids.length,
    })
  } catch (err) {
    return jsonError(err)
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser()
    const body = await req.json()
    const questionId = String(body.questionId ?? '')
    if (!questionId) throw new HttpError(400, 'questionId is required')
    const data: Prisma.RevisionScheduleUpdateInput = { updatedAt: new Date() }
    if (body.days !== undefined) {
      const days = Math.min(Math.max(Number(body.days), 0), 180)
      data.dueAt = new Date(Date.now() + days * 24 * 3600 * 1000)
    }
    if (['easy', 'medium', 'difficult'].includes(body.selfRating)) data.selfRating = body.selfRating
    if (typeof body.active === 'boolean') data.active = body.active
    const r = await db.revisionSchedule.updateMany({ where: { questionId, userId: user.id }, data })
    if (r.count === 0) throw new HttpError(404, 'Not in your revision queue')
    return Response.json({ ok: true })
  } catch (err) {
    return jsonError(err)
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser()
    const questionId = req.nextUrl.searchParams.get('questionId')
    if (!questionId) throw new HttpError(400, 'questionId is required')
    const r = await db.revisionSchedule.deleteMany({ where: { questionId, userId: user.id } })
    if (r.count === 0) throw new HttpError(404, 'Not in your revision queue')
    return Response.json({ ok: true })
  } catch (err) {
    return jsonError(err)
  }
}

// IST day boundaries (the audience's "today")
function istShift(d: Date, days: number): Date {
  return new Date(d.getTime() + (5.5 * 3600 * 1000) + days * 24 * 3600 * 1000)
}
function startOfIstDay(d: Date): Date {
  const shifted = istShift(d, 0)
  const y = shifted.getUTCFullYear(), m = shifted.getUTCMonth(), day = shifted.getUTCDate()
  return new Date(Date.UTC(y, m, day) - 5.5 * 3600 * 1000)
}
function endOfIstDay(d: Date): Date {
  return new Date(startOfIstDay(d).getTime() + 24 * 3600 * 1000)
}
function istKey(d: Date): string {
  return new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)
}
