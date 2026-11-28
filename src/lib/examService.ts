// JEE NEXUS — exam generation service
// Generates exams from the question bank per pattern + filters; deterministic by seed.
// Custom Test Builder (Part F, 0019): rich mixed-subject/chapter/topic/year/shift/
// difficulty/type/attempt-state filters. Questions are drawn ONLY from the verified
// bank — never fabricated — and never duplicated within one exam.
import { db } from '@/lib/db'
import { JEE_MAIN_2025_PATTERN } from '@/lib/exam'
import type { ExamPatternConfig, SubjectKey } from '@/lib/types'
import { createHash } from 'crypto'
import type { Prisma } from '@prisma/client'

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export async function ensureDefaultPatterns(): Promise<void> {
  // Idempotent bootstrap. A plain findFirst→create pair is NOT safe here:
  // with Hyperdrive's (now disabled) query cache, a stale cached SELECT made
  // every post-create request re-attempt the INSERT and die on P2002 for the
  // cache TTL window; concurrent requests race the same way regardless.
  // upsert() makes both failure modes harmless.
  await db.examPattern.upsert({
    where: { key: 'jee-main-2025' },
    update: {},
    create: {
      key: 'jee-main-2025',
      name: 'JEE Main 2025 pattern',
      description: '75 questions · 180 minutes · +4/-1 MCQ & numerical · partial marking for multiple-correct',
      durationMinutes: 180,
      config: JEE_MAIN_2025_PATTERN as unknown as Prisma.InputJsonValue,
    },
  })
}

/** Custom Test Builder filters (0019). All optional; combined with AND. */
export interface BuilderFilters {
  subjectKeys?: SubjectKey[]
  chapterKeys?: string[]
  topics?: string[]
  difficulties?: string[]
  types?: string[]
  year?: number
  shift?: string
  /** 'unattempted' / 'incorrect' / 'bookmarked' need a user id (server-side only) */
  attemptState?: 'all' | 'unattempted' | 'incorrect' | 'bookmarked'
}

export interface GenerateExamInput {
  title: string
  kind: 'full_length' | 'subject' | 'chapter' | 'custom'
  patternKey?: string
  subjectKey?: SubjectKey
  chapterKey?: string
  year?: number
  durationMinutes?: number
  questionsPerSubject?: number
  seed?: number
  /** Custom Test Builder (0019) */
  filters?: BuilderFilters
  /** Total question target — divided across the selected subjects */
  totalQuestions?: number
  userId?: string
}

const VALID_SUBJECTS: SubjectKey[] = ['physics', 'chemistry', 'mathematics']
const VALID_DIFFICULTIES: string[] = ['easy', 'medium', 'hard']
const VALID_TYPES: string[] = ['mcq_single', 'mcq_multi', 'numerical']

/** Pool where-clause for a subject under the builder filters. */
function poolWhere(subjectKey: SubjectKey, f: BuilderFilters | undefined, legacy: { chapterKey?: string; year?: number }): Prisma.QuestionWhereInput {
  const where: Prisma.QuestionWhereInput = {
    subject: { key: subjectKey },
    verificationStatus: { not: 'rejected' },
  }
  if (legacy.chapterKey) where.chapter = { key: legacy.chapterKey }
  if (legacy.year) where.sourceYear = legacy.year
  if (f) {
    if (f.chapterKeys?.length) {
      // intersect legacy single chapter with the list when both present
      where.chapter = legacy.chapterKey
        ? { key: legacy.chapterKey }
        : { key: { in: f.chapterKeys } }
    }
    if (f.topics?.length) where.subtopic = { in: f.topics }
    if (f.difficulties?.length) {
      const ds = f.difficulties.filter((d) => VALID_DIFFICULTIES.includes(d))
      if (ds.length) where.difficulty = { in: ds as ('easy' | 'medium' | 'hard')[] }
    }
    if (f.types?.length) {
      const ts = f.types.filter((t) => VALID_TYPES.includes(t))
      if (ts.length) where.type = { in: ts as ('mcq_single' | 'mcq_multi' | 'numerical')[] }
    }
    if (f.year) where.sourceYear = f.year
    if (f.shift) where.sourceShift = f.shift
  }
  return where
}

