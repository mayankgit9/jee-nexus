// JEE NEXUS — marking engine unit tests (run: bunx tsx scripts/test_marking.ts)
import { gradeMcqSingle, gradeMcqMulti, gradeNumerical } from '../src/lib/exam'

let pass = 0
let fail = 0
function check(name: string, got: unknown, expected: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(expected)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, ok ? '' : `got=${JSON.stringify(got)} want=${JSON.stringify(expected)}`)
  ok ? pass++ : fail++
}

const single = { correct: 4, incorrect: -1 }
const multi = { partial: true, correct: 4 }
const num = { correct: 4, incorrect: -1 }

// --- single correct ---
check('single: exact match', gradeMcqSingle([1], [1], single), { isCorrect: true, marks: 4, attempted: true })
check('single: wrong option', gradeMcqSingle([0], [1], single), { isCorrect: false, marks: -1, attempted: true })
check('single: two selected on single-correct', gradeMcqSingle([0, 1], [1], single), { isCorrect: false, marks: -1, attempted: true })
check('single: none selected', gradeMcqSingle([], [1], single), { isCorrect: null, marks: 0, attempted: false })
check('single: duplicates collapse', gradeMcqSingle([1, 1], [1], single), { isCorrect: true, marks: 4, attempted: true })

// --- multiple correct with partial marking (JEE 2025 rules) ---
check('multi 4-correct: all right', gradeMcqMulti([0, 1, 2, 3], [0, 1, 2, 3], multi), { isCorrect: true, marks: 4, attempted: true })
check('multi 4-correct: 3 of 4 right', gradeMcqMulti([0, 1, 2], [0, 1, 2, 3], multi), { isCorrect: false, marks: 3, attempted: true })
check('multi 4-correct: 2 of 4 right', gradeMcqMulti([0, 1], [0, 1, 2, 3], multi), { isCorrect: false, marks: 2, attempted: true })
check('multi 4-correct: 1 of 4 right', gradeMcqMulti([2], [0, 1, 2, 3], multi), { isCorrect: false, marks: 1, attempted: true })
check('multi 4-correct: 3 right + 1 wrong -> 0', gradeMcqMulti([0, 1, 2, 4], [0, 1, 2, 3], multi), { isCorrect: false, marks: 0, attempted: true })
check('multi 3-correct: 2 of 3 right', gradeMcqMulti([0, 1], [0, 1, 2], multi), { isCorrect: false, marks: 2, attempted: true })
check('multi 3-correct: 1 of 3 right', gradeMcqMulti([1], [0, 1, 2], multi), { isCorrect: false, marks: 1, attempted: true })
check('multi 2-correct: 1 of 2 right', gradeMcqMulti([0], [0, 1], multi), { isCorrect: false, marks: 1, attempted: true })
check('multi: any wrong option -> 0', gradeMcqMulti([0, 3], [0, 1, 2], multi), { isCorrect: false, marks: 0, attempted: true })
check('multi: only wrong option', gradeMcqMulti([5], [0, 1], multi), { isCorrect: false, marks: 0, attempted: true })
check('multi: none selected', gradeMcqMulti([], [0, 1], multi), { isCorrect: null, marks: 0, attempted: false })

// --- partial marking disabled (older pattern) ---
check('multi no-partial: exact set', gradeMcqMulti([0, 1], [0, 1], { partial: false, correct: 4 }), { isCorrect: true, marks: 4, attempted: true })
check('multi no-partial: subset', gradeMcqMulti([0], [0, 1], { partial: false, correct: 4 }), { isCorrect: false, marks: 0, attempted: true })

// --- numerical with tolerance ---
check('numerical: exact', gradeNumerical('3.47', 3.47, 0.01, num), { isCorrect: true, marks: 4, attempted: true })
check('numerical: within tolerance', gradeNumerical('3.475', 3.47, 0.01, num), { isCorrect: true, marks: 4, attempted: true })
check('numerical: outside tolerance', gradeNumerical('3.5', 3.47, 0.01, num), { isCorrect: false, marks: -1, attempted: true })
check('numerical: default tolerance', gradeNumerical('12.005', 12, null, num).isCorrect, true)
check('numerical: empty', gradeNumerical('', 12, null, num), { isCorrect: null, marks: 0, attempted: false })
check('numerical: garbage', gradeNumerical('abc', 12, null, num), { isCorrect: false, marks: -1, attempted: true })
check('numerical: negative answer ok', gradeNumerical('-2.5', -2.5, 0.01, num), { isCorrect: true, marks: 4, attempted: true })

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
