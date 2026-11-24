import { db } from '@/lib/db'
import { requireUser, jsonError } from '@/lib/auth'

/** Performance statistics dashboard data */
export async function GET() {
  try {
    const user = await requireUser()

    const [total, correct, bySubjectRaw, recent, bookmarkCount] = await Promise.all([
      db.attempt.count({ where: { userId: user.id } }),
      db.attempt.count({ where: { userId: user.id, isCorrect: true } }),
      db.attempt.groupBy({
        by: ['questionId'],
        where: { userId: user.id },
        _count: { _all: true },
      }),
      db.attempt.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          question: {
            include: { subject: true, chapter: true },
          },
        },
      }),
      db.bookmark.count({ where: { userId: user.id } }),
    ])

    // Subject-wise breakdown via question joins
    const attempts = await db.attempt.findMany({
      where: { userId: user.id },
      select: {
        isCorrect: true,
        timeSpentSeconds: true,
        question: { select: { subject: { select: { key: true, name: true } }, chapter: { select: { key: true, name: true } } } },
      },
      take: 5000,
    })

    const subjects = new Map<string, { name: string; attempted: number; correct: number }>()
    const chapters = new Map<string, { name: string; subject: string; attempted: number; correct: number }>()
    let totalTime = 0
    let answeredCount = 0
    for (const a of attempts) {
      const sk = a.question.subject.key
      const s = subjects.get(sk) ?? { name: a.question.subject.name, attempted: 0, correct: 0 }
      s.attempted++
      if (a.isCorrect === true) s.correct++
      subjects.set(sk, s)

      const ck = a.question.chapter.key
      const c = chapters.get(ck) ?? {
        name: a.question.chapter.name,
        subject: a.question.subject.name,
        attempted: 0,
        correct: 0,
      }
      c.attempted++
      if (a.isCorrect === true) c.correct++
      chapters.set(ck, c)

      totalTime += a.timeSpentSeconds
      if (a.isCorrect !== null) answeredCount++
    }

    const subjectStats = [...subjects.entries()].map(([key, v]) => ({
      key,
      name: v.name,
      attempted: v.attempted,
      correct: v.correct,
      accuracy: v.attempted > 0 ? Math.round((v.correct / v.attempted) * 100) : 0,
    }))

    const chapterStats = [...chapters.entries()]
      .map(([key, v]) => ({
        key,
        name: v.name,
        subject: v.subject,
        attempted: v.attempted,
        correct: v.correct,
        accuracy: v.attempted > 0 ? Math.round((v.correct / v.attempted) * 100) : 0,
      }))
      .sort((a, b) => a.accuracy - b.accuracy) // weakest first

    // daily activity (last 14 days)
    const dayCounts = new Map<string, number>()
    const recentAttemptsForDays = await db.attempt.findMany({
      where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 14) } },
      select: { createdAt: true },
    })
    for (const a of recentAttemptsForDays) {
      const day = a.createdAt.toISOString().slice(0, 10)
      dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1)
    }
    const daily = [...dayCounts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, count]) => ({ date, count }))

    return Response.json({
      stats: {
        totalAttempts: total,
        correct,
        accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
        answeredCount,
        totalTimeSeconds: totalTime,
        bookmarkCount,
        distinctQuestions: bySubjectRaw.length,
        subjects: subjectStats,
        chapters: chapterStats,
        daily,
        recent: recent.map((a) => ({
          id: a.id,
          isCorrect: a.isCorrect,
          createdAt: a.createdAt,
          subject: a.question.subject.name,
          chapter: a.question.chapter.name,
          publicId: a.question.publicId,
        })),
      },
    })
  } catch (err) {
    return jsonError(err)
  }
}
