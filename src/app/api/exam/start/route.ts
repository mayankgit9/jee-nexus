import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, jsonError, HttpError } from '@/lib/auth'

/**
 * POST /api/exam/start — create an ExamAttempt for the user.
 * Returns the questions WITHOUT answers plus the server-authoritative deadline.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    const { examId } = await req.json()
    if (!examId) throw new HttpError(400, 'examId is required')

    const exam = await loadExam(String(examId))
    if (!exam || !exam.isPublished) throw new HttpError(404, 'Exam not found')

    // Resume an in-progress attempt if still within time
    const existing = await db.examAttempt.findFirst({
      where: { userId: user.id, examId: exam.id, status: 'in_progress' },
      include: { answers: true },
    })
    if (existing && existing.endsAt.getTime() > Date.now()) {
      const resumed = formatAttempt(exam, existing)
      const cfgDur = ((exam.config ?? {}) as { durationMinutes?: number }).durationMinutes
      resumed.exam.durationMinutes = Math.min(240, Math.max(5, cfgDur ?? exam.pattern.durationMinutes))
      return Response.json(resumed)
    }

    // Custom tests may override duration via their config; pattern duration is the fallback
    const examConfig = (exam.config ?? {}) as { durationMinutes?: number }
    const durationMinutes = Math.min(240, Math.max(5, examConfig.durationMinutes ?? exam.pattern.durationMinutes))
    const endsAt = new Date(Date.now() + durationMinutes * 60 * 1000)
    const attempt = await db.examAttempt.create({
      data: { userId: user.id, examId: exam.id, endsAt, status: 'in_progress' },
      include: { answers: true },
    })
    const payload = formatAttempt(exam, attempt)
    // report the EFFECTIVE duration (config override wins), not the pattern default —
    // the timer itself is server-authoritative via endsAt/serverNow
    payload.exam.durationMinutes = durationMinutes
    return Response.json(payload)
  } catch (err) {
    return jsonError(err)
  }
}

async function loadExam(id: string) {
  return db.exam.findUnique({
    where: { id },
    include: {
      pattern: true,
      examQuestions: {
        orderBy: { order: 'asc' },
        include: { question: { include: { options: true, images: true, subject: true, chapter: true } } },
      },
    },
  })
}

type ExamWithQuestions = NonNullable<Awaited<ReturnType<typeof loadExam>>>

function formatAttempt(
  exam: ExamWithQuestions,
  attempt: {
    id: string
    endsAt: Date
    answers: { examQuestionId: string; selectedOptions: unknown; numericalValue: string | null; visited: boolean; markedForReview: boolean }[]
  }
) {
  const pattern = exam.pattern.config as Record<string, unknown>
  const savedAnswers: Record<string, { selectedOptions?: number[]; numericalValue?: string; visited: boolean; markedForReview?: boolean }> = {}
  for (const a of attempt.answers) {
    savedAnswers[a.examQuestionId] = {
      selectedOptions: Array.isArray(a.selectedOptions) ? (a.selectedOptions as number[]) : undefined,
      numericalValue: a.numericalValue ?? undefined,
      visited: a.visited,
      markedForReview: a.markedForReview,
    }
  }
  return {
    attemptId: attempt.id,
    exam: {
      id: exam.id,
      title: exam.title,
      durationMinutes: exam.pattern.durationMinutes,
      pattern: { name: exam.pattern.name, ...pattern },
    },
    endsAt: attempt.endsAt.toISOString(),
    serverNow: new Date().toISOString(),
    savedAnswers,
    questions: exam.examQuestions.map((eq) => ({
      examQuestionId: eq.id,
      order: eq.order,
      section: eq.section,
      question: {
        id: eq.question.id,
        publicId: eq.question.publicId,
        type: eq.question.type,
        text: eq.question.text,
        options: [...eq.question.options].sort((a, b) => a.idx - b.idx).map((o) => ({ idx: o.idx, text: o.text })),
        images: eq.question.images
          .filter((i) => i.kind === 'question')
          .map((i) => ({ url: i.url, altText: i.altText, caption: i.caption ?? undefined })),
        difficulty: eq.question.difficulty,
        chapterName: eq.question.chapter.name,
        sourceYear: eq.question.sourceYear,
        sourceShift: eq.question.sourceShift,
      },
    })),
  }
}
