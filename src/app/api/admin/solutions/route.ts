import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, jsonError, HttpError, rateLimit } from '@/lib/auth'
import { enrichSolution, isThinSolution } from '@/lib/enrich'
import type { Prisma } from '@prisma/client'

/**
 * Solution verification workflow — admin interface (Part A, migration 0019).
 *
 * GET /api/admin/solutions?filter=…&page=…
 *   filter: ai_generated | independently_checked | expert_verified |
 *           reported_for_correction | thin | reported
 *   → queue rows with question context + workflow stats + generation
 *     telemetry (from solution_gen_log: ok/failed, tokens, cost) + the
 *     PRIORITIZED generation queue (usage · wrong attempts · reports).
 *
 * GET ?solutionId=… → one solution + its full revision history.
 *
 * PATCH /api/admin/solutions — edit / approve / reject / publish:
 *   { solutionId, action: 'edit'|'approve_independent'|'approve_expert'|'reject'|'mark_reviewed',
 *     fields?: { keyConcept?, formulas?, body?, commonMistakes?, alternativeMethod?, verification?, sourceReferences? } }
 *   - 'edit' snapshots the previous version into solution_revisions first
 *   - approval sets review_status + reviewed_by + reviewed_at + verifiedAt;
 *     AI-generated content is NEVER auto-verified (this route is the only path)
 *
 * POST /api/admin/solutions/generate — admin-controlled batch enrichment:
 *   { count?: 1..10, priority?: 'usage'|'oldest' }
 *   Runs synchronously, bounded (never thousands), prioritized by student
 *   usage + incorrect attempts + report frequency.
 */

const STATUSES = ['ai_generated', 'independently_checked', 'expert_verified', 'reported_for_correction'] as const
type Status = (typeof STATUSES)[number]

