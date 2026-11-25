// JEE NEXUS — exam generation service
// Generates exams from the question bank per pattern + filters; deterministic by seed.
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

  const sectionKeys: SubjectKey[] = input.subjectKey
    ? [input.subjectKey]
    : config.sections.map((s) => s.key as SubjectKey)

  const perSubject = input.questionsPerSubject ?? config.sections[0]?.questionCount ?? 25
  const durationMinutes =
    input.durationMinutes ?? (sectionKeys.length === 1 ? Math.round(pattern.durationMinutes / 3) : pattern.durationMinutes)

  const exam = await db.exam.create({
    data: {
      title: input.title,
      description: `Auto-generated from the verified question bank (seed ${seed}).`,
      kind: input.kind,
      patternId: pattern.id,
      subjectKey: input.subjectKey ?? null,
      year: input.year ?? null,
      config: { ...input, seed, perSubject, durationMinutes } as unknown as Prisma.InputJsonValue,
      isPublished: true,
    },
  })

  let order = 0
  const rows: { examId: string; questionId: string; order: number; section: string; sectionOrder: number }[] = []
  for (let s = 0; s < sectionKeys.length; s++) {
    const sk = sectionKeys[s]
    const where = {
      subject: { key: sk },
      verificationStatus: { not: 'rejected' as const },
      ...(input.chapterKey ? { chapter: { key: input.chapterKey } } : {}),
      ...(input.year ? { sourceYear: input.year } : {}),
    }
    const pool = await db.question.findMany({ where, select: { id: true }, take: 20_000 })
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
      rows.push({ examId: exam.id, questionId: qid, order: order++, section: sk, sectionOrder: s })
    }
  }

  // Single multi-row INSERT: per-row create() calls blew past the Workers
  // subrequest cap (50/invocation) for full-length 75-question exams —
  // "Too many subrequests by single Worker invocation".
  await db.examQuestion.createMany({ data: rows })

  const total = rows.length
  if (total === 0) {
    await db.exam.delete({ where: { id: exam.id } })
    throw new Error('No questions available for this exam configuration')
  }
  return { examId: exam.id, warnings }
}

/** Compute a stable key so "default" exams aren't regenerated on every request */
export function stableExamKey(input: GenerateExamInput): string {
  return createHash('sha1').update(JSON.stringify(input)).digest('hex').slice(0, 12)
}
