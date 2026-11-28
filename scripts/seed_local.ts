// JEE NEXUS — local sandbox seed: taxonomy + full PYQ corpus import
// Run with: bun scripts/seed_local.ts
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { PrismaClient } from '@prisma/client'
import { importQuestions, type ImportQuestionInput } from '../src/lib/import'

const prisma = new PrismaClient()

async function seedTaxonomy() {
  const raw = JSON.parse(readFileSync(join(process.cwd(), 'data', 'taxonomy.json'), 'utf-8'))
  const subjects: {
    key: string
    name: string
    icon?: string
    colorKey?: string
    order?: number
    chapters: { key: string; name: string; unit?: string; order?: number }[]
  }[] = raw.subjects
  for (const s of subjects) {
    const subject = await prisma.subject.upsert({
      where: { key: s.key },
      update: { name: s.name, icon: s.icon ?? null, colorKey: s.colorKey ?? null, order: s.order ?? 0 },
      create: { key: s.key, name: s.name, icon: s.icon ?? null, colorKey: s.colorKey ?? null, order: s.order ?? 0 },
    })
    for (const c of s.chapters) {
      await prisma.chapter.upsert({
        where: { key: c.key },
        update: { name: c.name, unit: c.unit ?? null, order: c.order ?? 0, subjectId: subject.id },
        create: {
          key: c.key,
          name: c.name,
          unit: c.unit ?? null,
          order: c.order ?? 0,
          subjectId: subject.id,
        },
      })
    }
  }
  const subjectCount = await prisma.subject.count()
  const chapterCount = await prisma.chapter.count()
  console.log(`[seed] taxonomy: ${subjectCount} subjects, ${chapterCount} chapters`)
}

async function importCorpus() {
  const dir = join(process.cwd(), 'data', 'questions')
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  console.log(`[seed] ${files.length} question files found`)

  let totalInserted = 0
  let totalDupes = 0
  let totalRejected = 0

  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(dir, file), 'utf-8')) as ImportQuestionInput[]
    if (!Array.isArray(raw) || raw.length === 0) continue
    const result = await importQuestions(raw, {
      adminId: 'seed-script',
      fileName: file,
      sourceFormat: 'json',
    })
    totalInserted += result.inserted
    totalDupes += result.skippedDuplicate
    totalRejected += result.rejected
    if (result.rejected > 0) {
      console.log(`[seed] ${file}: ${result.inserted} ok, ${result.skippedDuplicate} dup, ${result.rejected} rejected`)
      for (const e of result.errors.slice(0, 3)) console.log(`   - row ${e.row}: ${e.error}`)
    }
  }
  console.log(`[seed] DONE: inserted=${totalInserted} duplicates=${totalDupes} rejected=${totalRejected}`)
}

async function main() {
  await seedTaxonomy()
  await importCorpus()
  const q = await prisma.question.count()
  const sol = await prisma.solution.count()
  const img = await prisma.questionImage.count()
  console.log(`[seed] DB totals: questions=${q} solutions=${sol} images=${img}`)
}

main()
  .catch((e) => {
    console.error('[seed] FATAL', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
