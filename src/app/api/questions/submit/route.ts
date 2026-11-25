import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, jsonError, HttpError, rateLimit } from '@/lib/auth'
import { toPublicSolution } from '@/lib/questions'
import { Prisma } from '@prisma/client'

function isCorrectMcqSingle(selected: number[], correct: number[]): boolean {
  return selected.length === 1 && correct.length === 1 && selected[0] === correct[0]
}

function isCorrectMcqMulti(selected: number[], correct: number[]): boolean {
  if (selected.length !== correct.length) return false
  const s = [...new Set(selected)].sort()
  const c = [...new Set(correct)].sort()
  return s.length === selected.length && s.every((v, i) => v === c[i]) // no duplicates, exact set match
}

/** Submit an answer for a practice question: grade it server-side, record attempt, return solution */
export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for') ?? 'local'
    await rateLimit(`submit:${ip}`, 60, 60_000)

    const body = await req.json()
    const questionId = String(body.questionId ?? '')
    const timeSpentSeconds = Math.max(0, Math.min(3600, Number(body.timeSpentSeconds ?? 0)))

    const user = await getSessionUser()
    const question = await db.question.findUnique({
      where: { id: questionId },
      include: { solution: { include: { question: { include: { images: true } } } } },
    })
    if (!question) throw new HttpError(404, 'Question not found')

    let isCorrect: boolean | null = null
    let submittedSomething = false
    let selectedOptions: number[] | null = null
    let numericalValue: string | null = null

    if (question.type === 'numerical') {
      const raw = String(body.numericalValue ?? '').trim()
      if (raw !== '') {
        submittedSomething = true
        numericalValue = raw
        const value = Number(raw)
        if (!isNaN(value) && question.numericalAnswer !== null) {
          const expected = Number(question.numericalAnswer)
          const tol = question.numericalTolerance !== null ? Number(question.numericalTolerance) : 0.01
          if (!isNaN(expected)) isCorrect = Math.abs(value - expected) <= Math.max(tol, 1e-9)
        }
      }
    } else {
      const selected = Array.isArray(body.selectedOptions) ? body.selectedOptions.map(Number).filter((n) => !isNaN(n)) : []
      if (selected.length > 0) {
        submittedSomething = true
        selectedOptions = selected
        const correct = Array.isArray(question.correctOptions) ? (question.correctOptions as number[]) : []
        isCorrect =
          question.type === 'mcq_single' ? isCorrectMcqSingle(selected, correct) : isCorrectMcqMulti(selected, correct)
      }
    }

    // Record attempt for logged-in users ONLY when an actual answer was submitted
    // (browse-mode solution reveals pass no answer and must not pollute history)
    if (user && submittedSomething) {
      await db.attempt.create({
        data: {
          userId: user.id,
          questionId: question.id,
          selectedOptions: selectedOptions ?? Prisma.DbNull,
          numericalValue,
          isCorrect: submittedSomething ? isCorrect : null,
          timeSpentSeconds,
        },
      })
    }

    return Response.json({
      result: {
        isCorrect: submittedSomething ? isCorrect : null,
        correctOptions: Array.isArray(question.correctOptions) ? (question.correctOptions as number[]) : undefined,
        numericalAnswer: question.numericalAnswer ? Number(question.numericalAnswer) : undefined,
        numericalTolerance: question.numericalTolerance ? Number(question.numericalTolerance) : undefined,
        solution: question.solution ? toPublicSolution(question.solution) : null,
      },
    })
  } catch (err) {
    return jsonError(err)
  }
}