export async function GET(req: NextRequest) {
  try {
    await requireAdmin()
    const sp = req.nextUrl.searchParams
    const filter = sp.get('filter') ?? 'ai_generated'
    const solutionId = sp.get('solutionId')
    const page = Math.max(1, Math.min(500, Number(sp.get('page') ?? 1)))
    const pageSize = 20

    if (solutionId) {
      const sol = await db.solution.findUnique({
        where: { id: solutionId },
        include: {
          question: { select: { publicId: true, text: true, sourceYear: true, sourceExam: true, type: true, correctOptions: true, numericalAnswer: true } },
          revisions: { orderBy: { createdAt: 'desc' }, take: 30 },
        },
      })
      if (!sol) throw new HttpError(404, 'Solution not found')
      return Response.json({ solution: sol })
    }

    const thinFilter = filter === 'thin'

    // Prisma string filters can't express length(); the thin queue uses the
    // same SQL predicate the priority queue uses (length < 400 or no concept).
    const [total, rows, statusCounts, genStats, topPriority] = await Promise.all([
      thinFilter
        ? db.$queryRaw<{ count: number }[]>`select count(*)::int as count from solutions where (length(body) < 400 or key_concept is null)`.then((r) => r[0]?.count ?? 0)
        : db.solution.count({ where: { reviewStatus: filter === 'reported' ? 'reported_for_correction' : filter } }),
      thinFilter
        ? db.$queryRaw<{ id: string }[]>`
            select s.id from solutions s
            where (length(s.body) < 400 or s.key_concept is null)
            order by s.updated_at desc
            limit ${pageSize}::int offset ${(page - 1) * pageSize}::int`.then(async (ids) =>
            ids.length === 0
              ? []
              : db.solution.findMany({
                  where: { id: { in: ids.map((i) => i.id) } },
                  include: { question: { select: { publicId: true, sourceYear: true, subject: { select: { key: true } }, chapter: { select: { name: true } } } } },
                })
          )
        : db.solution.findMany({
            where: { reviewStatus: filter === 'reported' ? 'reported_for_correction' : filter },
            orderBy: { updatedAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
            include: { question: { select: { publicId: true, sourceYear: true, subject: { select: { key: true } }, chapter: { select: { name: true } } } } },
          }),
      db.solution.groupBy({ by: ['reviewStatus'], _count: { _all: true } }),
      db.solutionGenLog.aggregate({
        _count: { _all: true },
        _sum: { promptTokens: true, completionTokens: true, costUsd: true },
      }),
      // prioritized queue: most student usage, most wrong attempts, most reports
      db.$queryRaw<
        { question_id: string; attempts: number; wrong: number; reports: number; public_id: string }[]
      >`
        select q.id as question_id, q.public_id,
          (select count(*)::int from attempts a where a.question_id = q.id) as attempts,
          (select count(*)::int from attempts a where a.question_id = q.id and a.is_correct = false) as wrong,
          (select count(*)::int from reports r where r.question_id = q.id) as reports
        from questions q
        join solutions s on s.question_id = q.id
        where (length(s.body) < 400 or s.key_concept is null)
        order by reports desc, wrong desc, attempts desc
        limit 25`,
    ])

    const genFailed = await db.solutionGenLog.count({ where: { status: 'failed' } })

    return Response.json({
      total,
      page, pageSize,
      statusCounts: Object.fromEntries(statusCounts.map((c) => [c.reviewStatus, c._count._all])),
      generation: {
        runs: genStats._count._all,
        failed: genFailed,
        promptTokens: genStats._sum.promptTokens ?? 0,
        completionTokens: genStats._sum.completionTokens ?? 0,
        costUsd: Math.round((genStats._sum.costUsd ?? 0) * 10000) / 10000,
      },
      priorityQueue: topPriority,
      rows: rows.map((s) => ({
        id: s.id,
        questionId: s.questionId,
        publicId: s.question.publicId,
        year: s.question.sourceYear,
        subject: s.question.subject.key,
        chapter: s.question.chapter.name,
        reviewStatus: s.reviewStatus,
        reviewedBy: s.reviewedBy,
        reviewedAt: s.reviewedAt,
        isAiGenerated: s.isAiGenerated,
        version: s.version,
        thin: isThinSolution(s),
        keyConcept: s.keyConcept,
        bodyLength: s.body.length,
        bodyPreview: s.body.slice(0, 300),
        formulas: Array.isArray(s.formulas) ? (s.formulas as string[]) : [],
        commonMistakes: s.commonMistakes,
        verification: s.verification,
        updatedAt: s.updatedAt,
      })),
    })
  } catch (err) {
    return jsonError(err)
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    const body = await req.json()
    const solutionId = String(body.solutionId ?? '')
    const action = String(body.action ?? '')
    if (!solutionId || !['edit', 'approve_independent', 'approve_expert', 'reject', 'mark_reviewed'].includes(action)) {
      throw new HttpError(400, 'solutionId and a valid action are required')
    }

    const sol = await db.solution.findUnique({ where: { id: solutionId } })
    if (!sol) throw new HttpError(404, 'Solution not found')

    if (action === 'edit') {
      const f = (body.fields ?? {}) as Record<string, unknown>
      // snapshot the previous version (revision history)
      await db.solutionRevision.create({
        data: {
          solutionId: sol.id,
          questionId: sol.questionId,
          version: sol.version,
          snapshot: {
            keyConcept: sol.keyConcept,
            formulas: sol.formulas,
            body: sol.body,
            commonMistakes: sol.commonMistakes,
            alternativeMethod: sol.alternativeMethod,
            verification: sol.verification,
            sourceReferences: sol.sourceReferences,
            reviewStatus: sol.reviewStatus,
          } as unknown as Prisma.InputJsonValue,
          editedBy: admin.username,
          note: 'admin edit',
        },
      })
      const data: Prisma.SolutionUpdateInput = { version: { increment: 1 } }
      if (typeof f.keyConcept === 'string') data.keyConcept = f.keyConcept.slice(0, 900)
      if (Array.isArray(f.formulas)) data.formulas = f.formulas.filter((x) => typeof x === 'string').slice(0, 8)
      if (typeof f.body === 'string') data.body = f.body.slice(0, 12000)
      if (typeof f.commonMistakes === 'string') data.commonMistakes = f.commonMistakes.slice(0, 900)
      if (typeof f.alternativeMethod === 'string') data.alternativeMethod = f.alternativeMethod.slice(0, 4000)
      if (typeof f.verification === 'string') data.verification = f.verification.slice(0, 900)
      if (Array.isArray(f.sourceReferences)) data.sourceReferences = f.sourceReferences.filter((x) => typeof x === 'string').slice(0, 6)
      // a manual admin edit is at minimum human-reviewed content
      data.reviewStatus = 'independently_checked'
      data.reviewedBy = admin.username
      data.reviewedAt = new Date()
      data.reviewNote = 'edited by admin'
      const updated = await db.solution.update({ where: { id: solutionId }, data })
      return Response.json({ solution: { id: updated.id, version: updated.version, reviewStatus: updated.reviewStatus } })
    }

    const now = new Date()
    const data: Prisma.SolutionUpdateInput = { reviewedBy: admin.username, reviewedAt: now }
    if (action === 'approve_independent') {
      data.reviewStatus = 'independently_checked'
      data.reviewNote = 'independently checked by admin'
    } else if (action === 'approve_expert') {
      data.reviewStatus = 'expert_verified'
      data.verifiedAt = now
      data.isAiGenerated = false
      data.reviewNote = 'expert verified by admin'
    } else if (action === 'reject') {
      data.reviewStatus = 'reported_for_correction'
      data.reviewNote = String(body.note ?? 'rejected by admin').slice(0, 500)
    } else {
      data.reviewStatus = 'ai_generated'
      data.reviewNote = 'reset to ai_generated'
    }
    const updated = await db.solution.update({ where: { id: solutionId }, data })
    return Response.json({ solution: { id: updated.id, reviewStatus: updated.reviewStatus } })
  } catch (err) {
    return jsonError(err)
  }
}

/** Admin-controlled, BOUNDED batch generation (never an uncontrolled mass run). */
export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    await rateLimit(`admin-gen:${admin.id}`, 6, 60_000)
    const body = await req.json().catch(() => ({}))
    const count = Math.min(Math.max(Number(body.count ?? 3), 1), 10)
    const priority = body.priority === 'oldest' ? 'oldest' : 'usage'

    // Priority queue: student usage + wrong attempts + reports (from real data)
    const candidates =
      priority === 'oldest'
        ? await db.$queryRaw<{ question_id: string }[]>`
            select q.id as question_id from questions q
            join solutions s on s.question_id = q.id
            where (length(s.body) < 400 or s.key_concept is null)
            order by q.source_year asc limit ${count}::int`
        : await db.$queryRaw<{ question_id: string }[]>`
            select q.id as question_id from questions q
            join solutions s on s.question_id = q.id
            where (length(s.body) < 400 or s.key_concept is null)
            order by
              (select count(*) from reports r where r.question_id = q.id) desc,
              (select count(*) from attempts a where a.question_id = q.id and a.is_correct = false) desc,
              (select count(*) from attempts a where a.question_id = q.id) desc
            limit ${count}::int`

    const results: { questionId: string; ok: boolean; error?: string }[] = []
    for (const c of candidates) {
      const r = await enrichSolution(c.question_id, { skipWeb: true })
      results.push({ questionId: c.question_id, ok: r.ok, ...(r.error ? { error: r.error } : {}) })
    }
    return Response.json({ requested: count, results })
  } catch (err) {
    return jsonError(err)
  }
}
