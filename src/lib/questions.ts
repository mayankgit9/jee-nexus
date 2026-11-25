// JEE NEXUS — question serialization + selection services
import { createHash } from 'crypto'
import { db, dbClient } from '@/lib/db'
import type { Prisma, Difficulty, QuestionType } from '@prisma/client'
import type { PublicQuestion, QuestionSolution } from '@/lib/types'

/** Json columns (jsonb) already arrive parsed — coerce safely to string[] */
function asStringArray(v: Prisma.JsonValue | null | undefined): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

type QuestionWithRelations = Prisma.QuestionGetPayload<{
  include: {
    subject: true
    chapter: true
    options: true
    images: true
    bookmarks?: boolean
  }
}>

export function toPublicQuestion(q: QuestionWithRelations): PublicQuestion {
  const bookmarked = q.bookmarks ? q.bookmarks.length > 0 : false
  return {
    id: q.id,
    publicId: q.publicId,
    subject: { key: q.subject.key as PublicQuestion['subject']['key'], name: q.subject.name },
    chapter: { key: q.chapter.key, name: q.chapter.name, unit: q.chapter.unit ?? undefined },
    subtopic: q.subtopic ?? undefined,
    type: q.type as PublicQuestion['type'],
    text: q.text,
    // Options WITHOUT isCorrect — the answer never ships to the client
    options: [...q.options]
      .sort((a, b) => a.idx - b.idx)
      .map((o) => ({ idx: o.idx, text: o.text })),
    difficulty: q.difficulty as PublicQuestion['difficulty'],
    sourceExam: q.sourceExam,
    sourceYear: q.sourceYear ?? undefined,
    sourceDate: q.sourceDate ?? undefined,
    sourceShift: q.sourceShift ?? undefined,
    sourceQuestionNumber: q.sourceQuestionNumber ?? undefined,
    verificationStatus: q.verificationStatus as PublicQuestion['verificationStatus'],
    tags: asStringArray(q.tags),
    images: [...q.images]
      .filter((i) => i.kind === 'question')
      .sort((a, b) => a.order - b.order)
      .map((i) => ({
        url: i.url,
        altText: i.altText,
        caption: i.caption ?? undefined,
        attribution: i.attribution ?? undefined,
        isOriginalExamImage: i.isOriginalExamImage,
      })),
    bookmarked,
  }
}

type SolutionWithImages = Prisma.SolutionGetPayload<{
  include: { question: { include: { images: true } } }
}>

export function toPublicSolution(s: SolutionWithImages): QuestionSolution {
  return {
    keyConcept: s.keyConcept ?? undefined,
    formulas: asStringArray(s.formulas),
    body: s.body,
    commonMistakes: s.commonMistakes ?? undefined,
    alternativeMethod: s.alternativeMethod ?? undefined,
    verification: s.verification ?? undefined,
    isAiGenerated: s.isAiGenerated,
    sourceReferences: asStringArray(s.sourceReferences),
    solutionImages: s.question.images
      .filter((i) => i.kind === 'solution')
      .map((i) => ({ url: i.url, altText: i.altText, caption: i.caption ?? undefined })),
  }
}

/** Normalized content hash for duplicate detection (import pipeline + inserts) */
export function computeContentHash(text: string, subjectKey: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[$\\{}]/g, '')
    .trim()
  return createHash('sha256')
    .update(`${subjectKey}::${normalized}`)
    .digest('hex')
}

export interface RandomFilters {
  subject?: string
  chapterKeys?: string[]
  years?: number[]
  difficulties?: string[]
  types?: string[]
  count?: number
  excludeQuestionIds?: string[]
  userId?: string
  includeAttempted?: boolean
}

const VALID_DIFFICULTIES = ['easy', 'medium', 'hard'] as const
const VALID_TYPES = ['mcq_single', 'mcq_multi', 'numerical'] as const

/**
 * Random question selection with repeat avoidance:
 * - excludes question ids passed by the client session (recently served)
 * - for logged-in users, optionally excludes recently attempted questions (last 14 days)
 * unless revision mode is requested.
 */
export async function selectRandomQuestions(f: RandomFilters): Promise<PublicQuestion[]> {
  // non-finite counts (NaN from garbage input) would make Prisma `take` blow up
  const count = Math.min(Math.max(Number.isFinite(f.count) ? (f.count as number) : 1, 1), 20)

  // drop invalid enum values instead of letting Postgres reject the whole query
  const difficulties = f.difficulties?.filter((d): d is Difficulty =>
    (VALID_DIFFICULTIES as readonly string[]).includes(d)
  )
  const types = f.types?.filter((t): t is QuestionType => (VALID_TYPES as readonly string[]).includes(t))

  const where: Prisma.QuestionWhereInput = {
    verificationStatus: { not: 'rejected' },
  }
  if (f.subject && f.subject !== 'all') where.subject = { key: f.subject }
  if (f.chapterKeys?.length) where.chapter = { key: { in: f.chapterKeys } }
  if (f.years?.length) where.sourceYear = { in: f.years }
  if (difficulties?.length) where.difficulty = { in: difficulties }
  if (types?.length) where.type = { in: types }

  if (f.excludeQuestionIds?.length) {
    where.id = { notIn: f.excludeQuestionIds }
  }

  // One client/connection for the whole selection (the db Proxy opens a
  // fresh connection per access — ~300ms each through Hyperdrive; this
  // function makes up to 3 sequential queries).
  const prisma = dbClient()

  // Repeat avoidance for logged-in users (unless revision requested)
  if (f.userId && f.includeAttempted === false) {
    const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 14)
    const recentAttempts = await prisma.attempt.findMany({
      where: { userId: f.userId, createdAt: { gte: since } },
      select: { questionId: true },
      take: 800,
      orderBy: { createdAt: 'desc' },
    })
    const attemptedIds = recentAttempts.map((a) => a.questionId)
    const merged = [...new Set([...(f.excludeQuestionIds ?? []), ...attemptedIds])]
    if (merged.length) {
      const existing = (where.id ?? {}) as { notIn?: string[] }
      where.id = { notIn: [...(existing.notIn ?? []), ...merged] }
    }
  }

  // Candidate pool: fetch ALL matching ids, then Fisher–Yates sample in JS.
  // A `take: N` without ORDER BY returns rows in physical (insertion) order —
  // practice would be biased to whatever was imported first (year clustering).
  // The bank is ~6k rows; id-only select keeps the payload small. The cap is
  // just a runaway guard for a future much larger bank.
  const pool = await prisma.question.findMany({
    where,
    select: { id: true },
    take: 50_000,
  })
  if (pool.length === 0) return []
  // Fisher-Yates sample
  const shuffled = pool
    .map((q) => ({ q, r: Math.random() }))
    .sort((a, b) => a.r - b.r)
    .slice(0, count)
    .map((x) => x.q.id)

  const questions = await prisma.question.findMany({
    where: { id: { in: shuffled } },
    include: {
      subject: true,
      chapter: true,
      options: true,
      images: true,
      ...(f.userId ? { bookmarks: { where: { userId: f.userId }, select: { id: true } } } : {}),
    },
  })
  // preserve sampled order
  const byId = new Map(questions.map((q) => [q.id, q]))
  return shuffled.map((id) => byId.get(id)!).filter(Boolean).map(toPublicQuestion)
}
