import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, jsonError, HttpError, rateLimit } from '@/lib/auth'

const REASONS = ['incorrect_answer', 'incorrect_solution', 'missing_diagram', 'typo', 'copyright', 'other']

/** Report a question (incorrect answer/solution, missing diagram, etc.) */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    const ip = req.headers.get('x-forwarded-for') ?? 'local'
    rateLimit(`report:${user.id}:${ip}`, 10, 60_000)

    const body = await req.json()
    const questionId = String(body.questionId ?? '')
    const reason = String(body.reason ?? '')
    const details = String(body.details ?? '').slice(0, 2000)

    if (!questionId) throw new HttpError(400, 'questionId is required')
    if (!REASONS.includes(reason)) throw new HttpError(400, 'Invalid report reason')

    const question = await db.question.findUnique({ where: { id: questionId } })
    if (!question) throw new HttpError(404, 'Question not found')

    // avoid duplicate open reports by the same user for the same question
    const dup = await db.report.findFirst({
      where: { userId: user.id, questionId, status: 'open' },
    })
    if (dup) return Response.json({ ok: true, message: 'You already have an open report for this question' })

    await db.report.create({ data: { userId: user.id, questionId, reason, details } })
    return Response.json({ ok: true })
  } catch (err) {
    return jsonError(err)
  }
}
