'use client'

// JEE NEXUS — exam result screen with question-wise review + analytics (Part E)
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Trophy, Clock, ChevronLeft, BarChart3, Timer, BookOpen, Crosshair, TrendingUp, TrendingDown,
  AlertTriangle, RefreshCw, Target, ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { MathText } from '@/components/MathText'
import { SolutionView } from '@/components/QuestionCard'
import type { QuestionSolution } from '@/lib/types'
import { SUBJECT_COLORS, api, formatDuration } from '@/lib/client'
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

// ---------- advanced analytics types (GET /api/exam/analytics, Part E) ----------
interface AnalyticsSubjectScore {
  key: string; marks: number; max: number; correct: number; incorrect: number
  unattempted: number; negative: number; accuracy: number; time: number
}
interface AnalyticsPerQuestion {
  questionId: string; publicId: string; order: number; section: string
  chapterName: string; type: string; seconds: number; isCorrect: boolean | null; attempted: boolean
}
interface AnalyticsChapter {
  key: string; name: string; subject: string; total: number; correct: number; incorrect: number
  unattempted: number; marks: number; negative: number; time: number; accuracy: number | null
}
interface AnalyticsObservation {
  questionId: string; publicId: string; section: string; chapterName: string; order: number
  timeSpentSeconds: number; yourAverageSeconds: number | null
  problem: 'slow_and_wrong' | 'slow_but_right' | 'fast_and_wrong'
  message: string
}
interface AnalyticsReport {
  attempt: { id: string; examTitle: string; kind: string; submittedAt: string | null; timeSpentSeconds: number | null }
  score: {
    totalMarks: number; maxMarks: number; percentage: number; accuracy: number
    correct: number; incorrect: number; unattempted: number; negative: number
    subjects: AnalyticsSubjectScore[]
  }
  time: {
    total: number; averagePerQuestion: number; perQuestion: AnalyticsPerQuestion[]
    typeAverage: Record<string, number | null>; slowest: AnalyticsPerQuestion[]
  }
  chapters: {
    all: AnalyticsChapter[]; weakest: AnalyticsChapter[]; strongest: AnalyticsChapter[]
    mostNegative: AnalyticsChapter[]; needsRevision: AnalyticsChapter[]
  }
  selection: { observations: AnalyticsObservation[] }
}
interface HistoryTimelineEntry {
  index: number; attemptId: string; title: string; kind: string; submittedAt: string | null
  totalMarks: number; maxMarks: number; accuracy: number | null; correct: number; incorrect: number
  negative: number; avgSecondsPerQuestion: number | null
  subjects: { key: string; marks: number; accuracy: number | null }[]
}
interface HistoryTrends {
  timeline: HistoryTimelineEntry[]
  chapterTrends: Record<string, { name: string; points: { attemptIndex: number; accuracy: number | null }[] }>
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

      <div className="mt-8">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <BarChart3 className="h-5 w-5 text-primary" /> Analytics
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Time, chapter and question-selection insights from this attempt, plus your mock-to-mock trend.
        </p>
        <div className="mt-3">
          <AnalyticsSection attemptId={a.id} />
        </div>
      </div>

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

/** Small chip: how a question ended up (correct / incorrect / skipped). */
function QuestionStateBadge({ isCorrect, attempted }: { isCorrect: boolean | null; attempted: boolean }) {
  if (!attempted) return <Badge variant="outline" className="text-muted-foreground">skipped</Badge>
  if (isCorrect) return <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 text-emerald-400">correct</Badge>
  return <Badge variant="outline" className="border-rose-400/30 bg-rose-400/10 text-rose-400">incorrect</Badge>
}

/** Delta pill for the Compare tab — emerald when the change is an improvement. */
function DeltaChip({ delta, good }: { delta: number; good: 'higher' | 'lower' }) {
  if (Math.abs(delta) < 0.005) return <span className="text-[11px] text-muted-foreground">no change</span>
  const up = delta > 0
  const improved = good === 'higher' ? up : !up
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
      improved ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-400' : 'border-rose-400/30 bg-rose-400/10 text-rose-400')}>
      <Icon className="h-3 w-3" />
      {delta > 0 ? '+' : ''}{delta}
    </span>
  )
}

