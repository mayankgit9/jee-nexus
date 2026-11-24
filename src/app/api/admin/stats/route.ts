import { db } from '@/lib/db'
import { requireAdmin, jsonError } from '@/lib/auth'

/** GET /api/admin/stats — question bank overview: status pipeline, subjects, years, jobs */
export async function GET() {
  try {
    await requireAdmin()

    const [byStatus, bySubject, byYear, totals, jobs] = await Promise.all([
      db.question.groupBy({ by: ['verificationStatus'], _count: { _all: true } }),
      db.question.groupBy({ by: ['subjectId'], _count: { _all: true } }),
      db.question.groupBy({ by: ['sourceYear'], _count: { _all: true }, orderBy: { sourceYear: 'desc' } }),
      Promise.all([
        db.question.count(),
        db.solution.count(),
        db.questionImage.count(),
        db.user.count(),
        db.attempt.count(),
        db.examAttempt.count(),
        db.report.count({ where: { status: 'open' } }),
        db.bookmark.count(),
      ]),
      db.importJob.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
    ])

    const subjects = await db.subject.findMany({ select: { id: true, key: true, name: true } })
    const subjById = new Map(subjects.map((s) => [s.id, s.key]))

    const [questionCount, solutionCount, imageCount, userCount, attemptCount, examAttemptCount, openReports, bookmarkCount] = totals

    return Response.json({
      pipeline: Object.fromEntries(byStatus.map((s) => [s.verificationStatus, s._count._all])),
      subjects: bySubject.map((s) => ({ key: subjById.get(s.subjectId) ?? 'other', count: s._count._all })),
      years: byYear.filter((y) => y.sourceYear !== null).map((y) => ({ year: y.sourceYear, count: y._count._all })),
      totals: {
        questions: questionCount,
        solutions: solutionCount,
        images: imageCount,
        users: userCount,
        practiceAttempts: attemptCount,
        examAttempts: examAttemptCount,
        openReports,
        bookmarks: bookmarkCount,
      },
      importJobs: jobs.map((j) => ({
        id: j.id,
        fileName: j.fileName,
        total: j.totalRows,
        inserted: j.inserted,
        duplicates: j.skippedDuplicate,
        rejected: j.rejected,
        status: j.status,
        createdAt: j.createdAt,
      })),
    })
  } catch (err) {
    return jsonError(err)
  }
}
