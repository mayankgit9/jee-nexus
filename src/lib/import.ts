// JEE NEXUS — question import pipeline: validation + duplicate detection
import { db } from '@/lib/db'
import { computeContentHash } from '@/lib/questions'
import { Prisma } from '@prisma/client'
import type { QuestionType, Difficulty } from '@prisma/client'

export interface ImportQuestionInput {
  publicId?: string
  subjectKey?: string
  chapterKey?: string
  subtopic?: string
  type?: string
  text?: string
  options?: { text: string }[] | string[]
  correctOptions?: number[]
  numericalAnswer?: string | number
  numericalTolerance?: string | number
  difficulty?: string
  sourceExam?: string
  sourceYear?: number | string
  sourceDate?: string
  sourceShift?: string
  sourceQuestionNumber?: number | string
  sourceReference?: string
  tags?: string[]
  images?: { url: string; altText: string; caption?: string; attribution?: string; isOriginalExamImage?: boolean; kind?: string }[]
  solution?: {
    keyConcept?: string
    formulas?: string[]
    body?: string
    commonMistakes?: string
    alternativeMethod?: string
    verification?: string
    sourceReferences?: string[]
    isAiGenerated?: boolean
  }
}

export interface RowError {
  row: number
  publicId?: string
  error: string
}

export interface ImportResult {
  jobId: string
  total: number
  inserted: number
  skippedDuplicate: number
  rejected: number
  errors: RowError[]
}

const VALID_TYPES = ['mcq_single', 'mcq_multi', 'numerical']
const VALID_DIFFICULTIES = ['easy', 'medium', 'hard']

function toOptionArray(opts: ImportQuestionInput['options']): { text: string }[] | null {
  if (!Array.isArray(opts) || opts.length === 0) return null
  return opts.map((o) => (typeof o === 'string' ? { text: o } : o))
}

/** Full validation of one imported question. Returns error string or null. */
export async function validateQuestion(q: ImportQuestionInput, subjects: Map<string, string>, chapters: Map<string, string>): Promise<string | null> {
  if (!q.subjectKey || !subjects.has(q.subjectKey)) return `unknown subjectKey "${q.subjectKey}" (expected physics|chemistry|mathematics)`
  if (!q.chapterKey || !chapters.has(q.chapterKey)) return `unknown chapterKey "${q.chapterKey}"`
  if (!q.text || q.text.trim().length < 10) return 'question text missing or under 10 chars'
  if (!q.type || !VALID_TYPES.includes(q.type)) return `invalid type "${q.type}" (expected ${VALID_TYPES.join('|')})`
  if (q.difficulty && !VALID_DIFFICULTIES.includes(q.difficulty)) return `invalid difficulty "${q.difficulty}"`
  if (q.sourceYear !== undefined && q.sourceYear !== null && q.sourceYear !== '') {
    const y = Number(q.sourceYear)
    if (isNaN(y) || y < 2000 || y > 2030) return `invalid sourceYear "${q.sourceYear}"`
  }

  if (q.type === 'numerical') {
    if (q.numericalAnswer === undefined || q.numericalAnswer === null || String(q.numericalAnswer).trim() === '') {
      return 'numerical question missing numericalAnswer'
    }
    if (isNaN(Number(q.numericalAnswer))) return `numericalAnswer "${q.numericalAnswer}" is not a number`
    if (q.numericalTolerance !== undefined && q.numericalTolerance !== null && String(q.numericalTolerance) !== '' && isNaN(Number(q.numericalTolerance))) {
      return `numericalTolerance "${q.numericalTolerance}" is not a number`
    }
  } else {
    const options = toOptionArray(q.options)
    if (!options) return 'MCQ question missing options'
    if (options.length < 2) return 'MCQ question needs at least 2 options'
    if (options.length > 6) return 'MCQ question has more than 6 options'
    if (options.some((o) => !o.text || !String(o.text).trim())) return 'an option has empty text'
    if (!Array.isArray(q.correctOptions) || q.correctOptions.length === 0) return 'MCQ question missing correctOptions'
    const uniq = [...new Set(q.correctOptions)]
    if (uniq.length !== q.correctOptions.length) return 'correctOptions contains duplicates'
    for (const c of q.correctOptions) {
      if (!Number.isInteger(c) || c < 0 || c >= options.length) return `correctOption ${c} out of range (0-${options.length - 1})`
    }
    if (q.type === 'mcq_single' && q.correctOptions.length !== 1) return 'mcq_single must have exactly one correct option'
    if (q.type === 'mcq_multi' && q.correctOptions.length < 2) return 'mcq_multi must have at least two correct options'
  }

  if (q.solution && (!q.solution.body || q.solution.body.trim().length < 20)) {
    return 'solution.body missing or under 20 chars'
  }
  if (q.images) {
    for (const img of q.images) {
      if (!img.url || !img.altText) return 'image missing url or altText'
    }
  }
  return null
}

export interface ImportOptions {
  adminId: string
  fileName: string
  sourceFormat: 'json' | 'csv'
}

