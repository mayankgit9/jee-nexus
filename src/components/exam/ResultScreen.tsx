'use client'

// JEE NEXUS — exam result screen with question-wise review
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Trophy, Clock, ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MathText } from '@/components/MathText'
import { SolutionView } from '@/components/QuestionCard'
import type { QuestionSolution } from '@/lib/types'
import { SUBJECT_COLORS, formatDuration } from '@/lib/client'
import { cn } from '@/lib/utils'

const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F']

export interface ResultView {
  attempt: {
    id: string; examTitle: string; patternName: string; status: string
    totalMarks: number | null; maxMarks: number | null; timeSpentSeconds: number | null
  }
  sections: { key: string; marks: number; max: number; correct: number; wrong: number; unattempted: number }[]
  review: {
    examQuestionId: string; order: number; section: string
    question: {
      publicId: string; type: string; text: string
      options: { idx: number; text: string; isCorrect: boolean }[]
      images: { url: string; altText: string }[]
      chapterName: string; difficulty: string; sourceYear: number | null
      numericalAnswer: string | null; numericalTolerance: string | null
    }
    yourAnswer: { selectedOptions: number[]; numericalValue: string | null; isCorrect: boolean | null; marksAwarded: number; timeSpentSeconds: number }
    solution: QuestionSolution | null
  }[]
}

export function ResultScreen({ data, onBack }: { data: ResultView; onBack: () => void }) {
  const a = data.attempt
  const totalQ = data.review.length
  const attempted = data.review.filter((r) => r.yourAnswer.isCorrect !== null).length
  const correct = data.review.filter((r) => r.yourAnswer.isCorrect === true).length
  const accuracy = attempted > 0 ? Math.round((correct / attempted) * 100) : 0
  const [openSolutions, setOpenSolutions] = useState<Record<string, boolean>>({})
  const [filter, setFilter] = useState<'all' | 'wrong' | 'unattempted' | 'correct'>('all')
  const filteredReview = data.review.filter((r) =>
    filter === 'all' ? true
      : filter === 'wrong' ? r.yourAnswer.isCorrect === false
        : filter === 'unattempted' ? r.yourAnswer.isCorrect === null
          : r.yourAnswer.isCorrect === true
  )

  return (
    <div className="mx-auto max-w-4xl">
      <Button variant="ghost" size="sm" onClick={onBack} className="mb-4">
        <ChevronLeft className="mr-2 h-4 w-4" /> Back to mock tests
      </Button>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="nexus-glow">
          <CardHeader className="text-center">
            <Trophy className="mx-auto h-10 w-10 text-primary" />
            <CardTitle className="text-2xl">{a.examTitle}</CardTitle>
            <p className="text-sm text-muted-foreground">{a.patternName}{a.status === 'expired' && ' · auto-submitted at time limit'}</p>
          </CardHeader>
          <CardContent>
            <div className="text-center">
              <div className="text-5xl font-bold text-primary">
                {a.totalMarks ?? 0}<span className="text-xl text-muted-foreground"> / {a.maxMarks ?? 0}</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {correct} correct · {attempted - correct} incorrect · {totalQ - attempted} unattempted · accuracy {accuracy}%
              </p>
              <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" /> Time spent: {formatDuration(a.timeSpentSeconds ?? 0)}
              </p>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {data.sections.map((s) => (
                <div key={s.key} className="rounded-xl border border-border p-4 text-center">
                  <div className="text-sm font-semibold capitalize" style={{ color: SUBJECT_COLORS[s.key] }}>{s.key}</div>
                  <div className="mt-1 text-xl font-bold">{s.marks} / {s.max}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{s.correct} ✓ · {s.wrong} ✗ · {s.unattempted} —</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Question-wise review</h2>
        <div className="flex flex-wrap gap-1.5">
          {([
            ['all', `All ${totalQ}`],
            ['wrong', `Incorrect ${attempted - correct}`],
            ['unattempted', `Skipped ${totalQ - attempted}`],
            ['correct', `Correct ${correct}`],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn('rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                filter === key
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/40')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 space-y-3">
        {filteredReview.length === 0 && (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Nothing in this category — nice work.
          </p>
        )}
        {filteredReview.map((r) => {
          const open = !!openSolutions[r.examQuestionId]
          return (
            <Card key={r.examQuestionId}>
              <CardContent className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>Q{r.order + 1} · {r.question.publicId} · {r.question.chapterName}</span>
                  <span className={cn('font-bold',
                    r.yourAnswer.marksAwarded > 0 ? 'text-emerald-400' : r.yourAnswer.marksAwarded < 0 ? 'text-rose-400' : 'text-muted-foreground')}>
                    {r.yourAnswer.marksAwarded > 0 ? '+' : ''}{r.yourAnswer.marksAwarded} marks
                  </span>
                </div>
                <div className="mt-2 min-w-0 break-words text-sm leading-relaxed"><MathText text={r.question.text} /></div>
                {r.question.type !== 'numerical' && (
                  <div className="mt-3 space-y-1.5">
                    {r.question.options.map((opt) => {
                      const chosen = r.yourAnswer.selectedOptions.includes(opt.idx)
                      return (
                        <div key={opt.idx} className={cn('flex items-start gap-2.5 rounded-lg border px-3 py-2 text-sm',
                          opt.isCorrect && 'border-emerald-400/50 bg-emerald-400/[0.08]',
                          chosen && !opt.isCorrect && 'border-rose-400/50 bg-rose-400/[0.08]',
                          !chosen && !opt.isCorrect && 'border-border/50 opacity-60')}>
                          <span className="font-semibold text-muted-foreground">{OPTION_LABELS[opt.idx]}.</span>
                          <span className="min-w-0 flex-1"><MathText text={opt.text} /></span>
                          {opt.isCorrect && <span className="text-[11px] font-semibold text-emerald-400">correct</span>}
                          {chosen && !opt.isCorrect && <span className="text-[11px] font-semibold text-rose-400">your answer</span>}
                        </div>
                      )
                    })}
                  </div>
                )}
                {r.question.type === 'numerical' && (
                  <p className="mt-3 text-sm">
                    <span className="text-muted-foreground">Your answer: </span>
                    <span className={cn('font-mono font-semibold', r.yourAnswer.isCorrect ? 'text-emerald-400' : 'text-rose-400')}>
                      {r.yourAnswer.numericalValue ?? '—'}
                    </span>
                    <span className="text-muted-foreground"> · Correct: </span>
                    <span className="font-mono font-semibold text-primary">{r.question.numericalAnswer}</span>
                  </p>
                )}
                {r.solution && (
                  <Button variant="ghost" size="sm" className="mt-2 text-primary" onClick={() => setOpenSolutions((s) => ({ ...s, [r.examQuestionId]: !s[r.examQuestionId] }))}>
                    {open ? 'Hide solution' : 'Show detailed solution'}
                  </Button>
                )}
                {open && r.solution && <SolutionView solution={r.solution} />}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
