// JEE NEXUS — Prisma↔Supabase runtime parity test.
// Exercises the tricky schema paths against the LIVE database as jee_app:
// enums, jsonb (Json), double precision (Float), timestamptz, upsert,
// unique-violation mapping (P2002), and cascade deletes. Cleans up after itself.
import { PrismaClient, Prisma } from '@prisma/client'

const db = new PrismaClient()
let pass = 0, fail = 0
const ok = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log(`  ok ${name} ${extra}`) }
  else { fail++; console.log(`  FAIL ${name} ${extra}`) }
}

async function main() {
  console.log('— pg runtime parity —')

  // clean leftovers from any previous (possibly crashed) run
  await db.exam.deleteMany({ where: { id: '_parity_exam' } })
  await db.question.deleteMany({ where: { publicId: { startsWith: '_PARITY' } } })
  await db.user.deleteMany({ where: { id: '_parity_user' } })
  await db.examPattern.deleteMany({ where: { key: '_parity_pattern' } })
  await db.chapter.deleteMany({ where: { subjectId: '_parity_subj' } })
  await db.subject.deleteMany({ where: { id: '_parity_subj' } })

  // 1. taxonomy insert + read
  const subj = await db.subject.create({
    data: { id: '_parity_subj', key: '_parity', name: 'Parity', order: 99 },
  })
  ok('subject create', subj.key === '_parity')
  const chap = await db.chapter.create({
    data: { id: '_parity_chap', subjectId: subj.id, key: '_parity:ch1', name: 'Parity Ch1', unit: 'Test', order: 1 },
  })
  ok('chapter create', chap.subjectId === subj.id)

  // 2. question with enum + Json + Float
  const q = await db.question.create({
    data: {
      id: '_parity_q1',
      publicId: '_PARITY-001',
      subjectId: subj.id,
      chapterId: chap.id,
      type: 'mcq_multi',
      text: 'Parity $x^2$ question',
      correctOptions: [0, 2],
      difficulty: 'hard',
      verificationStatus: 'imported',
      tags: ['parity', 'test-tag'],
      numericalAnswer: 3.47,
      numericalTolerance: 0.01,
      contentHash: '_parity_hash_1',
      options: {
        create: [
          { idx: 0, text: 'A', isCorrect: true },
          { idx: 1, text: 'B', isCorrect: false },
          { idx: 2, text: 'C', isCorrect: true },
        ],
      },
      solution: {
        create: {
          body: 'parity solution body',
          formulas: ['$E = mc^2$', '$F = ma$'],
          sourceReferences: ['ref1'],
        },
      },
    },
    include: { options: true, solution: true },
  })
  ok('question create (enum mcq_multi)', q.type === 'mcq_multi')
  ok('correctOptions jsonb roundtrip', JSON.stringify(q.correctOptions) === '[0,2]', `got ${JSON.stringify(q.correctOptions)}`)
  ok('tags jsonb roundtrip', JSON.stringify(q.tags) === '["parity","test-tag"]', `got ${JSON.stringify(q.tags)}`)
  ok('numericalAnswer float', q.numericalAnswer === 3.47, `got ${q.numericalAnswer}`)
  ok('solution formulas jsonb', JSON.stringify(q.solution?.formulas) === '["$E = mc^2$","$F = ma$"]')
  ok('createdAt is Date', q.createdAt instanceof Date && !isNaN(q.createdAt.getTime()))

  // 3. read-back types
  const back = await db.question.findUnique({ where: { id: '_parity_q1' } })
  ok('read back jsonb is array', Array.isArray(back?.correctOptions) && (back!.correctOptions as number[])[1] === 2)
  ok('read back float', typeof back?.numericalAnswer === 'number' && Math.abs(back!.numericalAnswer! - 3.47) < 1e-9)
  ok('read back enum string', back?.difficulty === 'hard')
  ok('tags default jsonb array', Array.isArray(back?.tags))

  // 4. enum transition update
  const upd = await db.question.update({ where: { id: '_parity_q1' }, data: { verificationStatus: 'verified' } })
  ok('enum transition update', upd.verificationStatus === 'verified')

  // 5. tags null-write then restore (Json null handling)
  await db.question.update({ where: { id: '_parity_q1' }, data: { correctOptions: null } })
  const nulled = await db.question.findUnique({ where: { id: '_parity_q1' } })
  ok('jsonb set null', nulled?.correctOptions === null)
  await db.question.update({ where: { id: '_parity_q1' }, data: { correctOptions: [1] } })
  const restored = await db.question.findUnique({ where: { id: '_parity_q1' } })
  ok('jsonb restore array', JSON.stringify(restored?.correctOptions) === '[1]')

  // 6. unique violation → P2002
  try {
    await db.question.create({
      data: {
        publicId: '_PARITY-002',
        subjectId: subj.id, chapterId: chap.id,
        type: 'numerical', text: 'dup hash', contentHash: '_parity_hash_1',
      },
    })
    ok('unique violation mapped', false, 'no error thrown')
  } catch (e: any) {
    ok('unique violation mapped', e?.code === 'P2002', `code=${e?.code}`)
  }

  // 7. exam pattern upsert (bootstrap path) with Json config
  const pattern = await db.examPattern.upsert({
    where: { key: '_parity_pattern' },
    update: { name: 'Parity Pattern' },
    create: {
      id: '_parity_pattern_id', key: '_parity_pattern', name: 'Parity Pattern',
      durationMinutes: 5,
      config: { sections: [{ key: 'physics', count: 1 }], marking: { numerical: { correct: 4, wrong: -1 } } },
    },
  })
  ok('pattern upsert create', pattern.key === '_parity_pattern')
  const pattern2 = await db.examPattern.upsert({
    where: { key: '_parity_pattern' },
    update: { name: 'Parity Pattern v2' },
    create: { key: '_parity_pattern', name: 'x', durationMinutes: 1, config: {} },
  })
  ok('pattern upsert update', pattern2.name === 'Parity Pattern v2')
  const pcfg = pattern2.config as any
  ok('pattern config jsonb', Array.isArray(pcfg?.sections) && pcfg.sections[0].key === 'physics')

  // 8. exam + attempt flow with Json/Float
  const exam = await db.exam.create({
    data: {
      id: '_parity_exam', title: 'Parity Exam', kind: 'custom',
      patternId: pattern2.id, config: { durationMinutes: 5, seed: 'abc' },
      examQuestions: {
        create: [{ id: '_parity_eq', questionId: '_parity_q1', order: 0, section: 'parity', sectionOrder: 0 }],
      },
    },
  })
  const user = await db.user.create({
    data: { id: '_parity_user', email: 'parity@test.local', passwordHash: 'x', role: 'student', preferences: { theme: 'dark' } },
  })
  ok('user create (enum role + preferences jsonb)', user.role === 'student')
  const attempt = await db.examAttempt.create({
    data: {
      id: '_parity_attempt', userId: user.id, examId: exam.id,
      endsAt: new Date(Date.now() + 5 * 60_000),
      answers: {
        create: [{
          examQuestionId: '_parity_eq',
          selectedOptions: [0, 2], numericalValue: '3.47',
          isCorrect: true, marksAwarded: 4, visited: true, markedForReview: true,
        }],
      },
    },
    include: { answers: true },
  })
  ok('attempt answers jsonb+float', JSON.stringify(attempt.answers[0].selectedOptions) === '[0,2]' && attempt.answers[0].marksAwarded === 4)
  ok('endsAt timestamptz', attempt.endsAt instanceof Date && attempt.endsAt.getTime() > Date.now())

  // 9. cascade delete: exam → exam_questions/attempts/answers; question → options/solution
  //    (question referenced by an exam is RESTRICTED — verified below, then exam deleted first)
  try {
    await db.question.delete({ where: { id: '_parity_q1' } })
    ok('question delete restricted while referenced by exam', false, 'no error thrown')
  } catch (e: any) {
    ok('question delete restricted while referenced by exam', e?.code === 'P2003', `code=${e?.code}`)
  }
  await db.exam.delete({ where: { id: '_parity_exam' } })
  const eqLeft = await db.examQuestion.count({ where: { examId: '_parity_exam' } })
  const attLeft = await db.examAttempt.count({ where: { examId: '_parity_exam' } })
  ok('cascade exam→exam_questions', eqLeft === 0)
  ok('cascade exam→attempts', attLeft === 0)
  await db.question.delete({ where: { id: '_parity_q1' } })
  const optsLeft = await db.questionOption.count({ where: { questionId: '_parity_q1' } })
  const solLeft = await db.solution.count({ where: { questionId: '_parity_q1' } })
  ok('cascade question→options', optsLeft === 0)
  ok('cascade question→solution', solLeft === 0)

  // 10. practice attempt with null selectedOptions (numerical answer path)
  const q2 = await db.question.create({
    data: {
      id: '_parity_q2', publicId: '_PARITY-003', subjectId: subj.id, chapterId: chap.id,
      type: 'numerical', text: 'numerical parity', numericalAnswer: 12, numericalTolerance: 0.05,
      contentHash: '_parity_hash_2', tags: [],
    },
  })
  const pa = await db.attempt.create({
    data: { userId: user.id, questionId: q2.id, selectedOptions: null, numericalValue: '12.01', isCorrect: true },
  })
  ok('practice attempt null jsonb + float answer', pa.isCorrect === true && pa.selectedOptions === null)

  // cleanup (tolerant — step 9 already removed the exam tree)
  await db.exam.deleteMany({ where: { id: '_parity_exam' } })
  await db.attempt.deleteMany({ where: { userId: user.id } })
  await db.user.delete({ where: { id: '_parity_user' } }) // cascades sessions etc
  await db.question.deleteMany({ where: { subjectId: subj.id } })
  await db.examPattern.delete({ where: { key: '_parity_pattern' } })
  await db.chapter.deleteMany({ where: { subjectId: subj.id } })
  await db.subject.delete({ where: { id: '_parity_subj' } })
  const leftovers = await db.question.count({ where: { publicId: { startsWith: '_PARITY' } } })
  ok('cleanup complete', leftovers === 0)

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => { console.error('PARITY_TEST_CRASH:', e); process.exit(1) }).finally(() => db.$disconnect())