/** Validate + dedup + insert a batch. Never marks imported questions as verified. */
export async function importQuestions(
  input: ImportQuestionInput[],
  opts: ImportOptions
): Promise<ImportResult> {
  const errors: RowError[] = []
  let inserted = 0
  let skippedDuplicate = 0
  let rejected = 0

  const subjectRows = await db.subject.findMany({ select: { id: true, key: true } })
  const chapterRows = await db.chapter.findMany({ select: { id: true, key: true } })
  const subjects = new Map(subjectRows.map((s) => [s.key, s.id]))
  const chapters = new Map(chapterRows.map((c) => [c.key, c.id]))

  // pre-load existing hashes for duplicate detection
  const existingHashes = new Set((await db.question.findMany({ select: { contentHash: true } })).map((q) => q.contentHash))
  const batchHashes = new Set<string>()

  const job = await db.importJob.create({
    data: { adminId: opts.adminId, fileName: opts.fileName, sourceFormat: opts.sourceFormat, totalRows: input.length, status: 'running' },
  })

  for (let i = 0; i < input.length; i++) {
    const q = input[i]
    try {
      const validationError = await validateQuestion(q, subjects, chapters)
      if (validationError) {
        rejected++
        errors.push({ row: i + 1, publicId: q.publicId, error: validationError })
        continue
      }

      const hash = computeContentHash(q.text!, q.subjectKey!)
      if (existingHashes.has(hash) || batchHashes.has(hash)) {
        skippedDuplicate++
        errors.push({ row: i + 1, publicId: q.publicId, error: 'duplicate: normalized question content already exists' })
        continue
      }
      batchHashes.add(hash)

      // publicId: use given or generate; ensure uniqueness
      let publicId = q.publicId?.trim()
      if (publicId) {
        const taken = await db.question.findUnique({ where: { publicId } })
        if (taken) {
          publicId = `${publicId}-${hash.slice(0, 6)}`
        }
      } else {
        publicId = `IMP-${Date.now().toString(36).toUpperCase()}-${hash.slice(0, 6).toUpperCase()}`
      }

      const options = q.type === 'numerical' ? [] : toOptionArray(q.options)!

      await db.question.create({
        data: {
          publicId,
          subjectId: subjects.get(q.subjectKey!)!,
          chapterId: chapters.get(q.chapterKey!)!,
          subtopic: q.subtopic ?? null,
          type: q.type! as QuestionType,
          text: q.text!,
          correctOptions: q.type === 'numerical' ? Prisma.DbNull : (q.correctOptions ?? []),
          numericalAnswer: q.type === 'numerical' ? Number(q.numericalAnswer) : null,
          numericalTolerance: q.type === 'numerical' && q.numericalTolerance != null && String(q.numericalTolerance) !== '' ? Number(q.numericalTolerance) : null,
          difficulty: (q.difficulty ?? 'medium') as Difficulty,
          sourceExam: q.sourceExam ?? 'JEE Main',
          sourceYear: q.sourceYear ? Number(q.sourceYear) : null,
          sourceDate: q.sourceDate ?? null,
          sourceShift: q.sourceShift ?? null,
          sourceQuestionNumber: q.sourceQuestionNumber ? Number(q.sourceQuestionNumber) : null,
          sourceReference: q.sourceReference ?? null,
          verificationStatus: 'imported', // NEVER auto-verified
          tags: q.tags ?? [],
          contentHash: hash,
          options: {
            create: options.map((o, idx) => ({
              idx,
              text: String(o.text),
              isCorrect: q.type !== 'numerical' && (q.correctOptions ?? []).includes(idx),
            })),
          },
          ...(q.solution
            ? {
                solution: {
                  create: {
                    keyConcept: q.solution.keyConcept ?? null,
                    formulas: q.solution.formulas ?? [],
                    body: q.solution.body!,
                    commonMistakes: q.solution.commonMistakes ?? null,
                    alternativeMethod: q.solution.alternativeMethod ?? null,
                    verification: q.solution.verification ?? null,
                    isAiGenerated: q.solution.isAiGenerated ?? true,
                    sourceReferences: q.solution.sourceReferences ?? [],
                  },
                },
              }
            : {}),
          ...(q.images?.length
            ? {
                images: {
                  create: q.images.map((img, idx) => ({
                    kind: img.kind ?? 'question',
                    url: img.url,
                    altText: img.altText,
                    caption: img.caption ?? null,
                    attribution: img.attribution ?? null,
                    isOriginalExamImage: img.isOriginalExamImage ?? false,
                    order: idx,
                  })),
                },
              }
            : {}),
        },
      })
      inserted++
    } catch (e) {
      rejected++
      errors.push({ row: i + 1, publicId: q.publicId, error: `insert failed: ${(e as Error).message}` })
    }
  }

  await db.importJob.update({
    where: { id: job.id },
    data: {
      inserted,
      skippedDuplicate,
      rejected,
      errors: errors.length ? (errors.slice(0, 200) as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      status: 'completed',
    },
  })

  return { jobId: job.id, total: input.length, inserted, skippedDuplicate, rejected, errors: errors.slice(0, 100) }
}
