import { PrismaClient } from '@prisma/client'
import { enrichSolution, isThinSolution } from '../src/lib/enrich'
const prisma = new PrismaClient()
async function main() {
  // find a PYQ (publicId starts with PYQ-) with thin solution, newest first
  const cands = await prisma.solution.findMany({
    where: { question: { publicId: { startsWith: 'PYQ-' }, sourceYear: 2025 } },
    include: { question: { include: { subject: true, chapter: true } } },
    take: 60,
  })
  const thin = cands.find((s) => isThinSolution(s))
  if (!thin) return console.log('no thin PYQ found in sample')
  console.log('Q:', thin.question.publicId, thin.question.subject.name, '/', thin.question.chapter.name)
  console.log('old body len:', thin.body.length)
  const res = await enrichSolution(thin.questionId)
  console.log('result:', JSON.stringify(res))
  const fresh = await prisma.solution.findUnique({ where: { questionId: thin.questionId } })
  console.log('new body length:', fresh?.body.length, '| keyConcept:', Boolean(fresh?.keyConcept), '| formulas:', Array.isArray(fresh?.formulas) ? fresh!.formulas.length : 0, '| mistakes:', Boolean(fresh?.commonMistakes), '| verification:', Boolean(fresh?.verification))
  console.log('refs:', JSON.stringify(fresh?.sourceReferences)?.slice(0, 300))
  console.log('---BODY PREVIEW---')
  console.log(fresh?.body.slice(0, 900))
}
main().finally(() => prisma.$disconnect())
