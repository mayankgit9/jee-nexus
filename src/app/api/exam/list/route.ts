import { db } from '@/lib/db'
import { jsonError } from '@/lib/auth'
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
      exams: exams.map((e) => ({
        id: e.id,
        title: e.title,
        description: e.description,
        kind: e.kind,
        durationMinutes: e.pattern.durationMinutes,
        questionCount: e._count.examQuestions,
        attemptCount: e._count.attempts,
        createdAt: e.createdAt,
      })),
    })
  } catch (err) {
    return jsonError(err)
  }
}

export async function POST(req: Request) {
  try {
    await ensureDefaultPatterns()
    const body = await req.json()
    const title = String(body.title ?? 'Custom mock test').slice(0, 120)
    const kind = ['full_length', 'subject', 'chapter', 'custom'].includes(body.kind) ? body.kind : 'custom'
    const subjectKey = ['physics', 'chemistry', 'mathematics'].includes(body.subjectKey) ? body.subjectKey : undefined
    const chapterKey = body.chapterKey ? String(body.chapterKey) : undefined
    const year = body.year ? Number(body.year) : undefined
    const questionsPerSubject = body.questionsPerSubject ? Math.min(Math.max(Number(body.questionsPerSubject), 1), 25) : undefined
    const durationMinutes = body.durationMinutes ? Math.min(Math.max(Number(body.durationMinutes), 5), 240) : undefined

    const r = await generateExam({ title, kind, subjectKey, chapterKey, year, questionsPerSubject, durationMinutes })
    return Response.json(r)
  } catch (err) {
    return jsonError(err)
  }
}
