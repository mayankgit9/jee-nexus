import { NextRequest } from 'next/server'
import { dbClient } from '@/lib/db'
import { requireUser, jsonError } from '@/lib/auth'

/**
 * GET /api/stats/history — paginated attempt history (practice + graded CBT
 * answers merged), with filters. Powers the "Attempt history" card in
 * PerformanceView; previously only the newest 10 items existed and there was
 * no way to see older sessions or filter to wrong/skipped work.
 *
 * Query params:
 *   page    — 1-based (default 1)
 *   filter  — all | practice | exam | correct | incorrect | skipped
 *             (skipped = recorded but ungraded — numerical pending etc.)
 *
 * Bounded fetches (mirrors /api/stats: take 5000 both sources, one client),
 * merged + sorted in memory, then sliced to the requested page. Personal
 * history is small in practice, and the filter cuts the set server-side
 * before pagination.
 */
const HISTORY_TAKE = 5000
const PAGE_SIZE_MAX = 50

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser()
    const prisma = dbClient()

    const sp = req.nextUrl.searchParams
    const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1)
    const pageSizeRaw = Number.parseInt(sp.get('pageSize') ?? '20', 10) || 20
    const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(5, pageSizeRaw))
    const filter = sp.get('filter') ?? 'all'
    const wantPractice = filter === 'all' || filter === 'practice' || ['correct', 'incorrect', 'skipped'].includes(filter)
    const wantExam = filter === 'all' || filter === 'exam' || ['correct', 'incorrect', 'skipped'].includes(filter)

    const matchCorrect = (isCorrect: boolean | null): boolean => {
      if (filter === 'correct') return isCorrect === true
      if (filter === 'incorrect') return isCorrect === false
      if (filter === 'skipped') return isCorrect === null
      return true
    }

    const [practice, examAnswers] = await Promise.all([
      wantPractice
        ? prisma.attempt.findMany({
            where: { userId: user.id },
            orderBy: { createdAt: 'desc' },
            take: HISTORY_TAKE,
            select: {
              id: true,
              isCorrect: true,
              createdAt: true,
              question: { select: { publicId: true, subject: { select: { name: true } }, chapter: { select: { name: true } } } },
            },
          })
        : Promise.resolve([] as {
            id: string
            isCorrect: boolean | null
            createdAt: Date
            question: { publicId: string; subject: { name: string }; chapter: { name: string } }
          }[]),
      wantExam
        ? prisma.examAttemptAnswer.findMany({
            where: { examAttempt: { userId: user.id, status: { in: ['submitted', 'expired'] } } },
            select: {
              id: true,
              selectedOptions: true,
              numericalValue: true,
              isCorrect: true,
              updatedAt: true,
              examQuestion: {
                select: {
                  question: {
                    select: { publicId: true, subject: { select: { name: true } }, chapter: { select: { name: true } } },
                  },
                },
              },
            },
            take: HISTORY_TAKE,
          })
        : Promise.resolve([]),
    ])

    type Item = {
      id: string
      isCorrect: boolean | null
      createdAt: string
      subject: string
      chapter: string
      publicId: string
      source: 'practice' | 'exam'
    }
    const items: Item[] = []
    for (const a of practice) {
      if (!matchCorrect(a.isCorrect)) continue
      items.push({
        id: a.id,
        isCorrect: a.isCorrect,
        createdAt: a.createdAt.toISOString(),
        subject: a.question.subject.name,
        chapter: a.question.chapter.name,
        publicId: a.question.publicId,
        source: 'practice',
      })
    }
    for (const ea of examAnswers) {
      const graded = !(ea.selectedOptions === null && ea.numericalValue === null)
      if (!graded) continue // unattempted rows are not history entries
      if (!matchCorrect(ea.isCorrect)) continue
      const q = ea.examQuestion.question
      items.push({
        id: `exam-${ea.id}`,
        isCorrect: ea.isCorrect,
        createdAt: ea.updatedAt.toISOString(),
        subject: q.subject.name,
        chapter: q.chapter.name,
        publicId: q.publicId,
        source: 'exam',
      })
    }

    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    const total = items.length
    const start = (page - 1) * pageSize
    const pageItems = items.slice(start, start + pageSize)

    return Response.json({ items: pageItems, page, pageSize, total, hasMore: start + pageSize < total })
  } catch (err) {
    return jsonError(err)
  }
}
