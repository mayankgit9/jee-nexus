import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, jsonError, HttpError, rateLimit } from '@/lib/auth'
import { deriveAndSaveHints } from '@/lib/hints'

/**
 * Progressive hints (Part K, migration 0019).
 * GET /api/hints?questionId=…&level=1|2|3
 *
 * Hints are derived from the question's own structured solution (concept →
 * approach → key formula) and never reveal the final answer. The client
 * reveals them one level at a time; usage is recorded with the practice
 * submission (attempts.hints_used) so analytics can show hint dependence.
 * Questions whose solution is still thin honestly return no hints.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser()
    if (user) await rateLimit(`hints:${user.id}`, 120, 60_000)
    else await rateLimit(`hints-ip:${req.headers.get('x-forwarded-for') ?? 'local'}`, 60, 60_000)

    const questionId = req.nextUrl.searchParams.get('questionId')
    if (!questionId) throw new HttpError(400, 'questionId is required')
    const level = Math.min(Math.max(Number(req.nextUrl.searchParams.get('level') ?? 3), 1), 3)

    let hints = await db.questionHint.findUnique({ where: { questionId } })

    // Lazy derive once (idempotent) if a rich solution exists but hints don't.
    if (!hints) {
      const derived = await deriveAndSaveHints(questionId)
      if (derived) hints = await db.questionHint.findUnique({ where: { questionId } })
    }

    if (!hints) {
      return Response.json({
        hints: { hint1: null, hint2: null, hint3: null },
        available: false,
        message: 'Hints become available once this solution is enriched',
      })
    }

    return Response.json({
      available: true,
      hints: {
        hint1: level >= 1 ? hints.hint1 : null,
        hint2: level >= 2 ? hints.hint2 : null,
        hint3: level >= 3 ? hints.hint3 : null,
      },
    })
  } catch (err) {
    return jsonError(err)
  }
}
