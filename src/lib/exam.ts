// JEE NEXUS — exam marking engine (JEE Main rules, pattern-configurable)
import type { ExamPatternConfig } from '@/lib/types'

/**
 * JEE Main 2025 marking scheme:
 * - Single-correct MCQ: +4 correct, -1 incorrect, 0 unattempted
 * - Multiple-correct MCQ (partial): +4 all correct; +3 if only 3 of 4 correct chosen;
 *   +2 if only 2 of 4 (or 2 of 3) correct chosen; +1 if only 1 of 2+ correct chosen;
 *   0 if any incorrect option chosen. (No negative.)
 * - Numerical: +4 correct, -1 incorrect, 0 unattempted
 * All of these live in ExamPattern.config so historical patterns stay representable.
 */

export interface MarkedAnswer {
  isCorrect: boolean | null
  marks: number
  attempted: boolean
}

export function gradeMcqSingle(selected: number[], correct: number[], marking: { correct: number; incorrect: number }): MarkedAnswer {
  if (selected.length === 0) return { isCorrect: null, marks: 0, attempted: false }
  const sortedSel = [...new Set(selected)].sort()
  const sortedCor = [...new Set(correct)].sort()
  const isCorrect = sortedSel.length === sortedCor.length && sortedSel.every((v, i) => v === sortedCor[i])
  return { isCorrect, marks: isCorrect ? marking.correct : marking.incorrect, attempted: true }
}

export function gradeMcqMulti(selected: number[], correct: number[], marking: { partial: boolean; correct: number }): MarkedAnswer {
  if (selected.length === 0) return { isCorrect: null, marks: 0, attempted: false }
  const sel = [...new Set(selected)]
  const wrong = sel.filter((s) => !correct.includes(s))
  const right = sel.filter((s) => correct.includes(s))

  if (!marking.partial) {
    const all = wrong.length === 0 && right.length === correct.length
    return { isCorrect: all, marks: all ? marking.correct : 0, attempted: true }
  }
  // Partial marking (JEE 2025 style): any wrong option -> 0
  if (wrong.length > 0 || right.length === 0) return { isCorrect: false, marks: 0, attempted: true }
  if (right.length === correct.length) return { isCorrect: true, marks: 4, attempted: true }
  // partial credit: chose k of n correct, none wrong
  const n = correct.length
  const k = right.length
  const marks = n === 4 ? (k === 3 ? 3 : k === 2 ? 2 : 1) : n === 3 ? (k === 2 ? 2 : 1) : 1
  return { isCorrect: false, marks, attempted: true }
}

export function gradeNumerical(
  value: string | null | undefined,
  answer: number | null,
  tolerance: number | null,
  marking: { correct: number; incorrect: number }
): MarkedAnswer {
  if (value === null || value === undefined || String(value).trim() === '') {
    return { isCorrect: null, marks: 0, attempted: false }
  }
  const v = Number(value)
  if (isNaN(v) || answer === null || isNaN(answer)) {
    return { isCorrect: false, marks: marking.incorrect, attempted: true }
  }
  const tol = tolerance ?? 0.01
  const isCorrect = Math.abs(v - answer) <= Math.max(tol, 1e-9)
  return { isCorrect, marks: isCorrect ? marking.correct : marking.incorrect, attempted: true }
}

export function gradeAnswer(
  type: string,
  selected: number[] | null,
  numericalValue: string | null,
  correctOptions: number[] | null,
  numericalAnswer: number | null,
  numericalTolerance: number | null,
  pattern: ExamPatternConfig
): MarkedAnswer {
  switch (type) {
    case 'mcq_single':
      return gradeMcqSingle(selected ?? [], correctOptions ?? [], pattern.marking.mcqSingle)
    case 'mcq_multi':
      return gradeMcqMulti(selected ?? [], correctOptions ?? [], { partial: pattern.marking.mcqMulti.partial, correct: pattern.marking.mcqMulti.correct })
    case 'numerical':
      return gradeNumerical(numericalValue, numericalAnswer, numericalTolerance, pattern.marking.numerical)
    default:
      return { isCorrect: null, marks: 0, attempted: false }
  }
}

/** Default JEE Main 2025 pattern config (stored in ExamPattern.config JSON) */
export const JEE_MAIN_2025_PATTERN: ExamPatternConfig = {
  sections: [
    { key: 'physics', name: 'Physics', questionCount: 25, maxQuestionsSelectable: 25 },
    { key: 'chemistry', name: 'Chemistry', questionCount: 25, maxQuestionsSelectable: 25 },
    { key: 'mathematics', name: 'Mathematics', questionCount: 25, maxQuestionsSelectable: 25 },
  ],
  marking: {
    mcqSingle: { correct: 4, incorrect: -1, unattempted: 0 },
    mcqMulti: { correct: 4, partial: true, incorrect: 0, unattempted: 0 },
    numerical: { correct: 4, incorrect: -1, unattempted: 0 },
  },
}
