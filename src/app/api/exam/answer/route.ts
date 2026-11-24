import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, jsonError, HttpError, rateLimit } from '@/lib/auth'

/**
 * POST /api/exam/answer — autosave one answer (selection / numerical / visit / mark-for-review).
 * Rejects writes after the server-authoritative deadline (+30s network grace).
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    rateLimit(`exam-answer:${user.id}`, 240, 60_000)
    const body = await req.json()
    const attemptId = String(body.attemptId ?? '')
    const examQuestionId = String(body.examQuestionId ?? '')

    const attempt = await db.examAttempt.findUnique({
      where: { id: attemptId },
      include: { exam: { include: { examQuestions: true } } },
    })
    if (!attempt || attempt.userId !== user.id) throw new HttpError(404, 'Attempt not found')
    if (attempt.status !== 'in_progress') throw new HttpError(409, 'Attempt already submitted')
    if (!attempt.exam.examQuestions.some((eq) => eq.id === examQuestionId)) {
      throw new HttpError(400, 'Question is not part of this exam')
    }

    const graceMs = 30_000
    if (attempt.endsAt.getTime() + graceMs < Date.now()) {
      throw new HttpError(409, 'Exam time is over')
    }

    const selected = Array.isArray(body.selectedOptions)
      ? body.selectedOptions.map(Number).filter((n: number) => !isNaN(n))
      : null
    const numerical = body.numericalValue !== undefined && body.numericalValue !== null ? String(body.numericalValue).slice(0, 32) : null
    const visited = body.visited === true
    const markedForReview = body.markedForReview !== undefined ? body.markedForReview === true : undefined
    const timeDelta = Math.max(0, Math.min(600, Number(body.timeDeltaSeconds ?? 0)))

    await db.examAttemptAnswer.upsert({
      where: { examAttemptId_examQuestionId: { examAttemptId: attemptId, examQuestionId } },
      update: {
        ...(selected !== null && { selectedOptions: selected.length ? selected : null }),
        ...(numerical !== null && { numericalValue: numerical === '' ? null : numerical }),
        ...(markedForReview !== undefined && { markedForReview }),
        ...(timeDelta > 0 && { timeSpentSeconds: { increment: timeDelta } }),
        visited,
      },
      create: {
        examAttemptId: attemptId,
        examQuestionId,
        selectedOptions: selected?.length ? selected : null,
        numericalValue: numerical || null,
        visited,
        markedForReview: markedForReview ?? false,
        timeSpentSeconds: timeDelta,
      },
    })

    return Response.json({ ok: true, savedAt: new Date().toISOString() })
  } catch (err) {
    return jsonError(err)
  }
}
