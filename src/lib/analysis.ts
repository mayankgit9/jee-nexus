// JEE NEXUS — mock-test analytics engine (Part E)
// All observations are computed from the user's OWN attempt data — no
// invented statistics, no generic statements. Built on top of the existing
// CBT engine's records (exam_attempts + exam_attempt_answers with per-question
// time already tracked).
import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'

type AnswerRow = {
  isCorrect: boolean | null
  marksAwarded: number | null
  timeSpentSeconds: number
  selectedOptions: Prisma.JsonValue | null
  numericalValue: string | null
  examQuestion: {
    order: number
    section: string
    question: {
      id: string
      publicId: string
      type: string
      difficulty: string
      chapter: { key: string; name: string }
      subject: { key: string }
    }
  }
}

export interface SelectionObservation {
  questionId: string
  publicId: string
  section: string
  chapterName: string
  order: number
  timeSpentSeconds: number
  yourAverageSeconds: number | null
  problem: 'slow_and_wrong' | 'slow_but_right' | 'fast_and_wrong'
  message: string
}

/** Aggregate analytics for one submitted exam attempt. */
export async function computeExamAnalytics(userId: string, attemptId: string) {
  const attempt = await db.examAttempt.findUnique({
    where: { id: attemptId },
    include: {
      exam: { select: { title: true, kind: true, config: true } },
      answers: {
        include: {
          examQuestion: {
            include: {
              question: {
                select: {
                  id: true, publicId: true, type: true, difficulty: true,
                  chapter: { select: { key: true, name: true } },
                  subject: { select: { key: true } },
                },
              },
            },
          },
        },
      },
    },
  })
  if (!attempt || attempt.userId !== userId) return null
  if (attempt.status === 'in_progress') return { inProgress: true as const }

  const answers = attempt.answers as unknown as AnswerRow[]

  // ---------- score analysis ----------
  const subjectScore: Record<string, { marks: number; correct: number; incorrect: number; unattempted: number; negative: number; time: number; total: number }> = {}
  const chapterAgg: Record<string, { name: string; subject: string; correct: number; incorrect: number; unattempted: number; marks: number; negative: number; time: number; total: number }> = {}
  let totalMarks = 0
  let totalCorrect = 0
  let totalIncorrect = 0
  let totalUnattempted = 0
  let totalNegative = 0

  for (const a of answers) {
    const sec = a.examQuestion.section
    const chKey = a.examQuestion.question.chapter.key
    const ch = a.examQuestion.question.chapter
    subjectScore[sec] = subjectScore[sec] ?? { marks: 0, correct: 0, incorrect: 0, unattempted: 0, negative: 0, time: 0, total: 0 }
    chapterAgg[chKey] = chapterAgg[chKey] ?? { name: ch.name, subject: sec, correct: 0, incorrect: 0, unattempted: 0, marks: 0, negative: 0, time: 0, total: 0 }

    const attempted = a.isCorrect !== null && a.marksAwarded !== null
    const marks = a.marksAwarded ?? 0
    subjectScore[sec].total++
    chapterAgg[chKey].total++
    subjectScore[sec].marks += marks
    subjectScore[sec].time += a.timeSpentSeconds
    chapterAgg[chKey].marks += marks
    chapterAgg[chKey].time += a.timeSpentSeconds
    totalMarks += marks
    if (!attempted) {
      subjectScore[sec].unattempted++
      chapterAgg[chKey].unattempted++
      totalUnattempted++
    } else if (a.isCorrect === true) {
      subjectScore[sec].correct++
      chapterAgg[chKey].correct++
      totalCorrect++
    } else {
      subjectScore[sec].incorrect++
      chapterAgg[chKey].incorrect++
      totalIncorrect++
      if (marks < 0) {
        subjectScore[sec].negative += marks
        chapterAgg[chKey].negative += marks
        totalNegative += marks
      }
    }
  }

  const maxMarks = (attempt.maxMarks ?? answers.length * 4) || 0
  const attempted = totalCorrect + totalIncorrect
  const accuracy = attempted > 0 ? Math.round((100 * totalCorrect) / attempted) : 0
  const percentage = maxMarks > 0 ? Math.round((100 * totalMarks) / maxMarks) : 0

  // ---------- time analysis ----------
  const perQuestion = answers.map((a) => ({
    questionId: a.examQuestion.question.id,
    publicId: a.examQuestion.question.publicId,
    order: a.examQuestion.order,
    section: a.examQuestion.section,
    chapterName: a.examQuestion.question.chapter.name,
    type: a.examQuestion.question.type,
    seconds: a.timeSpentSeconds,
    isCorrect: a.isCorrect,
    attempted: a.isCorrect !== null,
  }))
  const avgSeconds = perQuestion.length ? Math.round(perQuestion.reduce((s, q) => s + q.seconds, 0) / perQuestion.length) : 0
  const totalTime = perQuestion.reduce((s, q) => s + q.seconds, 0)

  // The user's own historical average per (type, difficulty) from practice +
  // every graded mock — the honest baseline for "question type" comparisons.
  const [practiceTimes, examTimes] = await Promise.all([
    db.attempt.findMany({
      where: { userId, isCorrect: { not: null } },
      select: { timeSpentSeconds: true, question: { select: { type: true, difficulty: true } } },
      take: 2000,
      orderBy: { createdAt: 'desc' },
    }),
    db.examAttemptAnswer.findMany({
      where: { examAttempt: { userId, status: { not: 'in_progress' } }, isCorrect: { not: null } },
      select: { timeSpentSeconds: true, examQuestion: { select: { question: { select: { type: true, difficulty: true } } } } },
      take: 3000,
    }),
  ])
  const typeStats: Record<string, { sum: number; n: number }> = {}
  for (const p of practiceTimes) {
    const k = `${p.question.type}|${p.question.difficulty}`
    typeStats[k] = typeStats[k] ?? { sum: 0, n: 0 }
    typeStats[k].sum += p.timeSpentSeconds
    typeStats[k].n++
  }
  for (const e of examTimes) {
    const k = `${e.examQuestion.question.type}|${e.examQuestion.question.difficulty}`
    typeStats[k] = typeStats[k] ?? { sum: 0, n: 0 }
    typeStats[k].sum += e.timeSpentSeconds
    typeStats[k].n++
  }
  const typeAverage = Object.fromEntries(
    Object.entries(typeStats).map(([k, v]) => [k, v.n > 0 ? Math.round(v.sum / v.n) : null])
  )
  const avgByType: Record<string, number> = {}
  for (const [k, v] of Object.entries(typeStats)) {
    const type = k.split('|')[0]
    avgByType[type] = (avgByType[type] ?? 0) + (v.n > 0 ? Math.round(v.sum / v.n) : 0)
  }

  // Question selection analysis: flag genuinely inefficient choices.
  // Thresholds: 2.5× the user's own average for that question type AND at
  // least 90 s spent — every observation quotes real numbers.
  const observations: SelectionObservation[] = []
  for (const q of perQuestion) {
    if (!q.attempted || q.seconds < 90) continue
    const avgForType = avgByType[q.type] || null
    if (!avgForType || avgForType < 20 || q.seconds < avgForType * 2.5) continue
    const kind: SelectionObservation['problem'] = q.isCorrect === false ? 'slow_and_wrong' : 'slow_but_right'
    const min = Math.round(q.seconds / 60)
    const avgMin = Math.max(1, Math.round(avgForType / 60))
    observations.push({
      questionId: q.questionId,
      publicId: q.publicId,
      section: q.section,
      chapterName: q.chapterName,
      order: q.order,
      timeSpentSeconds: q.seconds,
      yourAverageSeconds: avgForType,
      problem: kind,
      message:
        kind === 'slow_and_wrong'
          ? `You spent ${min} min on this question but answered it incorrectly — your own average for this question type is about ${avgMin} min.`
          : `Correct, but this took ${min} min versus your ~${avgMin} min average for this question type — consider deferring it.`,
    })
  }
  observations.sort((a, b) => b.timeSpentSeconds - a.timeSpentSeconds)

  // ---------- chapter analysis ----------
  const chapters = Object.entries(chapterAgg).map(([key, c]) => ({
    key,
    name: c.name,
    subject: c.subject,
    total: c.total,
    correct: c.correct,
    incorrect: c.incorrect,
    unattempted: c.unattempted,
    marks: Math.round(c.marks * 100) / 100,
    negative: Math.round(c.negative * 100) / 100,
    time: c.time,
    accuracy: c.correct + c.incorrect > 0 ? Math.round((100 * c.correct) / (c.correct + c.incorrect)) : null,
  }))
  const graded = chapters.filter((c) => c.correct + c.incorrect >= 2)
  const byAccuracy = [...graded].sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0))
  const byNegative = [...graded].sort((a, b) => a.negative - b.negative)
  const weakest = byAccuracy.slice(0, 3)
  const strongest = [...byAccuracy].reverse().slice(0, 3)
  const mostNegative = byNegative.filter((c) => c.negative < 0).slice(0, 3)

  return {
    inProgress: false as const,
    attempt: {
      id: attempt.id,
      examTitle: attempt.exam.title,
      kind: attempt.exam.kind,
      submittedAt: attempt.submittedAt,
      timeSpentSeconds: attempt.timeSpentSeconds,
    },
    score: {
      totalMarks: Math.round(totalMarks * 100) / 100,
      maxMarks,
      percentage,
      accuracy,
      correct: totalCorrect,
      incorrect: totalIncorrect,
      unattempted: totalUnattempted,
      negative: Math.round(totalNegative * 100) / 100,
      subjects: Object.entries(subjectScore).map(([key, s]) => ({
        key,
        marks: Math.round(s.marks * 100) / 100,
        max: s.total * 4,
        correct: s.correct,
        incorrect: s.incorrect,
        unattempted: s.unattempted,
        negative: Math.round(s.negative * 100) / 100,
        accuracy: s.correct + s.incorrect > 0 ? Math.round((100 * s.correct) / (s.correct + s.incorrect)) : 0,
        time: s.time,
      })),
    },
    time: {
      total: totalTime,
      averagePerQuestion: avgSeconds,
      perQuestion,
      typeAverage,
      slowest: [...perQuestion].sort((a, b) => b.seconds - a.seconds).slice(0, 5),
    },
    chapters: { all: chapters, weakest, strongest, mostNegative, needsRevision: weakest },
    selection: { observations: observations.slice(0, 8) },
  }
}

