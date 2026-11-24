// JEE NEXUS — taxonomy-only upsert (idempotent).
// Syncs data/taxonomy.json (subjects + chapters) into whatever DB the
// DATABASE_URL points at — used by the live import workflow so newly added
// chapters (e.g. chemistry:salt-analysis) exist before questions are
// imported. Never touches questions.
//
// Usage: bunx tsx scripts/upsert_taxonomy.ts
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'fs'

const db = new PrismaClient()

async function main() {
  const tax = JSON.parse(readFileSync('data/taxonomy.json', 'utf-8'))
  let chapters = 0
  for (const s of tax.subjects as { key: string; name: string; icon: string; colorKey: string; order: number; chapters: { key: string; name: string; unit: string; order: number }[] }[]) {
    await db.subject.upsert({
      where: { key: s.key },
      update: { name: s.name, icon: s.icon, colorKey: s.colorKey, order: s.order },
      create: { key: s.key, name: s.name, icon: s.icon, colorKey: s.colorKey, order: s.order },
    })
    for (const c of s.chapters) {
      const subject = await db.subject.findUnique({ where: { key: s.key } })
      await db.chapter.upsert({
        where: { key: c.key },
        update: { name: c.name, unit: c.unit, order: c.order, subjectId: subject!.id },
        create: { key: c.key, name: c.name, unit: c.unit, order: c.order, subject: { connect: { key: s.key } } },
      })
      chapters++
    }
  }
  const subjects = await db.subject.count()
  const total = await db.chapter.count()
  console.log(`taxonomy upserted: ${subjects} subjects, ${chapters} chapters in file, ${total} in DB`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
