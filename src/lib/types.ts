// JEE NEXUS — shared domain types

export type QuestionType = 'mcq_single' | 'mcq_multi' | 'numerical'
export type Difficulty = 'easy' | 'medium' | 'hard'
export type VerificationStatus = 'imported' | 'needs_review' | 'verified' | 'rejected'
export type SubjectKey = 'physics' | 'chemistry' | 'mathematics'

export interface PublicOption {
  idx: number
  text: string
}

/** Question as delivered to the client (answer never included until submit) */
export interface PublicQuestion {
  id: string
  publicId: string
  subject: { key: SubjectKey; name: string }
  chapter: { key: string; name: string; unit?: string }
  subtopic?: string
  type: QuestionType
  text: string
  options: PublicOption[]
  difficulty: Difficulty
  sourceExam: string
  sourceYear?: number
  sourceDate?: string
  sourceShift?: string
  sourceQuestionNumber?: number
  verificationStatus: VerificationStatus
  tags: string[]
  images: { url: string; altText: string; caption?: string; attribution?: string; isOriginalExamImage: boolean }[]
  bookmarked?: boolean
}

export interface QuestionSolution {
  keyConcept?: string
  formulas?: string[]
  body: string
  commonMistakes?: string
  alternativeMethod?: string
  verification?: string
  isAiGenerated: boolean
  sourceReferences?: string[]
  solutionImages: { url: string; altText: string; caption?: string }[]
}

export interface SubmittedResult {
  isCorrect: boolean | null
  correctOptions?: number[]
  numericalAnswer?: number
  numericalTolerance?: number
  solution: QuestionSolution | null
}

export interface SessionUser {
  id: string
  /** Login identity (username+password auth, 2026-11-28 rework) */
  username: string
  /** Optional — captured only for self-recovery; never shown to other users */
  email: string | null
  name: string | null
  role: 'student' | 'admin'
}

export interface ExamPatternConfig {
  sections: { key: SubjectKey; name: string; questionCount: number; maxQuestionsSelectable: number }[]
  marking: {
    mcqSingle: { correct: number; incorrect: number; unattempted: number }
    mcqMulti: { correct: number; partial: boolean; incorrect: number; unattempted: number }
    numerical: { correct: number; incorrect: number; unattempted: number }
  }
}

export const SUBJECT_META: Record<SubjectKey, { name: string; colorVar: string; icon: string }> = {
  physics: { name: 'Physics', colorVar: 'var(--subj-physics)', icon: 'Atom' },
  chemistry: { name: 'Chemistry', colorVar: 'var(--subj-chemistry)', icon: 'FlaskConical' },
  mathematics: { name: 'Mathematics', colorVar: 'var(--subj-mathematics)', icon: 'Sigma' },
}

export const DIFFICULTY_META: Record<Difficulty, { label: string; className: string }> = {
  easy: { label: 'Easy', className: 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10' },
  medium: { label: 'Medium', className: 'text-amber-400 border-amber-400/30 bg-amber-400/10' },
  hard: { label: 'Hard', className: 'text-rose-400 border-rose-400/30 bg-rose-400/10' },
}

export const TYPE_META: Record<QuestionType, { label: string; hint: string }> = {
  mcq_single: { label: 'Single Correct MCQ', hint: 'Exactly one option is correct' },
  mcq_multi: { label: 'Multiple Correct MCQ', hint: 'One or more options may be correct' },
  numerical: { label: 'Numerical Value', hint: 'Enter a numeric answer' },
}
