import { NextRequest } from 'next/server'
import { requireUser, jsonError, HttpError } from '@/lib/auth'
import { computeExamAnalytics, computeHistoryTrends } from '@/lib/analysis'

/**
 * Advanced mock analytics (Part E) — extends the existing CBT result data.
 *
 * GET /api/exam/analytics?attemptId=… → per-mock deep report:
 *   score analysis · time analysis · chapter analysis · question-selection
 *   observations (all computed from the student's OWN attempt data).
 * GET /api/exam/analytics → cross-mock history + trends.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser()
    const attemptId = req.nextUrl.searchParams.get('attemptId')

    if (attemptId) {
      const report = await computeExamAnalytics(user.id, attemptId)
      if (!report) throw new HttpError(404, 'Attempt not found')
      if ('inProgress' in report && report.inProgress) {
        throw new HttpError(409, 'Attempt still in progress — analytics open after submission')
      }
      return Response.json(report)
    }

    const trends = await computeHistoryTrends(user.id)
    return Response.json(trends)
  } catch (err) {
    return jsonError(err)
  }
}
