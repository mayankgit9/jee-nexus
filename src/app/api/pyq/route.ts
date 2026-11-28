import { NextRequest } from 'next/server'
import { db, dbClient } from '@/lib/db'
import { getSessionUser, jsonError } from '@/lib/auth'
import { toPublicQuestion } from '@/lib/questions'
import { Prisma } from '@prisma/client'
import type { Difficulty, QuestionType } from '@prisma/client'

/**
 * PYQ library:
 *  GET /api/pyq                          -> year overview (+ counts per subject)
 *  GET /api/pyq?q=term[&page=1]          -> full-text search across the bank (flat list)
 *  GET /api/pyq?year=2023                -> subject->chapter breakdown for the year (+ user progress)
 *  GET /api/pyq?year=2023&subject=physics [&chapter=...&shift=...&difficulty=...&type=...&page=1] -> question list
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const yearParam = sp.get('year')
    const user = await getSessionUser()
    // one client/connection for the whole request (fresh-client-per-access
    // Proxy semantics would pay ~300ms TCP+auth per query through Hyperdrive)
    const prisma = dbClient()

    // ---- Search mode (flat results across the bank; optional year/subject narrow) ----
    const search = (sp.get('q') ?? '').trim()
    if (search) {
      if (search.length < 3) {
        return Response.json({ error: 'Search term must be at least 3 characters' }, { status: 400 })
      }
      const sYear = yearParam ? Number(yearParam) : null
      const sWhere: Prisma.QuestionWhereInput = {
        verificationStatus: { not: 'rejected' },
        text: { contains: search, mode: 'insensitive' },
        ...(sYear !== null && Number.isInteger(sYear) && sYear > 1900 ? { sourceYear: sYear } : {}),
        ...(sp.get('subject') && ['physics', 'chemistry', 'mathematics'].includes(sp.get('subject')!)
          ? { subject: { key: sp.get('subject')! } }
          : {}),
      }
      const sPageRaw = Number(sp.get('page') ?? 1)
      const sPage = Number.isInteger(sPageRaw) && sPageRaw >= 1 ? sPageRaw : 1
      const pageSize = 10
      const [sTotal, sQuestions] = await Promise.all([
        prisma.question.count({ where: sWhere }),
        prisma.question.findMany({
          where: sWhere,
          include: {
            subject: true,
            chapter: true,
            options: true,
            images: { where: { hidden: false } },
            ...(user ? { bookmarks: { where: { userId: user.id }, select: { id: true } } } : {}),
          },
          orderBy: [{ sourceYear: 'desc' }, { sourceShift: 'asc' }, { sourceQuestionNumber: 'asc' }],
          skip: (sPage - 1) * pageSize,
          take: pageSize,
        }),
      ])
      return Response.json({
        search: search.slice(0, 80),
        total: sTotal,
        page: sPage,
        pageCount: Math.max(1, Math.ceil(sTotal / pageSize)),
        questions: sQuestions.map(toPublicQuestion),
      })
    }

    // ---- Year overview ----
    if (!yearParam) {
      const rows = await prisma.question.groupBy({
        by: ['sourceYear', 'subjectId'],
        where: { verificationStatus: { not: 'rejected' } },
        _count: { _all: true },
      })
      const subjects = await prisma.subject.findMany({ select: { id: true, key: true, name: true } })
      const subjById = new Map(subjects.map((s) => [s.id, s]))

      const years = new Map<number, { total: number; subjects: Record<string, number> }>()
      for (const r of rows) {
        if (r.sourceYear === null) continue
        const y = years.get(r.sourceYear) ?? { total: 0, subjects: {} }
        const sk = subjById.get(r.subjectId)?.key ?? 'other'
        y.subjects[sk] = (y.subjects[sk] ?? 0) + r._count._all
        y.total += r._count._all
        years.set(r.sourceYear, y)
      }
      return Response.json({
        years: [...years.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([year, v]) => ({ year, total: v.total, subjects: v.subjects })),
      })
    }

    const year = Number(yearParam)
    if (isNaN(year)) return Response.json({ error: 'Invalid year' }, { status: 400 })

    // ---- Subject -> chapter breakdown for a year ----
    const subjectParam = sp.get('subject')
    if (!subjectParam) {
      const chapters = await prisma.chapter.findMany({
        where: { questions: { some: { sourceYear: year, verificationStatus: { not: 'rejected' } } } },
        include: {
          subject: true,
          _count: { select: { questions: { where: { sourceYear: year, verificationStatus: { not: 'rejected' } } } } },
        },
        orderBy: { order: 'asc' },
      })

      // user progress per chapter (if logged in)
      const progressByChapter = new Map<string, { attempted: number; correct: number }>()
      if (user) {
        const attempts = await prisma.attempt.findMany({
          where: { userId: user.id, question: { sourceYear: year } },
          select: { isCorrect: true, question: { select: { chapterId: true } } },
        })
        for (const a of attempts) {
          const p = progressByChapter.get(a.question.chapterId) ?? { attempted: 0, correct: 0 }
          p.attempted++
          if (a.isCorrect === true) p.correct++
          progressByChapter.set(a.question.chapterId, p)
        }
      }

      const bySubject = new Map<string, { name: string; chapters: unknown[] }>()
      for (const c of chapters) {
        const entry = bySubject.get(c.subject.key) ?? { name: c.subject.name, chapters: [] }
        const p = progressByChapter.get(c.id) ?? { attempted: 0, correct: 0 }
        entry.chapters.push({
          key: c.key,
          name: c.name,
          unit: c.unit,
          questionCount: c._count.questions,
          attempted: p.attempted,
          accuracy: p.attempted > 0 ? Math.round((p.correct / p.attempted) * 100) : null,
        })
        bySubject.set(c.subject.key, entry)
      }
      return Response.json({
        year,
        subjects: [...bySubject.entries()].map(([key, v]) => ({ key, name: v.name, chapters: v.chapters })),
      })
    }

    // ---- Question list for year + subject (+filters) ----
    const where: Prisma.QuestionWhereInput = {
      sourceYear: year,
      verificationStatus: { not: 'rejected' },
      subject: { key: subjectParam },
    }
    // strict enum validation — an invalid filter is a client error (400),
    // not a Prisma cast crash (500)
    const chapter = sp.get('chapter')
    if (chapter) where.chapter = { key: chapter }
    const shift = sp.get('shift')
    if (shift) where.sourceShift = shift
    const difficulty = sp.get('difficulty')
    if (difficulty) {
      if (!['easy', 'medium', 'hard'].includes(difficulty)) {
        return Response.json({ error: 'Invalid difficulty filter' }, { status: 400 })
      }
      where.difficulty = difficulty as Difficulty
    }
    const type = sp.get('type')
    if (type) {
      if (!['mcq_single', 'mcq_multi', 'numerical'].includes(type)) {
        return Response.json({ error: 'Invalid type filter' }, { status: 400 })
      }
      where.type = type as QuestionType
    }

    const pageRaw = Number(sp.get('page') ?? 1)
    if (!Number.isInteger(pageRaw) || pageRaw < 1) {
      return Response.json({ error: 'Invalid page' }, { status: 400 })
    }
    const page = pageRaw
    const pageSize = 10

    const [total, questions] = await Promise.all([
      prisma.question.count({ where }),
      prisma.question.findMany({
        where,
        include: {
          subject: true,
          chapter: true,
          options: true,
          images: { where: { hidden: false } },
          ...(user ? { bookmarks: { where: { userId: user.id }, select: { id: true } } } : {}),
        },
        orderBy: [{ sourceShift: 'asc' }, { sourceQuestionNumber: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])

    return Response.json({
      year,
      subject: subjectParam,
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      questions: questions.map(toPublicQuestion),
    })
  } catch (err) {
    return jsonError(err)
  }
}