/** One "previous → latest" stat row in the Compare tab. */
function ComparisonRow({ label, latest, previous, good, suffix = '' }: {
  label: string; latest: number | null; previous: number | null; good: 'higher' | 'lower'; suffix?: string
}) {
  const delta = latest !== null && previous !== null ? Math.round((latest - previous) * 100) / 100 : null
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
      <span className="capitalize text-muted-foreground">{label}</span>
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">
          {previous === null ? '—' : `${previous}${suffix}`}
          <ChevronRight className="mx-0.5 inline h-3 w-3" />
          <span className="text-foreground">{latest === null ? '—' : `${latest}${suffix}`}</span>
        </span>
        {delta !== null && <DeltaChip delta={delta} good={good} />}
      </span>
    </div>
  )
}

/** Advanced analytics area (Part E) — tabs of insights below the score summary. */
function AnalyticsSection({ attemptId }: { attemptId: string }) {
  const [report, setReport] = useState<AnalyticsReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [tab, setTab] = useState('time')
  const [history, setHistory] = useState<HistoryTrends | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyNonce, setHistoryNonce] = useState(0)

  // per-mock analytics load with the section
  useEffect(() => {
    let alive = true
    const run = () => {
      setLoading(true)
      setError(null)
      api<AnalyticsReport>(`/api/exam/analytics?attemptId=${encodeURIComponent(attemptId)}`)
        .then((r) => { if (alive) setReport(r) })
        .catch((e) => { if (alive) setError((e as Error).message) })
        .finally(() => { if (alive) setLoading(false) })
    }
    // defer to microtask: avoids synchronous setState inside the effect body
    Promise.resolve().then(run)
    return () => { alive = false }
  }, [attemptId, reloadNonce])

  // cross-mock history loads the first time the Compare tab is opened
  // (historyOpen is set from the Tabs onValueChange handler)
  useEffect(() => {
    if (!historyOpen) return
    let alive = true
    const run = () => {
      setHistoryLoading(true)
      setHistoryError(null)
      api<HistoryTrends>('/api/exam/analytics')
        .then((h) => { if (alive) setHistory(h) })
        .catch((e) => { if (alive) setHistoryError((e as Error).message) })
        .finally(() => { if (alive) setHistoryLoading(false) })
    }
    // defer to microtask: avoids synchronous setState inside the effect body
    Promise.resolve().then(run)
    return () => { alive = false }
  }, [historyOpen, historyNonce])

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-56 w-full" />
      </div>
    )
  }

  if (error || !report) {
    return (
      <div className="rounded-xl border border-dashed border-border p-5">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
          {error ?? 'Analytics are unavailable for this attempt.'}
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => setReloadNonce((n) => n + 1)}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" /> Retry
        </Button>
      </div>
    )
  }

  const strongKeys = new Set(report.chapters.strongest.map((c) => c.key))
  const weakKeys = new Set(report.chapters.weakest.map((c) => c.key))
  const maxSubjectTime = Math.max(1, ...report.score.subjects.map((s) => s.time))
  const timeline = history?.timeline ?? []
  const latest = timeline.length >= 2 ? timeline[timeline.length - 1] : null
  const previous = timeline.length >= 2 ? timeline[timeline.length - 2] : null

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => {
        setTab(v)
        if (v === 'compare') setHistoryOpen(true)
      }}
    >
      <TabsList className="w-full justify-start overflow-x-auto">
        <TabsTrigger value="time"><Timer className="h-3.5 w-3.5" /> Time</TabsTrigger>
        <TabsTrigger value="chapters"><BookOpen className="h-3.5 w-3.5" /> Chapters</TabsTrigger>
        <TabsTrigger value="selection"><Crosshair className="h-3.5 w-3.5" /> Selection</TabsTrigger>
        <TabsTrigger value="compare"><TrendingUp className="h-3.5 w-3.5" /> Compare</TabsTrigger>
      </TabsList>

      {/* ---------- Time ---------- */}
      <TabsContent value="time" className="mt-3 space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-border p-4 text-center">
            <Clock className="mx-auto mb-1.5 h-4 w-4 text-primary" />
            <div className="text-xl font-bold">{formatDuration(report.time.total)}</div>
            <div className="text-xs text-muted-foreground">Time on questions</div>
          </div>
          <div className="rounded-xl border border-border p-4 text-center">
            <Timer className="mx-auto mb-1.5 h-4 w-4 text-primary" />
            <div className="text-xl font-bold">{report.time.averagePerQuestion}s</div>
            <div className="text-xs text-muted-foreground">Average per question</div>
          </div>
          <div className="rounded-xl border border-border p-4 text-center">
            <Target className="mx-auto mb-1.5 h-4 w-4 text-primary" />
            <div className="text-xl font-bold">{report.score.accuracy}%</div>
            <div className="text-xs text-muted-foreground">Accuracy on attempted</div>
          </div>
        </div>

        {report.score.subjects.length > 0 && (
          <div className="rounded-xl border border-border p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Time by subject</p>
            <div className="space-y-3">
              {report.score.subjects.map((s) => (
                <div key={s.key}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                    <span className="font-semibold capitalize" style={{ color: SUBJECT_COLORS[s.key] }}>{s.key}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDuration(s.time)}
                      {report.time.total > 0 && ` · ${Math.round((s.time / report.time.total) * 100)}%`}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.max(2, Math.round((s.time / maxSubjectTime) * 100))}%`, background: SUBJECT_COLORS[s.key] }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-xl border border-border p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">5 slowest questions</p>
          {report.time.slowest.length === 0 ? (
            <p className="text-sm text-muted-foreground">No timing data recorded for this test.</p>
          ) : (
            <div className="space-y-2">
              {report.time.slowest.map((q) => (
                <div key={q.questionId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="font-semibold">Q{q.order + 1}</span>
                    <span className="text-muted-foreground"> · {q.chapterName}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{formatDuration(q.seconds)}</span>
                    <QuestionStateBadge isCorrect={q.isCorrect} attempted={q.attempted} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </TabsContent>

      {/* ---------- Chapters ---------- */}
      <TabsContent value="chapters" className="mt-3 space-y-4">
        {report.chapters.needsRevision.length > 0 && (
          <div className="rounded-xl border border-rose-400/25 bg-rose-400/[0.06] p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-rose-300">
              <Target className="h-4 w-4" /> Needs revision
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {report.chapters.needsRevision.map((c) => (
                <Badge key={c.key} variant="outline" className="border-rose-400/30 bg-rose-400/10 text-rose-300">
                  {c.name}{c.accuracy !== null && ` · ${c.accuracy}%`}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {report.chapters.all.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No chapter data for this test.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Chapter</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead className="text-center">Attempted</TableHead>
                  <TableHead className="text-center">Correct</TableHead>
                  <TableHead>Accuracy</TableHead>
                  <TableHead className="text-right">Marks</TableHead>
                  <TableHead className="text-right">Negative</TableHead>
                  <TableHead className="text-right">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.chapters.all.map((c) => {
                  const isStrong = strongKeys.has(c.key)
                  const isWeak = weakKeys.has(c.key)
                  return (
                    <TableRow key={c.key} className={cn(isStrong && 'bg-emerald-400/[0.06]', isWeak && 'bg-rose-400/[0.06]')}>
                      <TableCell className="max-w-[180px] truncate font-medium">
                        {c.name}
                        {isStrong && <span className="ml-2 whitespace-nowrap text-[10px] font-bold uppercase text-emerald-400">strongest</span>}
                        {isWeak && <span className="ml-2 whitespace-nowrap text-[10px] font-bold uppercase text-rose-400">weakest</span>}
                      </TableCell>
                      <TableCell className="capitalize" style={{ color: SUBJECT_COLORS[c.subject] }}>{c.subject}</TableCell>
                      <TableCell className="text-center">{c.total - c.unattempted}<span className="text-muted-foreground"> / {c.total}</span></TableCell>
                      <TableCell className="text-center">{c.correct}</TableCell>
                      <TableCell>
                        {c.accuracy === null ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-muted">
                              <div
                                className={cn('h-full rounded-full',
                                  c.accuracy >= 60 ? 'bg-emerald-400' : c.accuracy >= 40 ? 'bg-amber-400' : 'bg-rose-400')}
                                style={{ width: `${c.accuracy}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground">{c.accuracy}%</span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold">{c.marks}</TableCell>
                      <TableCell className={cn('text-right', c.negative < 0 && 'text-rose-400')}>{c.negative}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">{formatDuration(c.time)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </TabsContent>

      {/* ---------- Selection insights ---------- */}
      <TabsContent value="selection" className="mt-3 space-y-3">
        {report.selection.observations.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No inefficient question selection detected in this test.
          </p>
        ) : (
          report.selection.observations.map((o) => (
            <Card key={o.questionId}>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="min-w-0 truncate">Q{o.order + 1} · {o.publicId} · {o.chapterName}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="font-mono">{formatDuration(o.timeSpentSeconds)}</span>
                    {o.problem === 'slow_but_right' ? (
                      <Badge variant="outline" className="border-amber-400/30 bg-amber-400/10 text-amber-400">slow but right</Badge>
                    ) : o.problem === 'slow_and_wrong' ? (
                      <Badge variant="outline" className="border-rose-400/30 bg-rose-400/10 text-rose-400">slow and wrong</Badge>
                    ) : (
                      <Badge variant="outline" className="border-rose-400/30 bg-rose-400/10 text-rose-400">rushed and wrong</Badge>
                    )}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed">&ldquo;{o.message}&rdquo;</p>
              </CardContent>
            </Card>
          ))
        )}
      </TabsContent>

      {/* ---------- Compare (mock-to-mock trend) ---------- */}
      <TabsContent value="compare" className="mt-3 space-y-4">
        {historyLoading && (
          <div className="space-y-3">
            <Skeleton className="h-52 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}

        {!historyLoading && historyError && (
          <div className="rounded-xl border border-dashed border-border p-5">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" /> {historyError}
            </p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setHistoryNonce((n) => n + 1)}>
              <RefreshCw className="mr-2 h-3.5 w-3.5" /> Retry
            </Button>
          </div>
        )}

        {!historyLoading && !historyError && timeline.length < 2 && (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Take more mocks to unlock comparisons.
          </p>
        )}

        {!historyLoading && !historyError && latest && previous && (
          <>
            <div className="rounded-xl border border-border p-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Accuracy across mocks</p>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={timeline} margin={{ top: 8, right: 8, bottom: 0, left: -22 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis
                      dataKey="index"
                      tickFormatter={(v) => `#${v}`}
                      tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tickFormatter={(v) => `${v}%`}
                      tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      formatter={(value) => [`${value}%`, 'Accuracy']}
                      contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="accuracy"
                      name="Accuracy"
                      stroke="var(--primary)"
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: 'var(--primary)' }}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-xl border border-border p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {latest.attemptId === attemptId ? 'This mock vs previous mock' : 'Latest two attempts'}
              </p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{previous.title} → {latest.title}</p>
              <div className="mt-3 space-y-2.5">
                <ComparisonRow label="Marks" latest={latest.totalMarks} previous={previous.totalMarks} good="higher" />
                <ComparisonRow label="Accuracy" latest={latest.accuracy} previous={previous.accuracy} good="higher" suffix="%" />
                <ComparisonRow label="Negative marks" latest={latest.negative} previous={previous.negative} good="lower" />
                {['physics', 'chemistry', 'mathematics'].map((sk) => {
                  const l = latest.subjects.find((s) => s.key === sk)
                  const p = previous.subjects.find((s) => s.key === sk)
                  if (!l || !p) return null
                  return <ComparisonRow key={sk} label={`${sk} marks`} latest={l.marks} previous={p.marks} good="higher" />
                })}
              </div>
            </div>
          </>
        )}
      </TabsContent>
    </Tabs>
  )
}
