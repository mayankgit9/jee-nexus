import { db } from '@/lib/db'
import { jsonError, requireUser, rateLimit } from '@/lib/auth'
import { generateExam, ensureDefaultPatterns } from '@/lib/examService'

/**
 * GET /api/exam/list — published exams + the user's attempt history for each.
 * POST /api/exam/list — generate a new exam (student-usable; questions come only from the bank).
 */
export async function GET() {
  try {
    await ensureDefaultPatterns()
    const exams = await db.exam.findMany({
      where: { isPublished: true },
      include: {
        pattern: true,
        _count: { select: { examQuestions: true, attempts: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return Response.json({
      exams: exams.map((e) => {
        // Custom-timed exams store their duration in config.durationMinutes
        // (same source the start route uses); the pattern value is only the
        // default for full-length attempts.
        const cfg = (e.config ?? {}) as { durationMinutes?: number }
        return {
          id: e.id,
          title: e.title,
          description: e.description,
          kind: e.kind,
          durationMinutes:
            typeof cfg.durationMinutes === 'number' ? cfg.durationMinutes : e.pattern.durationMinutes,
          questionCount: e._count.examQuestions,
          attemptCount: e._count.attempts,
          createdAt: e.createdAt,
        }
      }),
    })
  } catch (err) {
    return jsonError(err)
  }
}

export async function POST(req: Request) {
  try {
    // exam generation writes an Exam + N examQuestion rows — abuse guard
    // (unlimited generation would flood the shared exam list)
    const user = await requireUser()
    await rateLimit(`exam-gen:${user.id}`, 10, 60_000)
    await ensureDefaultPatterns()
    const body = await req.json()
    const title = String(body.title ?? 'Custom mock test').slice(0, 120)
    const kind = ['full_length', 'subject', 'chapter', 'custom'].includes(body.kind) ? body.kind : 'custom'
    const subjectKey = ['physics', 'chemistry', 'mathematics'].includes(body.subjectKey) ? body.subjectKey : undefined
    const chapterKey = body.chapterKey ? String(body.chapterKey) : undefined
    const year = body.year ? Number(body.year) : undefined
    const questionsPerSubject = body.questionsPerSubject ? Math.min(Math.max(Number(body.questionsPerSubject), 1), 25) : undefined
    const durationMinutes = body.durationMinutes ? Math.min(Math.max(Number(body.durationMinutes), 5), 240) : undefined

    // ---- Custom Test Builder filters (0019, Part F) ----
    const f = (body.filters ?? {}) as Record<string, unknown>
    const subjectKeys = Array.isArray(f.subjectKeys)
      ? f.subjectKeys.filter((s) => ['physics', 'chemistry', 'mathematics'].includes(String(s)))
      : undefined
    const chapterKeys = Array.isArray(f.chapterKeys) ? f.chapterKeys.map(String).slice(0, 30) : undefined
    const topics = Array.isArray(f.topics) ? f.topics.map(String).slice(0, 30) : undefined
    const difficulties = Array.isArray(f.difficulties) ? f.difficulties.filter((d) => ['easy', 'medium', 'hard'].includes(String(d))) : undefined
    const types = Array.isArray(f.types) ? f.types.filter((t) => ['mcq_single', 'mcq_multi', 'numerical'].includes(String(t))) : undefined
    const shift = typeof f.shift === 'string' && f.shift.trim() ? f.shift.trim() : undefined
    const attemptState = ['all', 'unattempted', 'incorrect', 'bookmarked'].includes(String(f.attemptState))
      ? (f.attemptState as 'all' | 'unattempted' | 'incorrect' | 'bookmarked')
      : undefined
    const filters = {
      ...(subjectKeys ? { subjectKeys } : {}),
      ...(chapterKeys ? { chapterKeys } : {}),
      ...(topics ? { topics } : {}),
      ...(difficulties ? { difficulties } : {}),
      ...(types ? { types } : {}),
      ...(shift ? { shift } : {}),
      ...(attemptState ? { attemptState } : {}),
      ...(f.year ? { year: Number(f.year) } : {}),
    }
    const hasBuilderFilters = Object.keys(filters).length > 0
    const totalQuestions = body.totalQuestions ? Math.min(Math.max(Number(body.totalQuestions), 1), 90) : undefined

    const r = await generateExam({
      title,
      kind,
      subjectKey,
      chapterKey,
      year,
      questionsPerSubject,
      durationMinutes,
      ...(hasBuilderFilters ? { filters } : {}),
      ...(totalQuestions ? { totalQuestions } : {}),
      userId: user.id,
    })
    return Response.json(r)
  } catch (err) {
    return jsonError(err)
  }
}
