import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, jsonError, HttpError } from '@/lib/auth'

/**
 * GET /api/admin/reports — report queue with question context.
 * PATCH /api/admin/reports — resolve/dismiss a report (optionally flips question to needs_review).
 */
export async function GET() {
  try {
    await requireAdmin()
    const reports = await db.report.findMany({
      where: { status: 'open' },
      include: {
        question: {
          select: { publicId: true, text: true, verificationStatus: true, subject: { select: { key: true } } },
        },
        user: { select: { email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    const counts = await db.report.groupBy({ by: ['status'], _count: { _all: true } })
    return Response.json({
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      reports: reports.map((r) => ({
        id: r.id,
        reason: r.reason,
        details: r.details,
        createdAt: r.createdAt,
        reporter: r.user.email,
        question: {
          publicId: r.question.publicId,
          text: r.question.text.slice(0, 200),
          subject: r.question.subject.key,
          verificationStatus: r.question.verificationStatus,
        },
      })),
    })
  } catch (err) {
    return jsonError(err)
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin()
    const body = await req.json()
    const id = String(body.id ?? '')
    const action = String(body.action ?? '')
    if (!id) throw new HttpError(400, 'id is required')
    if (!['resolved', 'dismissed'].includes(action)) throw new HttpError(400, 'action must be resolved|dismissed')

    const report = await db.report.findUnique({ where: { id }, include: { question: true } })
    if (!report) throw new HttpError(404, 'Report not found')
    if (report.status !== 'open') throw new HttpError(409, 'Report already handled')

    await db.report.update({
      where: { id },
      data: {
        status: action,
        resolvedAt: new Date(),
        resolution: String(body.resolution ?? '').slice(0, 1000) || null,
      },
    })

    // A resolved report flags the question for review
    if (action === 'resolved' && report.question.verificationStatus === 'verified') {
      await db.question.update({ where: { id: report.questionId }, data: { verificationStatus: 'needs_review' } })
    }
    return Response.json({ ok: true })
  } catch (err) {
    return jsonError(err)
  }
}
