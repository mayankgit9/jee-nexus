import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, jsonError, HttpError, rateLimit } from '@/lib/auth'
import { cleanDisplayText } from '@/lib/questions'
import { Prisma } from '@prisma/client'

/**
 * Mistake Notebook (Part C, migration 0019).
 *
 * GET  /api/mistakes — the signed-in student's own notebook with filters:
 *      subject, chapter, category, search, dateFrom/dateTo, sort
 *      (recent | most_repeated | least_revised) + pagination.
 *      Breakdowns (subject-wise, chapter-wise) come in the same payload.
 * POST /api/mistakes — manual add { questionId, category?, personalNote? }
 * PATCH /api/mistakes — edit category / personal note
 * DELETE /api/mistakes?id= — remove one entry
 * Every query is scoped to the session user — ownership is enforced
 * server-side; a student can never read or mutate another notebook.
 */

const CATEGORIES = [
  'conceptual', 'calculation', 'formula_forgotten', 'misread', 'time_management', 'incorrect_guess', 'other',
] as const
type Category = (typeof CATEGORIES)[number]

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser()
    const sp = req.nextUrl.searchParams

    // single-entry mode: the retry flow fetches one notebook entry (previous
    // answer shown only AFTER the new attempt is submitted)
    const singleQuestionId = sp.get('questionId')
    if (singleQuestionId) {
      const entry = await db.mistakeEntry.findUnique({
        where: { userId_questionId: { userId: user.id, questionId: singleQuestionId } },
      })
      return Response.json({ entry })
    }

    const subject = sp.get('subject')
    const chapter = sp.get('chapter')
    const category = sp.get('category')
    const search = sp.get('search')?.trim()
    const dateFrom = sp.get('dateFrom')
    const dateTo = sp.get('dateTo')
    const sort = sp.get('sort') ?? 'recent'
    const page = Math.max(1, Math.min(500, Number(sp.get('page') ?? 1)))
    const pageSize = 20

    const where: Prisma.MistakeEntryWhereInput = { userId: user.id }
    const questionFilter: Prisma.QuestionWhereInput = {}
    if (subject && subject !== 'all') questionFilter.subject = { key: subject }
    if (chapter && chapter !== 'all') questionFilter.chapter = { key: chapter }
    if (search) {
      questionFilter.OR = [
        { text: { contains: search, mode: 'insensitive' } },
        { publicId: { contains: search, mode: 'insensitive' } },
      ]
    }
    if (Object.keys(questionFilter).length) where.question = questionFilter
    if (category && category !== 'all') where.category = category
    if (dateFrom || dateTo) {
      const gte = dateFrom ? new Date(dateFrom) : undefined
      const lte = dateTo ? new Date(`${dateTo}T23:59:59.999Z`) : undefined
      if (gte || lte) where.lastMistakeAt = { ...(gte && { gte }), ...(lte && { lte }) }
    }

    const orderBy: Prisma.MistakeEntryOrderByWithRelationInput[] =
      sort === 'most_repeated'
        ? [{ mistakeCount: 'desc' }, { lastMistakeAt: 'desc' }]
        : sort === 'least_revised'
          ? [{ lastMistakeAt: 'asc' }]
          : [{ lastMistakeAt: 'desc' }]

    const [total, entries, all] = await Promise.all([
      db.mistakeEntry.count({ where }),
      db.mistakeEntry.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          question: {
            include: {
              subject: true, chapter: true, options: true,
              images: { where: { hidden: false, kind: 'question' } },
              solution: true,
              revisionSchedules: { where: { userId: user.id }, take: 1 },
            },
          },
        },
      }),
      // full set for the breakdowns (only light columns; notebook sizes are personal)
      db.mistakeEntry.findMany({
        where: { userId: user.id },
        select: {
          category: true, lastMistakeAt: true, correctedAt: true,
          question: { select: { subject: { select: { key: true, name: true } }, chapter: { select: { key: true, name: true } } } },
        },
      }),
    ])

    const subjectWise: Record<string, number> = {}
    const chapterWise: Record<string, { name: string; subject: string; count: number }> = {}
    const categoryWise: Record<string, number> = {}
    let correctedCount = 0
    for (const e of all) {
      const sk = e.question.subject.key
      subjectWise[sk] = (subjectWise[sk] ?? 0) + 1
      const ck = e.question.chapter.key
      chapterWise[ck] = chapterWise[ck] ?? { name: e.question.chapter.name, subject: sk, count: 0 }
      chapterWise[ck].count++
      categoryWise[e.category] = (categoryWise[e.category] ?? 0) + 1
      if (e.correctedAt) correctedCount++
    }

    return Response.json({
      total,
      corrected: correctedCount,
      page, pageSize,
      subjectWise, chapterWise, categoryWise,
      entries: entries.map((e) => {
        const q = e.question
        const opt = [...q.options].sort((a, b) => a.idx - b.idx).map((o) => ({ idx: o.idx, text: cleanDisplayText(o.text) }))
        return {
          id: e.id,
          questionId: q.id,
          publicId: q.publicId,
          category: e.category,
          personalNote: e.personalNote,
          mistakeCount: e.mistakeCount,
          corrected: Boolean(e.correctedAt),
          lastAttemptAt: e.lastMistakeAt,
          lastAnswer: e.lastAnswer,
          nextRevisionAt: q.revisionSchedules[0]?.dueAt ?? null,
          lastReviewedAt: q.revisionSchedules[0]?.lastReviewedAt ?? null,
          subject: q.subject.key,
          chapter: { key: q.chapter.key, name: q.chapter.name },
          type: q.type,
          text: cleanDisplayText(q.text),
          options: opt,
          images: q.images.map((i) => ({ url: i.url, altText: i.altText, caption: i.caption ?? undefined })),
          // correct answer + original solution are included — the notebook is
          // a REVIEW surface (the retry flow uses /api/questions/detail which
          // never leaks them)
          correctOptions: Array.isArray(q.correctOptions) ? (q.correctOptions as number[]) : undefined,
          numericalAnswer: q.numericalAnswer !== null ? Number(q.numericalAnswer) : undefined,
          solution: q.solution ? {
            keyConcept: q.solution.keyConcept ?? undefined,
            formulas: Array.isArray(q.solution.formulas) ? (q.solution.formulas as string[]) : [],
            body: cleanDisplayText(q.solution.body),
            commonMistakes: q.solution.commonMistakes ?? undefined,
            verification: q.solution.verification ?? undefined,
            reviewStatus: q.solution.reviewStatus,
          } : null,
          sourceYear: q.sourceYear ?? undefined,
          sourceShift: q.sourceShift ?? undefined,
          difficulty: q.difficulty,
        }
      }),
    })
  } catch (err) {
    return jsonError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    await rateLimit(`mistakes-add:${user.id}`, 30, 60_000)
    const body = await req.json()
    const questionId = String(body.questionId ?? '')
    const category = CATEGORIES.includes(body.category) ? (body.category as Category) : 'other'
    const personalNote = typeof body.personalNote === 'string' ? body.personalNote.slice(0, 2000) : null
    if (!questionId) throw new HttpError(400, 'questionId is required')

    const question = await db.question.findUnique({ where: { id: questionId }, select: { id: true } })
    if (!question) throw new HttpError(404, 'Question not found')

    const entry = await db.mistakeEntry.upsert({
      where: { userId_questionId: { userId: user.id, questionId } },
      update: { category, ...(personalNote !== null ? { personalNote } : {}), updatedAt: new Date() },
      create: { userId: user.id, questionId, category, personalNote },
    })
    return Response.json({ entry })
  } catch (err) {
    return jsonError(err)
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser()
    const body = await req.json()
    const id = String(body.id ?? '')
    if (!id) throw new HttpError(400, 'id is required')
    const data: Prisma.MistakeEntryUpdateInput = { updatedAt: new Date() }
    if (CATEGORIES.includes(body.category)) data.category = body.category
    if (typeof body.personalNote === 'string') data.personalNote = body.personalNote.slice(0, 2000)
    // ownership: scoped updateMany — no cross-student access
    const entry = await db.mistakeEntry.updateMany({ where: { id, userId: user.id }, data })
    if (entry.count === 0) throw new HttpError(404, 'Entry not found')
    return Response.json({ ok: true })
  } catch (err) {
    return jsonError(err)
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser()
    const id = req.nextUrl.searchParams.get('id')
    if (!id) throw new HttpError(400, 'id is required')
    const r = await db.mistakeEntry.deleteMany({ where: { id, userId: user.id } })
    if (r.count === 0) throw new HttpError(404, 'Entry not found')
    return Response.json({ ok: true })
  } catch (err) {
    return jsonError(err)
  }
}
