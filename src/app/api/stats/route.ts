import { db, dbClient } from '@/lib/db'
import { requireUser, jsonError } from '@/lib/auth'

/** Performance statistics dashboard data — merges practice attempts AND
 *  exam (CBT/mock) answers so mock-only students still get analytics. */
export async function GET() {
  try {
    const user = await requireUser()
    // one client for the whole dashboard payload (Proxy = fresh connection
    // per access; this route makes 8+ queries)
    const prisma = dbClient()

    const [total, correct, bySubjectRaw, recent, bookmarkCount, examAnswers, examAttemptsRaw, finishedAttempts, examQuestionTotals] = await Promise.all([
      prisma.attempt.count({ where: { userId: user.id } }),
      prisma.attempt.count({ where: { userId: user.id, isCorrect: true } }),
      prisma.attempt.groupBy({
        by: ['questionId'],
        where: { userId: user.id },
        _count: { _all: true },
      }),
      prisma.attempt.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          question: {
            include: { subject: true, chapter: true },
          },
        },
      }),
      prisma.bookmark.count({ where: { userId: user.id } }),
      // graded CBT answers (only submitted/expired attempts carry grades);
      // unanswered rows are skipped in JS below — Json-null filtering in
      // Prisma has DbNull/JsonNull subtleties not worth relying on here.
      prisma.examAttemptAnswer.findMany({
        where: {
          examAttempt: { userId: user.id, status: { in: ['submitted', 'expired'] } },
        },
        select: {
          id: true,
          selectedOptions: true,
          numericalValue: true,
          isCorrect: true,
          timeSpentSeconds: true,
          updatedAt: true,
          examAttemptId: true,
          examQuestion: {
            select: {
              question: {
                select: {
                  id: true,
                  publicId: true,
                  subject: { select: { key: true, name: true } },
                  chapter: { select: { key: true, name: true } },
                },
              },
            },
          },
        },
        take: 5000,
      }),
      prisma.examAttempt.count({ where: { userId: user.id, status: { in: ['submitted', 'expired'] } } }),
      // per-mock breakdown (backlog ②): the 20 most recent finished CBT
      // attempts with their exam metadata; answered/correct per attempt are
      // derived in JS from examAnswers below (same rows, no extra queries,
      // and JSON-null filtering stays in JS per the comment above)
      prisma.examAttempt.findMany({
        where: { userId: user.id, status: { in: ['submitted', 'expired'] } },
        orderBy: { startedAt: 'desc' },
        take: 20,
        select: {
          id: true,
          examId: true,
          startedAt: true,
          status: true,
          totalMarks: true,
          maxMarks: true,
          timeSpentSeconds: true,
          exam: { select: { title: true, kind: true, year: true } },
        },
      }),
      // total questions per exam (for an attempt-level completion ratio)
      prisma.examQuestion.groupBy({
        by: ['examId'],
        where: { exam: { attempts: { some: { userId: user.id, status: { in: ['submitted', 'expired'] } } } } },
        _count: { _all: true },
      }),
    ])

    // Subject-wise breakdown via question joins
    const attempts = await prisma.attempt.findMany({
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

    // merge graded CBT answers into the same aggregations
    let examAnswered = 0
    let examCorrect = 0
    const examRecent: { id: string; isCorrect: boolean | null; createdAt: Date; subject: string; chapter: string; publicId: string; source: 'exam' }[] = []
    const examDayCounts = new Map<string, number>()
    const examQuestionIds = new Set<string>()
    for (const ea of examAnswers) {
      if (ea.selectedOptions === null && ea.numericalValue === null) continue // unattempted
      const q = ea.examQuestion.question
      examQuestionIds.add(q.id)
      const sk = q.subject.key
      const s = subjects.get(sk) ?? { name: q.subject.name, attempted: 0, correct: 0 }
      s.attempted++
      if (ea.isCorrect === true) { s.correct++; examCorrect++ }
      subjects.set(sk, s)

      const ck = q.chapter.key
      const c = chapters.get(ck) ?? { name: q.chapter.name, subject: q.subject.name, attempted: 0, correct: 0 }
      c.attempted++
      if (ea.isCorrect === true) c.correct++
      chapters.set(ck, c)

      totalTime += ea.timeSpentSeconds
      examAnswered++
      const day = ea.updatedAt.toISOString().slice(0, 10)
      examDayCounts.set(day, (examDayCounts.get(day) ?? 0) + 1)
      examRecent.push({
        id: `exam-${ea.id}`,
        isCorrect: ea.isCorrect,
        createdAt: ea.updatedAt,
        subject: q.subject.name,
        chapter: q.chapter.name,
        publicId: q.publicId,
        source: 'exam',
      })
    }

    // per-mock breakdown: answered/correct/marks per finished attempt (from
    // the same examAnswers rows — unanswered rows skipped), totals per exam
    const answeredByAttempt = new Map<string, number>()
    const correctByAttempt = new Map<string, number>()
    for (const ea of examAnswers) {
      if (ea.selectedOptions === null && ea.numericalValue === null) continue // unattempted
      answeredByAttempt.set(ea.examAttemptId, (answeredByAttempt.get(ea.examAttemptId) ?? 0) + 1)
      if (ea.isCorrect === true) correctByAttempt.set(ea.examAttemptId, (correctByAttempt.get(ea.examAttemptId) ?? 0) + 1)
    }
    const questionsByExam = new Map(examQuestionTotals.map((q) => [q.examId, (q._count as { _all: number })._all]))
    const mocks = finishedAttempts.map((a) => {
      const answered = answeredByAttempt.get(a.id) ?? 0
      const correctN = correctByAttempt.get(a.id) ?? 0
      return {
        id: a.id,
        title: a.exam.title,
        kind: a.exam.kind,
        year: a.exam.year,
        startedAt: a.startedAt.toISOString(),
        status: a.status,
        totalQuestions: questionsByExam.get(a.examId) ?? 0,
        answered,
        correct: correctN,
        accuracy: answered > 0 ? Math.round((correctN / answered) * 100) : 0,
        score: a.totalMarks,
        maxMarks: a.maxMarks,
        timeSpentSeconds: a.timeSpentSeconds ?? 0,
      }
    })

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

    // daily activity (last 14 days) — practice + exam answers
    const dayCounts = new Map<string, number>()
    const recentAttemptsForDays = await prisma.attempt.findMany({
      where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 14) } },
      select: { createdAt: true },
    })
    for (const a of recentAttemptsForDays) {
      const day = a.createdAt.toISOString().slice(0, 10)
      dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1)
    }
    for (const [day, n] of examDayCounts) {
      dayCounts.set(day, (dayCounts.get(day) ?? 0) + n)
    }
    const daily = [...dayCounts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, count]) => ({ date, count }))

    // streak (consecutive active days) — practice attempts + graded exam
    // answers, counted on IST days (the audience's natural day boundary:
    // a 11:30 PM practice session counts for "today", not split across UTC
    // days like the UTC-based daily chart above).
    const istDay = (d: Date) => new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)
    const streakDays = new Set<string>()
    const streakAttempts = await prisma.attempt.findMany({
      where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000) } },
      select: { createdAt: true },
    })
    for (const a of streakAttempts) streakDays.add(istDay(a.createdAt))
    for (const ea of examAnswers) {
      if (ea.selectedOptions === null && ea.numericalValue === null) continue
      streakDays.add(istDay(ea.updatedAt))
    }
    let streakCurrent = 0
    let cursor = new Date(Date.now() + 5.5 * 3600 * 1000) // "now" in IST
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate()))
    if (!streakDays.has(cursor.toISOString().slice(0, 10))) cursor = new Date(cursor.getTime() - 86400 * 1000)
    while (streakDays.has(cursor.toISOString().slice(0, 10))) {
      streakCurrent++
      cursor = new Date(cursor.getTime() - 86400 * 1000)
    }
    let streakBest = 0
    let run = 0
    let prevDay: number | null = null
    for (const d of [...streakDays].sort()) {
      const t = Date.parse(`${d}T00:00:00Z`)
      run = prevDay !== null && t - prevDay === 86400 * 1000 ? run + 1 : 1
      if (run > streakBest) streakBest = run
      prevDay = t
    }
    const streak = {
      current: streakCurrent,
      best: Math.max(streakBest, streakCurrent),
      activeToday: streakDays.has(istDay(new Date())),
    }

    const mergedTotal = total + examAnswered
    const mergedCorrect = correct + examCorrect
    const distinctQuestionIds = new Set<string>([
      ...bySubjectRaw.map((r) => r.questionId),
      ...examQuestionIds,
    ])
    const recentMerged = [
      ...recent.map((a) => ({
        id: a.id,
        isCorrect: a.isCorrect,
        createdAt: a.createdAt,
        subject: a.question.subject.name,
        chapter: a.question.chapter.name,
        publicId: a.question.publicId,
        source: 'practice' as const,
      })),
      ...examRecent,
    ]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 10)

    return Response.json({
      stats: {
        totalAttempts: mergedTotal,
        correct: mergedCorrect,
        accuracy: mergedTotal > 0 ? Math.round((mergedCorrect / mergedTotal) * 100) : 0,
        answeredCount: answeredCount + examAnswered,
        totalTimeSeconds: totalTime,
        bookmarkCount,
        distinctQuestions: distinctQuestionIds.size,
        subjects: subjectStats,
        chapters: chapterStats,
        daily,
        streak,
        examAttempts: examAttemptsRaw,
        mocks,
        recent: recentMerged.map((a) => ({
          ...a,
          createdAt: a.createdAt.toISOString(),
        })),
      },
    })
  } catch (err) {
    return jsonError(err)
  }
}
