import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, jsonError, HttpError } from '@/lib/auth'
import { toPublicSolution } from '@/lib/questions'

/**
 * GET /api/exam/result?attemptId=... — full result + question-wise review with solutions.
 * GET /api/exam/result — list the user's attempt history.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser()
    const attemptId = req.nextUrl.searchParams.get('attemptId')

    if (!attemptId) {
      const attempts = await db.examAttempt.findMany({
        where: { userId: user.id },
        include: { exam: { select: { title: true, kind: true } } },
        orderBy: { startedAt: 'desc' },
        take: 50,
      })
      return Response.json({
        attempts: attempts.map((a) => ({
          id: a.id,
          examTitle: a.exam.title,
          kind: a.exam.kind,
          status: a.status,
          totalMarks: a.totalMarks,
          maxMarks: a.maxMarks,
          timeSpentSeconds: a.timeSpentSeconds,
          startedAt: a.startedAt,
          submittedAt: a.submittedAt,
        })),
      })
    }

    const attempt = await db.examAttempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: {
          include: {
            pattern: true,
            examQuestions: {
              orderBy: { order: 'asc' },
              include: {
                question: {
                  include: {
                    options: true,
                    images: true,
                    subject: true,
                    chapter: true,
                    solution: { include: { question: { include: { images: true } } } },
                  },
                },
              },
            },
          },
        },
        answers: true,
      },
    })
    if (!attempt || attempt.userId !== user.id) throw new HttpError(404, 'Attempt not found')

    const byExamQuestionId = new Map(attempt.answers.map((a) => [a.examQuestionId, a]))
    const sectionTotals = new Map<string, { marks: number; max: number; correct: number; wrong: number; unattempted: number }>()

    const review = attempt.exam.examQuestions.map((eq) => {
      const q = eq.question
      const ans = byExamQuestionId.get(eq.id)
      const sec = sectionTotals.get(eq.section) ?? { marks: 0, max: 0, correct: 0, wrong: 0, unattempted: 0 }
      sec.marks += ans?.marksAwarded ?? 0
      sec.max += 4
      if (ans?.marksAwarded === null || ans?.marksAwarded === undefined) sec.unattempted++
      else if ((ans?.isCorrect ?? false) || (ans?.marksAwarded ?? 0) > 0) sec.correct++
      else sec.wrong++
      sectionTotals.set(eq.section, sec)

      return {
        examQuestionId: eq.id,
        order: eq.order,
        section: eq.section,
        question: {
          publicId: q.publicId,
          type: q.type,
          text: q.text,
          options: [...q.options].sort((a, b) => a.idx - b.idx).map((o) => ({ idx: o.idx, text: o.text, isCorrect: o.isCorrect })),
          images: q.images.filter((i) => i.kind === 'question').map((i) => ({ url: i.url, altText: i.altText })),
          chapterName: q.chapter.name,
          difficulty: q.difficulty,
          sourceYear: q.sourceYear,
          numericalAnswer: q.numericalAnswer,
          numericalTolerance: q.numericalTolerance,
        },
        yourAnswer: {
          selectedOptions: Array.isArray(ans?.selectedOptions) ? (ans.selectedOptions as number[]) : [],
          numericalValue: ans?.numericalValue ?? null,
          isCorrect: ans?.isCorrect ?? null,
          marksAwarded: ans?.marksAwarded ?? 0,
          timeSpentSeconds: ans?.timeSpentSeconds ?? 0,
        },
        solution: q.solution ? toPublicSolution(q.solution) : null,
      }
    })

    return Response.json({
      attempt: {
        id: attempt.id,
        examTitle: attempt.exam.title,
        patternName: attempt.exam.pattern.name,
        status: attempt.status,
        startedAt: attempt.startedAt,
        submittedAt: attempt.submittedAt,
        endsAt: attempt.endsAt,
        totalMarks: attempt.totalMarks,
        maxMarks: attempt.maxMarks,
        timeSpentSeconds: attempt.timeSpentSeconds,
      },
      sections: [...sectionTotals.entries()].map(([key, v]) => ({ key, ...v })),
      review,
    })
  } catch (err) {
    return jsonError(err)
  }
}
