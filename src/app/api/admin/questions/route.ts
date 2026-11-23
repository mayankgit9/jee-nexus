import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, jsonError, HttpError } from '@/lib/auth'
import type { Prisma } from '@prisma/client'

/**
 * GET /api/admin/questions — list with filters + pagination (admin only).
 * PATCH /api/admin/questions — edit question fields / verify / reject.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin()
    const sp = req.nextUrl.searchParams
    const page = Math.max(1, Number(sp.get('page') ?? 1))
    const status = sp.get('status') ?? undefined
    const search = sp.get('search') ?? undefined
    const subject = sp.get('subject') ?? undefined
    const pageSize = 20

    const where: Prisma.QuestionWhereInput = {}
    if (status && ['imported', 'needs_review', 'verified', 'rejected'].includes(status)) {
      where.verificationStatus = status
    }
    if (subject && ['physics', 'chemistry', 'mathematics'].includes(subject)) {
      where.subject = { key: subject }
    }
    if (search) {
      where.OR = [
        { text: { contains: search } },
        { publicId: { contains: search } },
      ]
    }

    const [total, questions] = await Promise.all([
      db.question.count({ where }),
      db.question.findMany({
        where,
        include: {
          subject: { select: { key: true } },
          chapter: { select: { name: true } },
          options: { orderBy: { idx: 'asc' } },
          solution: { select: { id: true, isAiGenerated: true } },
          _count: { select: { reports: { where: { status: 'open' } }, images: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])

    return Response.json({
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      questions: questions.map((q) => ({
        id: q.id,
        publicId: q.publicId,
        subject: q.subject.key,
        chapter: q.chapter.name,
        type: q.type,
        text: q.text.slice(0, 300),
        fullText: q.text,
        options: q.options.map((o) => ({ idx: o.idx, text: o.text, isCorrect: o.isCorrect })),
        correctOptions: q.correctOptions ? JSON.parse(q.correctOptions) : null,
        numericalAnswer: q.numericalAnswer,
        numericalTolerance: q.numericalTolerance,
        difficulty: q.difficulty,
        sourceYear: q.sourceYear,
        sourceShift: q.sourceShift,
        sourceReference: q.sourceReference,
        verificationStatus: q.verificationStatus,
        hasSolution: !!q.solution,
        solutionIsAi: q.solution?.isAiGenerated ?? null,
        openReports: q._count.reports,
        imageCount: q._count.images,
        createdAt: q.createdAt,
      })),
    })
  } catch (err) {
    return jsonError(err)
  }
}

const EDITABLE_STATUSES = ['imported', 'needs_review', 'verified', 'rejected']

export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin()
    const body = await req.json()
    const id = String(body.id ?? '')
    if (!id) throw new HttpError(400, 'id is required')

    const question = await db.question.findUnique({ where: { id } })
    if (!question) throw new HttpError(404, 'Question not found')

    const data: Prisma.QuestionUpdateInput = {}

    if (body.verificationStatus !== undefined) {
      const s = String(body.verificationStatus)
      if (!EDITABLE_STATUSES.includes(s)) throw new HttpError(400, 'Invalid verificationStatus')
      data.verificationStatus = s
      // Verifying a solution stamps the verification time and clears the AI flag requirement
      if (s === 'verified') {
        await db.solution.updateMany({ where: { questionId: id }, data: { verifiedAt: new Date() } })
      }
    }
    if (body.text !== undefined) {
      const t = String(body.text)
      if (t.trim().length < 10) throw new HttpError(400, 'Question text too short')
      data.text = t
    }
    if (body.difficulty !== undefined) {
      if (!['easy', 'medium', 'hard'].includes(body.difficulty)) throw new HttpError(400, 'Invalid difficulty')
      data.difficulty = body.difficulty
    }
    if (body.sourceYear !== undefined) data.sourceYear = body.sourceYear ? Number(body.sourceYear) : null
    if (body.sourceShift !== undefined) data.sourceShift = body.sourceShift || null
    if (body.sourceReference !== undefined) data.sourceReference = body.sourceReference || null

    // Options replacement (full set, with isCorrect flags)
    if (Array.isArray(body.options)) {
      const options = body.options as { text: string; isCorrect?: boolean }[]
      if (options.length < 2) throw new HttpError(400, 'Need at least 2 options')
      await db.questionOption.deleteMany({ where: { questionId: id } })
      data.options = {
        create: options.map((o, idx) => ({ idx, text: String(o.text), isCorrect: !!o.isCorrect })),
      }
    }
    if (body.correctOptions !== undefined && Array.isArray(body.correctOptions)) {
      const opts = await db.questionOption.findMany({ where: { questionId: id } })
      for (const c of body.correctOptions) {
        if (!opts.some((o) => o.idx === c)) throw new HttpError(400, `correctOption ${c} out of range`)
      }
      const correct = [...new Set(body.correctOptions as number[])]
      if (question.type === 'mcq_single' && correct.length !== 1) throw new HttpError(400, 'mcq_single needs exactly one correct option')
      if (question.type === 'mcq_multi' && correct.length < 2) throw new HttpError(400, 'mcq_multi needs at least two correct options')
      data.correctOptions = JSON.stringify(correct)
      // sync option flags
      await db.questionOption.updateMany({ where: { questionId: id }, data: { isCorrect: false } })
      for (const c of correct) {
        await db.questionOption.updateMany({ where: { questionId: id, idx: c }, data: { isCorrect: true } })
      }
    }
    if (body.numericalAnswer !== undefined) {
      const v = String(body.numericalAnswer)
      if (v !== '' && isNaN(Number(v))) throw new HttpError(400, 'numericalAnswer must be numeric')
      data.numericalAnswer = v === '' ? null : v
    }

    // Solution upsert
    if (body.solution && typeof body.solution === 'object') {
      const s = body.solution as {
        keyConcept?: string; formulas?: string[]; body?: string; commonMistakes?: string
        alternativeMethod?: string; verification?: string; sourceReferences?: string[]
      }
      if (!s.body || s.body.trim().length < 20) throw new HttpError(400, 'Solution body too short')
      const payload = {
        keyConcept: s.keyConcept ?? null,
        formulas: JSON.stringify(s.formulas ?? []),
        body: s.body,
        commonMistakes: s.commonMistakes ?? null,
        alternativeMethod: s.alternativeMethod ?? null,
        verification: s.verification ?? null,
        sourceReferences: JSON.stringify(s.sourceReferences ?? []),
      }
      const existing = await db.solution.findUnique({ where: { questionId: id } })
      if (existing) {
        await db.solution.update({ where: { id: existing.id }, data: { ...payload, version: { increment: 1 } } })
      } else {
        await db.solution.create({ data: { questionId: id, ...payload, isAiGenerated: true } })
      }
    }

    await db.question.update({ where: { id }, data })
    return Response.json({ ok: true })
  } catch (err) {
    return jsonError(err)
  }
}