/** Generates an Exam from the live question bank (never fabricates questions). */
export async function generateExam(input: GenerateExamInput): Promise<{ examId: string; warnings: string[] }> {
  const warnings: string[] = []
  const pattern =
    (await db.examPattern.findUnique({ where: { key: input.patternKey ?? 'jee-main-2025' } })) ??
    (await db.examPattern.findUnique({ where: { key: 'jee-main-2025' } }))
  if (!pattern) throw new Error('Exam pattern missing')

  const config = pattern.config as unknown as ExamPatternConfig
  const seed = input.seed ?? Date.now()
  const rand = mulberry32(seed)

  // ---- section subjects ----
  const builderSubjects = input.filters?.subjectKeys?.filter((s) => VALID_SUBJECTS.includes(s)) ?? []
  const sectionKeys: SubjectKey[] = builderSubjects.length
    ? builderSubjects
    : input.subjectKey
      ? [input.subjectKey]
      : config.sections.map((s) => s.key as SubjectKey)

  // ---- per-subject question counts ----
  let perSubject = input.questionsPerSubject ?? config.sections[0]?.questionCount ?? 25
  if (input.totalQuestions) {
    const total = Math.min(Math.max(input.totalQuestions, 1), 90)
    perSubject = Math.max(1, Math.ceil(total / sectionKeys.length))
  }

  const durationMinutes =
    input.durationMinutes ?? (sectionKeys.length === 1 ? Math.round(pattern.durationMinutes / 3) : pattern.durationMinutes)

  const exam = await db.exam.create({
    data: {
      title: input.title,
      description: `Auto-generated from the verified question bank (seed ${seed}).`,
      kind: input.kind,
      patternId: pattern.id,
      subjectKey: input.subjectKey ?? (sectionKeys.length === 1 ? sectionKeys[0] : null),
      year: input.year ?? input.filters?.year ?? null,
      config: { ...input, seed, perSubject, durationMinutes } as unknown as Prisma.InputJsonValue,
      isPublished: true,
    },
  })

  // ---- attempt-state exclusion lists (needs the server-side user id) ----
  let excludeIds: string[] = []
  let includeIds: string[] | null = null
  const state = input.filters?.attemptState ?? 'all'
  if (state !== 'all' && input.userId) {
    if (state === 'unattempted') {
      const attempted = await db.attempt.findMany({
        where: { userId: input.userId },
        select: { questionId: true },
        take: 5000,
      })
      const viaExam = await db.examAttemptAnswer.findMany({
        where: { examAttempt: { userId: input.userId } },
        select: { examQuestion: { select: { questionId: true } } },
        take: 8000,
      })
      excludeIds = [...new Set([...attempted.map((a) => a.questionId), ...viaExam.map((v) => v.examQuestion.questionId)])]
    } else if (state === 'incorrect') {
      const wrongPractice = await db.attempt.findMany({
        where: { userId: input.userId, isCorrect: false },
        select: { questionId: true },
        take: 5000,
      })
      const wrongExam = await db.examAttemptAnswer.findMany({
        where: { examAttempt: { userId: input.userId }, isCorrect: false },
        select: { examQuestion: { select: { questionId: true } } },
        take: 8000,
      })
      includeIds = [...new Set([...wrongPractice.map((a) => a.questionId), ...wrongExam.map((v) => v.examQuestion.questionId)])]
      if (includeIds.length === 0) warnings.push('No incorrect questions found for this account yet — test would be empty.')
    } else if (state === 'bookmarked') {
      const marks = await db.bookmark.findMany({
        where: { userId: input.userId },
        select: { questionId: true },
        take: 5000,
      })
      includeIds = marks.map((m) => m.questionId)
      if (includeIds.length === 0) warnings.push('No bookmarked questions yet — bookmark some questions first.')
    }
  }

  const examId = exam.id
  let order = 0
  const rows: { examId: string; questionId: string; order: number; section: string; sectionOrder: number }[] = []
  const usedIds = new Set<string>() // no duplicate questions within a test — ever

  for (let s = 0; s < sectionKeys.length; s++) {
    const sk = sectionKeys[s]
    let where = poolWhere(sk, input.filters, { chapterKey: input.chapterKey, year: input.year })
    if (excludeIds.length) {
      const existing = (where.id ?? {}) as { notIn?: string[] }
      where.id = { notIn: [...(existing.notIn ?? []), ...excludeIds] }
    }
    if (includeIds) {
      // restrict the pool to the user's own list (still filtered by subject
      // etc. — an honest intersection)
      const inSubject = includeIds
      where = { ...where, id: { in: inSubject } }
    }

    const pool = await db.question.findMany({
      where,
      select: { id: true },
      take: 20_000,
    })
    // pool must cover the WHOLE matching bank: a small `take` without ORDER BY
    // returns rows in physical (insertion) order — with year-clustered imports
    // every mock would silently draw from the same oldest year.
    const shuffled = pool.map((q) => ({ q, r: rand() })).sort((a, b) => a.r - b.r)
    const chosen = shuffled.slice(0, perSubject).map((x) => x.q.id)
    if (chosen.length < perSubject) {
      warnings.push(
        `${sk}: only ${chosen.length} questions available (wanted ${perSubject}) — exam shortened honestly.`
      )
    }
    for (const qid of chosen) {
      if (usedIds.has(qid)) continue // duplicate guard across sections
      usedIds.add(qid)
      rows.push({ examId, questionId: qid, order: order++, section: sk, sectionOrder: s })
    }
  }

  // Single multi-row INSERT: per-row create() calls blew past the Workers
  // subrequest cap (50/invocation) for full-length 75-question exams —
  // "Too many subrequests by single Worker invocation".
  await db.examQuestion.createMany({ data: rows })

  const total = rows.length
  if (total === 0) {
    await db.exam.delete({ where: { id: examId } })
    throw new Error('No questions available for this exam configuration')
  }
  return { examId, warnings }
}

/** Compute a stable key so "default" exams aren't regenerated on every request */
export function stableExamKey(input: GenerateExamInput): string {
  return createHash('sha1').update(JSON.stringify(input)).digest('hex').slice(0, 12)
}