/** Cross-mock historical trends for the signed-in student. */
export async function computeHistoryTrends(userId: string) {
  const attempts = await db.examAttempt.findMany({
    where: { userId, status: { not: 'in_progress' } },
    orderBy: { submittedAt: 'asc' },
    take: 60,
    include: {
      answers: { select: { isCorrect: true, marksAwarded: true, timeSpentSeconds: true, examQuestion: { select: { section: true, question: { select: { chapter: { select: { key: true, name: true } } } } } } } },
      exam: { select: { title: true, kind: true } },
    },
  })

  const timeline = attempts.map((a, i) => {
    const graded = a.answers.filter((x) => x.isCorrect !== null)
    const correct = a.answers.filter((x) => x.isCorrect === true).length
    const incorrect = graded.length - correct
    const negative = a.answers.reduce((s, x) => s + (x.marksAwarded !== null && x.marksAwarded < 0 ? x.marksAwarded : 0), 0)
    const time = a.answers.reduce((s, x) => s + x.timeSpentSeconds, 0)
    return {
      index: i + 1,
      attemptId: a.id,
      title: a.exam.title,
      kind: a.exam.kind,
      submittedAt: a.submittedAt,
      totalMarks: a.totalMarks ?? 0,
      maxMarks: a.maxMarks ?? 0,
      accuracy: graded.length > 0 ? Math.round((100 * correct) / graded.length) : null,
      correct,
      incorrect,
      negative: Math.round(negative * 100) / 100,
      avgSecondsPerQuestion: a.answers.length > 0 ? Math.round(time / a.answers.length) : null,
      subjects: ['physics', 'chemistry', 'mathematics'].map((sk) => {
        const rows = a.answers.filter((x) => x.examQuestion.section === sk)
        const g = rows.filter((x) => x.isCorrect !== null)
        const c = rows.filter((x) => x.isCorrect === true).length
        return {
          key: sk,
          marks: Math.round(rows.reduce((s, x) => s + (x.marksAwarded ?? 0), 0) * 100) / 100,
          accuracy: g.length > 0 ? Math.round((100 * c) / g.length) : null,
        }
      }),
    }
  })

  // chapter performance over time (chapter → per-attempt accuracy)
  const chapterTrends: Record<string, { name: string; points: { attemptIndex: number; accuracy: number | null }[] }> = {}
  attempts.forEach((a, i) => {
    const byChapter = new Map<string, { c: number; g: number }>()
    for (const ans of a.answers) {
      const key = ans.examQuestion.question.chapter.key
      const e = byChapter.get(key) ?? { c: 0, g: 0 }
      if (ans.isCorrect !== null) e.g++
      if (ans.isCorrect === true) e.c++
      byChapter.set(key, e)
    }
    for (const [key, e] of byChapter) {
      chapterTrends[key] = chapterTrends[key] ?? { name: key, points: [] }
      chapterTrends[key].points.push({ attemptIndex: i + 1, accuracy: e.g > 0 ? Math.round((100 * e.c) / e.g) : null })
    }
  })
  // resolve chapter display names once
  const chapterNames = await db.chapter.findMany({ select: { key: true, name: true } })
  const nameById = new Map(chapterNames.map((c) => [c.key, c.name]))
  for (const t of Object.values(chapterTrends)) t.name = nameById.get(t.name) ?? t.name

  return { timeline, chapterTrends }
}
