import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { clientIp, getSessionUser, jsonError, HttpError, rateLimit } from '@/lib/auth'
import { toPublicSolution } from '@/lib/questions'
import { autoScheduleOnMistake, recordReview } from '@/lib/revision'
import { Prisma } from '@prisma/client'

function isCorrectMcqSingle(selected: number[], correct: number[]): boolean {
  return selected.length === 1 && correct.length === 1 && selected[0] === correct[0]
}

function isCorrectMcqMulti(selected: number[], correct: number[]): boolean {
  return selected.length !== correct.length ? false : (
    (() => {
      const s = [...new Set(selected)].sort()
      const c = [...new Set(correct)].sort()
      return s.length === selected.length && s.every((v, i) => v === c[i])
    })()
  )
}

const MISTAKE_CATEGORIES = [
  'conceptual', 'calculation', 'formula_forgotten', 'misread', 'time_management', 'incorrect_guess', 'other',
] as const

/** Submit an answer for a practice question: grade it server-side, record attempt, return solution.
 *  0019 additions: hintsUsed tracking, offline sync idempotency (clientKey),
 *  mistake-notebook auto-save, spaced-repetition hooks (revision mode). */
export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req)
    await rateLimit(`submit:${ip}`, 60, 60_000)

    const body = await req.json()
    const questionId = String(body.questionId ?? '')
    const timeSpentSeconds = Math.max(0, Math.min(3600, Number(body.timeSpentSeconds ?? 0)))
    const hintsUsed = Math.max(0, Math.min(10, Number(body.hintsUsed ?? 0)))
    const mode = String(body.mode ?? 'practice') // practice | revision | notebook_retry
    const selfRating = ['easy', 'medium', 'difficult'].includes(body.selfRating) ? body.selfRating : null
    const clientKey = typeof body.clientKey === 'string' && body.clientKey.length >= 8 ? body.clientKey.slice(0, 64) : null

    const user = await getSessionUser()

    // OFFLINE SYNC IDEMPOTENCY: a client key already present means this exact
    // submission was synced before — return the graded result WITHOUT writing
    // a duplicate attempt (never lose nor double-record an offline attempt).
    if (user && clientKey) {
      const existing = await db.attempt.findFirst({ where: { clientKey }, select: { id: true, isCorrect: true } })
      if (existing) {
        const question = await db.question.findUnique({
          where: { id: questionId },
          include: { solution: { include: { question: { include: { images: { where: { hidden: false } } } } } } },
        })
        if (question) {
          return Response.json({
            result: {
              isCorrect: existing.isCorrect,
              correctOptions: Array.isArray(question.correctOptions) ? (question.correctOptions as number[]) : undefined,
              numericalAnswer: question.numericalAnswer ? Number(question.numericalAnswer) : undefined,
              numericalTolerance: question.numericalTolerance ? Number(question.numericalTolerance) : undefined,
              solution: question.solution ? toPublicSolution(question.solution) : null,
            },
            alreadySynced: true,
          })
        }
      }
    }

    const question = await db.question.findUnique({
      where: { id: questionId },
      include: { solution: { include: { question: { include: { images: { where: { hidden: false } } } } } } },
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

    const answerSnapshot = {
      selectedOptions: selectedOptions ?? undefined,
      numericalValue: numericalValue ?? undefined,
      at: new Date().toISOString(),
    } as unknown as Prisma.InputJsonValue

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
          hintsUsed,
          ...(clientKey ? { clientKey } : {}),
        },
      })

      // SPACED REPETITION: revision mode grades move the interval ladder for
      // every answer (correct stretches, wrong collapses). Practice mode only
      // schedules on mistakes (auto-add to the revision queue due tomorrow).
      if (mode === 'revision') {
        await recordReview(user.id, question.id, { wasCorrect: isCorrect === true, selfRating }, {
          hintsUsed,
          timeSpentSeconds,
        }).catch(() => {})
      } else if (isCorrect === false) {
        await autoScheduleOnMistake(user.id, question.id).catch(() => {})

        // MISTAKE NOTEBOOK auto-save: a wrong answer belongs in the notebook
        // (category editable later by the student). Not removed on later
        // correct answers — only mistakeCount/correctedAt are updated.
        const manualCategory = MISTAKE_CATEGORIES.includes(body.mistakeCategory) ? body.mistakeCategory : null
        await db.mistakeEntry.upsert({
          where: { userId_questionId: { userId: user.id, questionId: question.id } },
          update: {
            mistakeCount: { increment: 1 },
            lastMistakeAt: new Date(),
            correctedAt: null,
            lastAnswer: answerSnapshot,
            ...(manualCategory ? { category: manualCategory } : {}),
          },
          create: {
            userId: user.id,
            questionId: question.id,
            category: manualCategory ?? 'conceptual',
            lastAnswer: answerSnapshot,
          },
        }).catch(() => {})
      } else if (mode === 'notebook_retry' && isCorrect === true) {
        // Successful retry: mark the correction WITHOUT removing the entry
        // (the notebook keeps it for spaced repetition and history).
        await db.mistakeEntry.updateMany({
          where: { userId: user.id, questionId: question.id },
          data: { correctedAt: new Date() },
        }).catch(() => {})
        await recordReview(user.id, question.id, { wasCorrect: true, selfRating }, {
          hintsUsed,
          timeSpentSeconds,
        }).catch(() => {})
      }
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
