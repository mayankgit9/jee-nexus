// JEE NEXUS — database seeder (development seed, clearly labelled)
// Usage: bunx tsx scripts/seed.ts
import { PrismaClient, Prisma } from '@prisma/client'
import type { QuestionType, Difficulty } from '@prisma/client'
import { createHash } from 'crypto'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const db = new PrismaClient()

function contentHash(text: string, subjectKey: string): string {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').replace(/[$\\{}]/g, '').trim()
  return createHash('sha256').update(`${subjectKey}::${normalized}`).digest('hex')
}

async function seedTaxonomy() {
  const tax = JSON.parse(readFileSync('data/taxonomy.json', 'utf-8'))
  let chapters = 0
  for (const s of tax.subjects as { key: string; name: string; icon: string; colorKey: string; order: number; chapters: { key: string; name: string; unit: string; order: number }[] }[]) {
    await db.subject.upsert({
      where: { key: s.key },
      update: { name: s.name, icon: s.icon, colorKey: s.colorKey, order: s.order },
      create: { key: s.key, name: s.name, icon: s.icon, colorKey: s.colorKey, order: s.order },
    })
    for (const c of s.chapters) {
      await db.chapter.upsert({
        where: { key: c.key },
        update: { name: c.name, unit: c.unit, order: c.order, subjectId: (await db.subject.findUnique({ where: { key: s.key } }))!.id },
        create: { key: c.key, name: c.name, unit: c.unit, order: c.order, subject: { connect: { key: s.key } } },
      })
      chapters++
    }
  }
  console.log(`taxonomy: subjects=${tax.subjects.length} chapters=${chapters}`)
}

interface SeedImage {
  url: string
  altText: string
  caption: string | null
  attribution: string | null
  isOriginalExamImage: boolean
  kind: string // question | solution
}

interface SeedQuestion {
  publicId: string
  subjectKey: string
  chapterKey: string
  subtopic?: string
  type: string
  text: string
  options: string[]
  correctOptions: number[] | null
  numericalAnswer?: string
  numericalTolerance?: string
  difficulty: string
  sourceYear: number
  sourceShift: string
  tags: string[]
  images?: SeedImage[]
  solution: {
    keyConcept: string
    formulas: string[]
    body: string
    commonMistakes: string
    alternativeMethod?: string
    verification: string
    sourceReferences: string[]
    isAiGenerated: boolean
  }
}

async function seedQuestions() {
  const dir = 'data/questions'
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  let inserted = 0
  let skipped = 0

  for (const file of files) {
    const batch = JSON.parse(readFileSync(join(dir, file), 'utf-8')) as SeedQuestion[]
    for (const q of batch) {
      const subject = await db.subject.findUnique({ where: { key: q.subjectKey } })
      const chapter = await db.chapter.findUnique({ where: { key: q.chapterKey } })
      if (!subject || !chapter) {
        console.warn(`  !! ${q.publicId}: unknown subject/chapter — skipped`)
        skipped++
        continue
      }
      const hash = contentHash(q.text, q.subjectKey)
      const existing = await db.question.findFirst({
        where: { contentHash: hash },
        select: { id: true },
      })
      if (existing) {
        skipped++
        continue
      }
      // mirror admin-import validation: ungradeable questions (bonus MCQs
      // dropped by NTA / numericals without an official answer) stay in the
      // archive files but are not seeded
      const isBonus = (q.tags ?? []).includes('bonus-dropped-by-nta')
      const ungradeable =
        (q.type !== 'numerical' && (!q.correctOptions || q.correctOptions.length === 0) && !isBonus) ||
        (q.type === 'numerical' && !isBonus && (q.numericalAnswer == null || q.numericalAnswer === ''))
      if (ungradeable) {
        console.warn(`  !! ${q.publicId}: no answer key (bonus/ungradeable) — skipped`)
        skipped++
        continue
      }

      await db.question.create({
        data: {
          publicId: q.publicId,
          subjectId: subject.id,
          chapterId: chapter.id,
          subtopic: q.subtopic,
          type: q.type as QuestionType,
          text: q.text,
          correctOptions: q.correctOptions ?? Prisma.DbNull,
          numericalAnswer: q.numericalAnswer != null && q.numericalAnswer !== '' ? Number(q.numericalAnswer) : null,
          numericalTolerance: q.numericalTolerance != null && q.numericalTolerance !== '' ? Number(q.numericalTolerance) : null,
          difficulty: q.difficulty as Difficulty,
          sourceExam: 'JEE Main',
          sourceYear: q.sourceYear,
          sourceShift: q.sourceShift,
          verificationStatus: 'needs_review', // seed data is never auto-verified
          tags: q.tags ?? [],
          contentHash: hash,
          images: {
            create: (q.images ?? []).map((im, idx) => ({
              kind: im.kind === 'solution' ? 'solution' : 'question',
              url: im.url,
              altText: im.altText ?? 'Exam figure',
              caption: im.caption ?? null,
              attribution: im.attribution ?? null,
              isOriginalExamImage: im.isOriginalExamImage ?? false,
              order: idx,
            })),
          },
          options: {
            create: (q.options || []).map((text, idx) => ({
              idx,
              text,
              isCorrect: q.correctOptions ? q.correctOptions.includes(idx) : false,
            })),
          },
          solution: {
            create: {
              keyConcept: q.solution.keyConcept,
              formulas: q.solution.formulas ?? [],
              body: q.solution.body,
              commonMistakes: q.solution.commonMistakes,
              alternativeMethod: q.solution.alternativeMethod,
              verification: q.solution.verification,
              isAiGenerated: q.solution.isAiGenerated,
              sourceReferences: q.solution.sourceReferences ?? [],
            },
          },
        },
      })
      inserted++
    }
  }
  console.log(`questions: inserted=${inserted} skipped(duplicate/invalid)=${skipped} from ${files.length} files`)
}

async function main() {
  console.log('— seeding JEE NEXUS (DEV seed) —')
  await seedTaxonomy()
  await seedQuestions()
  const counts = {
    subjects: await db.subject.count(),
    chapters: await db.chapter.count(),
    questions: await db.question.count(),
    options: await db.questionOption.count(),
    solutions: await db.solution.count(),
    images: await db.questionImage.count(),
    originalExamImages: await db.questionImage.count({ where: { isOriginalExamImage: true } }),
  }
  console.log('DB state:', counts)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
