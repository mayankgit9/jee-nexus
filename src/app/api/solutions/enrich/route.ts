import { NextRequest } from 'next/server'
import { db, dbClient } from '@/lib/db'
import { requireUser, requireAdmin, jsonError, rateLimit, clientIp } from '@/lib/auth'
import { enrichSolution, isThinSolution } from '@/lib/enrich'
import { toPublicSolution } from '@/lib/questions'
import type { Prisma } from '@prisma/client'

/** Minimal shape toPublicSolution needs besides the solution row. */
function withEmptyImages<T>(sol: T): Prisma.SolutionGetPayload<{ include: { question: { include: { images: true } } } }> {
  return { ...sol, question: { images: [] } } as unknown as Prisma.SolutionGetPayload<{ include: { question: { include: { images: true } } } }>
}

/**
 * POST /api/solutions/enrich { questionId, force? }
 * Regenerates a deeply-detailed solution for ONE question using web search
 * + the LLM. Two access modes:
 *  - admin: bulk-friendly, modest rate limit
 *  - any logged-in user: "improve this solution" on demand — strict limit
 * Anonymous callers get 401.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    const client = dbClient()
    const body = (await req.json().catch(() => ({}))) as { questionId?: string; force?: boolean }
    const questionId = String(body.questionId ?? '')
    if (!questionId) return Response.json({ error: 'questionId is required' }, { status: 400 })

    if (user.role === 'admin') {
      await rateLimit(`enrich-admin:${user.id}`, 300, 60 * 60 * 1000, client)
    } else {
      await rateLimit(`enrich-user:${user.id}`, 12, 60 * 60 * 1000, client)
      await rateLimit(`enrich-ip:${clientIp(req)}`, 30, 60 * 60 * 1000, client)
    }

    const question = await db.question.findUnique({
      where: { id: questionId },
      include: { solution: true },
    })
    if (!question) return Response.json({ error: 'Question not found' }, { status: 404 })

    const sol = question.solution
    if (sol && !isThinSolution(sol) && !body.force) {
      return Response.json({ ok: true, skipped: true, solution: toPublicSolution(withEmptyImages(sol)) })
    }

    const result = await enrichSolution(questionId)
    if (!result.ok) {
      return Response.json({ error: result.error ?? 'Enrichment failed' }, { status: 502 })
    }

    const fresh = await db.solution.findUnique({ where: { questionId } })
    return Response.json({
      ok: true,
      source: result.source,
      skipped: result.source === 'skipped',
      solution: fresh ? toPublicSolution(withEmptyImages(fresh)) : null,
    })
  } catch (err) {
    return jsonError(err)
  }
}

/** GET /api/solutions/enrich — stats for the admin dashboard.
 *  SQL pre-filters the rich-candidate rows (keyConcept + commonMistakes +
 *  body length), then only their ids+formulas are refined in memory —
 *  avoids loading all ~12k solution bodies on every admin page load. */
export async function GET() {
  try {
    await requireAdmin()
    const total = await db.solution.count()
    const candidates = (await db.$queryRawUnsafe(
      `select id, formulas from solutions
        where key_concept is not null
          and common_mistakes is not null
          and length(body) >= ?1`,
      400
    )) as { id: string; formulas: unknown }[]
    // SQLite stores Json as TEXT — parse defensively
    const detailed = candidates.filter((c) => {
      const f = typeof c.formulas === 'string' ? JSON.parse(c.formulas) : c.formulas
      return Array.isArray(f) && f.length > 0
    }).length
    return Response.json({ total, thin: total - detailed, detailed })
  } catch (err) {
    return jsonError(err)
  }
}
