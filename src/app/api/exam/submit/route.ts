import { NextRequest } from 'next/server'
import { db, dbClient } from '@/lib/db'
import { requireUser, jsonError, HttpError, rateLimit } from '@/lib/auth'
import { gradeAnswer } from '@/lib/exam'
import type { ExamPatternConfig } from '@/lib/types'

/**
 * POST /api/exam/submit — final submission.
 * Server-authoritative: uses the stored endsAt; grading happens entirely server-side.
 * Late submissions (past deadline + grace) are graded as-is (saved answers only) and marked expired.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    rateLimit(`exam-submit:${user.id}`, 10, 60_000)
    const { attemptId } = await req.json()

    const attempt = await db.examAttempt.findUnique({
      where: { id: String(attemptId) },
      include: {
        exam: {
          include: {
            pattern: true,
            examQuestions: {
              orderBy: { order: 'asc' },
              include: { question: true },
            },
          },
        },
        answers: true,
      },
    })
    if (!attempt || attempt.userId !== user.id) throw new HttpError(404, 'Attempt not found')
    if (attempt.status === 'submitted') throw new HttpError(409, 'Already submitted')

    const pattern = attempt.exam.pattern.config as unknown as ExamPatternConfig
    const byExamQuestionId = new Map(attempt.answers.map((a) => [a.examQuestionId, a]))

    const now = Date.now()
    const expired = attempt.endsAt.getTime() + 30_000 < now

    let total = 0
    let max = 0
    const sectionTotals = new Map<string, { marks: number; max: number; correct: number; wrong: number; unattempted: number }>()
    // Grade updates are batched into ONE transaction below: per-answer update
    // calls each opened a fresh Prisma client (Workers subrequest cap is
    // 50/invocation — a fully-answered 75-question mock could not submit).
    const gradeUpdates: { id: string; isCorrect: boolean | null; marks: number }[] = []

    for (const eq of attempt.exam.examQuestions) {
      const q = eq.question
      const ans = byExamQuestionId.get(eq.id)
      const selected = Array.isArray(ans?.selectedOptions) ? (ans.selectedOptions as number[]) : []
      const numericalValue = ans?.numericalValue ?? null
      const correctOptions = Array.isArray(q.correctOptions) ? (q.correctOptions as number[]) : null

      const marking =
        q.type === 'mcq_single' ? pattern.marking.mcqSingle
          : q.type === 'mcq_multi' ? { correct: pattern.marking.mcqMulti.correct, incorrect: pattern.marking.mcqMulti.incorrect }
            : pattern.marking.numerical
      const qMax = marking.correct
      max += qMax

      const graded = gradeAnswer(
        q.type,
        selected.length ? selected : null,
        numericalValue,
        correctOptions,
        q.numericalAnswer ?? null,
        q.numericalTolerance ?? 0.01,
        pattern
      )
      total += graded.marks

      const sec = sectionTotals.get(eq.section) ?? { marks: 0, max: 0, correct: 0, wrong: 0, unattempted: 0 }
      sec.marks += graded.marks
      sec.max += qMax
      if (!graded.attempted) sec.unattempted++
      else if (graded.isCorrect) sec.correct++
      else sec.wrong++
      sectionTotals.set(eq.section, sec)

      if (ans) {
        gradeUpdates.push({ id: ans.id, isCorrect: graded.isCorrect, marks: graded.marks })
      }
    }

    const timeSpentSeconds = Math.max(
      0,
      Math.min(
        attempt.exam.pattern.durationMinutes * 60,
        Math.round((Math.min(now, attempt.endsAt.getTime()) - attempt.startedAt.getTime()) / 1000)
      )
    )

    // Single transaction over a single client: on Workers every db.* Proxy
    // access opens a fresh connection (subrequest cap 50/invocation — a fully
    // answered 75-question mock could not submit with per-answer updates).
    const prisma = dbClient()
    await prisma.$transaction([
      ...gradeUpdates.map((g) =>
        prisma.examAttemptAnswer.update({
          where: { id: g.id },
          data: { isCorrect: g.isCorrect, marksAwarded: g.marks },
        })
      ),
      prisma.examAttempt.update({
        where: { id: attempt.id },
        data: {
          status: expired ? 'expired' : 'submitted',
          submittedAt: new Date(),
          totalMarks: total,
          maxMarks: max,
          timeSpentSeconds,
        },
      }),
    ])

    return Response.json({
      attemptId: attempt.id,
      status: expired ? 'expired' : 'submitted',
      totalMarks: total,
      maxMarks: max,
      timeSpentSeconds,
      sections: [...sectionTotals.entries()].map(([key, v]) => ({ key, ...v })),
    })
  } catch (err) {
    return jsonError(err)
  }
}
