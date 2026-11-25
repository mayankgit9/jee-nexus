import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, jsonError, HttpError } from '@/lib/auth'
import type { VerificationStatus } from '@prisma/client'

const STATUSES = ['imported', 'needs_review', 'verified', 'rejected'] as const

/**
 * POST /api/admin/questions/bulk-status — flip verificationStatus for many
 * questions in ONE statement (admin only).
 *
 * Body: { from: 'imported', to: 'needs_review', prefix?: 'PYQ-' }
 * `prefix` (optional) restricts the flip to publicIds with that prefix —
 * the PYQ import uses it so seed/verified questions are never touched.
 *
 * Replaces the import script's per-question PATCH loop: 11,886 PATCHes
 * (~60 min of round-trips) → one updateMany (~1s). Guards: from ≠ to,
 * both must be valid statuses, and the response reports the exact count
 * so callers can verify nothing unexpected moved.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin()
    const body = (await req.json()) as { from?: string; to?: string; prefix?: string }
    const { from, to, prefix } = body

    if (!from || !STATUSES.includes(from as VerificationStatus)) {
      throw new HttpError(400, `invalid "from" (expected ${STATUSES.join('|')})`)
    }
    if (!to || !STATUSES.includes(to as VerificationStatus)) {
      throw new HttpError(400, `invalid "to" (expected ${STATUSES.join('|')})`)
    }
    if (from === to) throw new HttpError(400, '"from" and "to" must differ')
    if (prefix !== undefined && (typeof prefix !== 'string' || prefix.length < 2)) {
      throw new HttpError(400, 'prefix must be a string of at least 2 characters')
    }

    const result = await db.question.updateMany({
      where: {
        verificationStatus: from as VerificationStatus,
        ...(prefix ? { publicId: { startsWith: prefix } } : {}),
      },
      data: { verificationStatus: to as VerificationStatus },
    })

    return Response.json({ ok: true, moved: result.count, from, to, prefix: prefix ?? null })
  } catch (err) {
    return jsonError(err)
  }
}
