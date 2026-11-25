import { NextRequest } from 'next/server'
import { dbClient } from '@/lib/db'
import { clientIp, getSessionUser, jsonError, rateLimit } from '@/lib/auth'
import { toPublicQuestion, toPublicSolution } from '@/lib/questions'
import { getDailyQuestionId, istDateKey, istDayWindow } from '@/lib/daily'

/**
 * Daily Challenge — GET /api/daily
 * One question per IST day, identical for everyone. Anonymous visitors get
 * the question (gradeable via the normal submit route) but nothing is
 * recorded; logged-in users get `answered` once they completed today and —
 * only then — the full solution (answers never ship before a real submit).
 */
export async function GET(req: NextRequest) {
  try {
    await rateLimit(`daily:${clientIp(req)}`, 60, 60_000)
    const prisma = dbClient()
    const date = istDateKey()

    const qid = await getDailyQuestionId(date)
    if (!qid) {
      return Response.json({ date, question: null, attemptedCount: 0, answered: null })
    }

    const window = istDayWindow(date)
    const user = await getSessionUser()

    const [attemptedCount, question] = await Promise.all([
      prisma.attempt.count({
        where: { questionId: qid, createdAt: { gte: window.start, lt: window.end } },
      }),
      prisma.question.findUnique({
        where: { id: qid },
        include: {
          subject: true,
          chapter: true,
          options: true,
          images: true,
          solution: { include: { question: { include: { images: true } } } },
          ...(user ? { bookmarks: { where: { userId: user.id }, select: { id: true } } } : {}),
        },
      }),
    ])

    if (!question || question.verificationStatus === 'rejected') {
      return Response.json({ date, question: null, attemptedCount, answered: null })
    }

    let answered: {
      isCorrect: boolean | null
      selectedOptions?: number[]
      numericalValue?: string
      submittedAt: string
    } | null = null
    if (user) {
      const a = await prisma.attempt.findFirst({
        where: {
          userId: user.id,
          questionId: qid,
          createdAt: { gte: window.start, lt: window.end },
        },
        orderBy: { createdAt: 'desc' },
      })
      if (a) {
        answered = {
          isCorrect: a.isCorrect,
          ...(Array.isArray(a.selectedOptions)
            ? { selectedOptions: (a.selectedOptions as unknown[]).map(Number) }
            : {}),
          ...(a.numericalValue ? { numericalValue: a.numericalValue } : {}),
          submittedAt: a.createdAt.toISOString(),
        }
      }
    }

    const payload: Record<string, unknown> = {
      date,
      question: toPublicQuestion(question),
      attemptedCount,
      answered,
    }
    // The solution ships ONLY to users who already completed today's challenge
    if (answered && question.solution) payload.solution = toPublicSolution(question.solution)
    return Response.json(payload)
  } catch (err) {
    return jsonError(err)
  }
}
