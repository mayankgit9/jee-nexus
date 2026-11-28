'use client'

// JEE NEXUS — random practice engine view (+ daily challenge mode)
import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Dice5, Filter, Layers, RefreshCw, ArrowRight, Trophy, Target, Clock, CalendarCheck, CheckCircle2, XCircle, Home, NotebookPen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { QuestionCard } from '@/components/QuestionCard'
import type { PublicQuestion, QuestionSolution, SubmittedResult, SubjectKey } from '@/lib/types'
import { api, navigate, useApi } from '@/lib/client'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

interface TaxonomySubject {
  key: SubjectKey
  name: string
  chapters: { key: string; name: string; unit: string | null; questionCount: number }[]
}

interface DailyPayload {
  date: string
  question: PublicQuestion | null
  attemptedCount: number
  answered: { isCorrect: boolean | null; selectedOptions?: number[]; numericalValue?: string; submittedAt: string } | null
  solution?: QuestionSolution | null
}

/** "26 Nov 2026" — pinned to IST noon so the date never shifts with the viewer's TZ */
const formatDailyDate = (iso: string) =>
  new Date(`${iso}T12:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

interface Props {
  taxonomy: TaxonomySubject[] | null
  loggedIn: boolean
  onRequireAuth: () => void
  /** prefill from the URL hash query (subject chips on Home, weak-chapter launcher) */
  initialSubject?: string
  initialChapters?: string[]
  /** '1' → today's Daily Challenge session */
  dailyParam?: string
  /** <questionId> → Mistake-Notebook retry flow (Part C) */
  retryParam?: string
}

export function PracticeView({ taxonomy, loggedIn, onRequireAuth, initialSubject, initialChapters, dailyParam, retryParam }: Props) {
  // Only offer years that actually have imported questions (the PYQ overview
  // is the source of truth; hardcoded chips offered empty years like 2026).
  const pyqYears = useApi<{ years: { year: number }[] }>('/api/pyq')
  const YEARS = useMemo(
    () => (pyqYears.data?.years ?? []).map((y) => y.year).sort((a, b) => b - a),
    [pyqYears.data]
  )
  const [subject, setSubject] = useState<string>(() => {
    if (initialSubject && (initialSubject === 'all' || (taxonomy ?? []).some((s) => s.key === initialSubject))) {
      return initialSubject
    }
    // chapter keys carry the subject prefix ("physics:gravitation") — when the
    // prefill chapters all share one subject, select it so the chapter picker
    // (and the pre-checked boxes) are visible immediately
    if (initialChapters?.length) {
      const prefixes = [...new Set(initialChapters.map((k) => k.split(':')[0]))]
      const key = prefixes.length === 1 ? prefixes[0] : undefined
      if (key && (taxonomy ?? []).some((s) => s.key === key)) return key
    }
    return 'all'
  })
  const [chapters, setChapters] = useState<string[]>(initialChapters ?? [])

  // ---------- daily challenge mode ----------
  const isDaily = dailyParam === '1'
  const [daily, setDaily] = useState<DailyPayload | null>(null)
  const [dailyError, setDailyError] = useState(false)
  const dailyInit = useRef(false)
  useEffect(() => {
    if (!isDaily || dailyInit.current) return
    dailyInit.current = true
    api<DailyPayload>('/api/daily')
      .then((d) => {
        setDaily(d)
        // not answered yet → jump straight into the question; answered → review card below
        if (!d.answered && d.question) {
          setSession([d.question])
          setQIndex(0)
          setResults([])
          setShowFilters(false)
        }
      })
      .catch(() => setDailyError(true))
  }, [isDaily])
  const dailyInitialResult = useMemo<SubmittedResult | null>(
    () => (daily?.answered ? { isCorrect: daily.answered.isCorrect, solution: daily.solution ?? null } : null),
    [daily]
  )
  const [years, setYears] = useState<number[]>([])
  const [difficulties, setDifficulties] = useState<string[]>([])
  const [types, setTypes] = useState<string[]>([])
  const [count, setCount] = useState(10)
  const [includeAttempted, setIncludeAttempted] = useState(false)

  // ---------- mistake-notebook retry mode (Part C) ----------
  // The question loads WITHOUT the previous answer or correct answer; after
  // submission the new attempt is shown side-by-side with the previous one.
  const [retry, setRetry] = useState<{ question: PublicQuestion; previous: { selectedOptions?: number[]; numericalValue?: string; at: string; wasCorrect: boolean | null } | null } | null>(null)
  const [retryError, setRetryError] = useState(false)
  const [retryResult, setRetryResult] = useState<SubmittedResult | null>(null)
  const retryInit = useRef(false)
  useEffect(() => {
    if (!retryParam || retryInit.current) return
    retryInit.current = true
    Promise.all([
      api<{ question: PublicQuestion }>(`/api/questions/detail?id=${encodeURIComponent(retryParam)}`),
      api<{ entry: { lastAnswer: { selectedOptions?: number[]; numericalValue?: string; at: string } | null; mistakeCount: number } | null }>(
        `/api/mistakes?questionId=${encodeURIComponent(retryParam)}`
      ).catch(() => ({ entry: null })),
    ])
      .then(([{ question }, { entry }]) => {
        setRetry({
          question,
          previous: entry?.lastAnswer
            ? { ...entry.lastAnswer, wasCorrect: false }
            : null,
        })
        setShowFilters(false)
      })
      .catch(() => setRetryError(true))
  }, [retryParam])

  const [session, setSession] = useState<PublicQuestion[] | null>(null)
  const [qIndex, setQIndex] = useState(0)
  const [results, setResults] = useState<{ result: SubmittedResult; time: number }[]>([])
  const [loading, setLoading] = useState(false)
  const [showFilters, setShowFilters] = useState(true)
  const servedIds = useRef<Set<string>>(new Set())

  const activeSubject = taxonomy?.find((s) => s.key === subject)

  const availableChapters = useMemo(
    () => activeSubject?.chapters.filter((c) => c.questionCount > 0) ?? [],
    [activeSubject]
  )

  const start = async () => {
    setLoading(true)
    try {
      const body: Record<string, unknown> = {
        subject,
        count,
        excludeQuestionIds: [...servedIds.current].slice(-400),
        includeAttempted,
      }
      if (chapters.length) body.chapterKeys = chapters
      if (years.length) body.years = years
      if (difficulties.length) body.difficulties = difficulties
      if (types.length) body.types = types
      const r = await api<{ questions: PublicQuestion[]; message?: string }>('/api/questions/random', body)
      if (!r.questions.length) {
        toast({
          title: 'No questions found',
          description: r.message ?? 'Try widening your filters — or enable "include recently attempted".',
        })
        return
      }
      r.questions.forEach((q) => servedIds.current.add(q.id))
      setSession(r.questions)
      setQIndex(0)
      setResults([])
      setShowFilters(false)
    } catch (e) {
      toast({ title: 'Failed to load questions', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const randomSingle = async () => {
    setLoading(true)
    try {
      const r = await api<{ questions: PublicQuestion[] }>('/api/questions/random', {
        subject: 'all', count: 1, excludeQuestionIds: [...servedIds.current].slice(-400), includeAttempted: true,
      })
      if (r.questions.length) {
        r.questions.forEach((q) => servedIds.current.add(q.id))
        setSession(r.questions)
        setQIndex(0)
        setResults([])
        setShowFilters(false)
      }
    } finally {
      setLoading(false)
    }
  }

  const recordResult = (result: SubmittedResult, time: number) => {
    setResults((r) => [...r, { result, time }])
  }

  const next = () => {
    if (!session) return
    if (qIndex + 1 < session.length) setQIndex(qIndex + 1)
    else setQIndex(session.length) // summary screen
  }

  // ---------- daily: already completed today → review card ----------
  // (skipped while a fresh "practice one more" session is active — showFilters
  // is false the moment randomSingle loads a new question)
  if (isDaily && daily?.answered && daily.question && !session) {
    const answered = daily.answered
    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-2xl">
        <Card className="nexus-glow">
          <CardHeader className="text-center">
            {answered.isCorrect === true ? (
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" />
            ) : answered.isCorrect === false ? (
              <XCircle className="mx-auto h-10 w-10 text-rose-400" />
            ) : (
              <CalendarCheck className="mx-auto h-10 w-10 text-primary" />
            )}
            <CardTitle className="text-2xl">Daily challenge complete</CardTitle>
            <p className="text-sm text-muted-foreground">
              {formatDailyDate(daily.date)} · {daily.attemptedCount.toLocaleString('en-IN')}{' '}
              {daily.attemptedCount === 1 ? 'aspirant' : 'aspirants'} played today
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex justify-center">
              <Badge
                variant="outline"
                className={cn(
                  'px-3 py-1 text-xs',
                  answered.isCorrect === true && 'border-emerald-400/30 bg-emerald-400/10 text-emerald-400',
                  answered.isCorrect === false && 'border-rose-400/30 bg-rose-400/10 text-rose-400',
                  answered.isCorrect === null && 'text-muted-foreground'
                )}
              >
                {answered.isCorrect === true ? 'Correct answer' : answered.isCorrect === false ? 'Wrong answer' : 'Revealed without answering'}
              </Badge>
            </div>
            <QuestionCard
              question={daily.question}
              readOnly
              loggedIn={loggedIn}
              onRequireAuth={onRequireAuth}
              initialResult={dailyInitialResult}
            />
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <Button variant="outline" onClick={() => navigate('/home')}>
                <Home className="mr-2 h-4 w-4" /> Back to home
              </Button>
              <Button onClick={randomSingle}>
                <Dice5 className="mr-2 h-4 w-4" /> Practice one more
              </Button>
            </div>
            {!loggedIn && (
              <p className="mt-4 text-center text-xs text-muted-foreground">
                Sign in so completions like today&apos;s count toward your streak.
              </p>
            )}
          </CardContent>
        </Card>
      </motion.div>
    )
  }

  // ---------- daily: loading / failure states ----------
  if (isDaily && !daily && !dailyError) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Skeleton className="h-8 w-2/3 mx-auto" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-5/6" />
      </div>
    )
  }
  if (isDaily && dailyError) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-dashed border-border p-10 text-center">
        <CalendarCheck className="mx-auto h-10 w-10 text-muted-foreground" />
        <h2 className="mt-4 text-lg font-semibold">Could not load today&apos;s challenge</h2>
        <p className="mt-2 text-sm text-muted-foreground">Check your connection and try again.</p>
        <Button
          className="mt-5"
          onClick={() => {
            setDailyError(false)
            dailyInit.current = false
            api<DailyPayload>('/api/daily')
              .then((d) => {
                setDaily(d)
                if (!d.answered && d.question) {
                  setSession([d.question])
                  setQIndex(0)
                  setResults([])
                  setShowFilters(false)
                }
              })
              .catch(() => setDailyError(true))
          }}
        >
          Retry
        </Button>
      </div>
    )
  }

  // ---------- retry: failure states ----------
  if (retryParam && retryError) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-dashed border-border p-10 text-center">
        <NotebookPen className="mx-auto h-10 w-10 text-muted-foreground" />
        <h2 className="mt-4 text-lg font-semibold">Could not load this question</h2>
        <p className="mt-2 text-sm text-muted-foreground">It may have been removed. Check your connection and try again.</p>
        <div className="mt-5 flex justify-center gap-3">
          <Button variant="outline" onClick={() => navigate('/notebook')}>Back to notebook</Button>
        </div>
      </div>
    )
  }

  // ---------- retry: loading ----------
  if (retryParam && !retry) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-5/6" />
      </div>
    )
  }

  // ---------- retry: active ----------
  if (retry) {
    const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F']
    const prevAnswer = retry.previous
      ? retry.previous.selectedOptions?.length
        ? retry.previous.selectedOptions.map((i) => OPTION_LABELS[i]).join(', ')
        : retry.previous.numericalValue ?? '—'
      : null
    return (
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <NotebookPen className="h-4 w-4" />
            <span>Mistake retry — attempt it cleanly, no peeking</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/notebook')}>
            Back to notebook
          </Button>
        </div>

        <QuestionCard
          key={retry.question.id}
          question={retry.question}
          mode="notebook_retry"
          onSubmit={(r) => setRetryResult(r)}
          loggedIn={loggedIn}
          onRequireAuth={onRequireAuth}
        />

        {/* previous vs new comparison — appears only AFTER the new attempt */}
        {retryResult && retry.previous && (
          <div className="mt-5 rounded-xl border border-border bg-card p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Your attempts, side by side
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-rose-400/25 bg-rose-400/[0.06] p-3">
                <p className="text-xs text-rose-300/90">Previous attempt (incorrect)</p>
                <p className="mt-1 font-mono text-sm">{prevAnswer ?? 'No answer'}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {retry.previous.at ? new Date(retry.previous.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : ''}
                </p>
              </div>
              <div className="rounded-lg border border-primary/25 bg-primary/[0.06] p-3">
                <p className="text-xs text-primary">This attempt</p>
                <p className="mt-1 text-sm font-semibold">
                  {retryResult.isCorrect === true ? 'Correct — mistake corrected!' : retryResult.isCorrect === false ? 'Still incorrect — it stays in your notebook.' : 'Recorded'}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ---------- summary ----------
  if (session && qIndex >= session.length) {
    const correct = results.filter((r) => r.result.isCorrect === true).length
    const wrong = results.filter((r) => r.result.isCorrect === false).length
    const answered = results.length
    const accuracy = answered > 0 ? Math.round((correct / answered) * 100) : 0
    const totalTime = results.reduce((a, r) => a + r.time, 0)
    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-2xl">
        <Card className="nexus-glow">
          <CardHeader className="text-center">
            {isDaily ? (
              <>
                <CalendarCheck className="mx-auto h-10 w-10 text-primary" />
                <CardTitle className="text-2xl">Daily challenge complete</CardTitle>
                {daily && (
                  <p className="text-sm text-muted-foreground">
                    {formatDailyDate(daily.date)} · {daily.attemptedCount.toLocaleString('en-IN')}{' '}
                    {daily.attemptedCount === 1 ? 'aspirant' : 'aspirants'} played today
                  </p>
                )}
              </>
            ) : (
              <>
                <Trophy className="mx-auto h-10 w-10 text-primary" />
                <CardTitle className="text-2xl">Session complete</CardTitle>
              </>
            )}
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'Questions', value: session.length, icon: Layers },
                { label: 'Answered', value: answered, icon: Target },
                { label: 'Correct', value: correct, icon: Trophy },
                { label: 'Accuracy', value: `${accuracy}%`, icon: Target },
              ].map((s) => (
                <div key={s.label} className="rounded-xl border border-border bg-muted/40 p-4 text-center">
                  <s.icon className="mx-auto mb-1.5 h-4 w-4 text-primary" />
                  <div className="text-2xl font-bold">{s.value}</div>
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                </div>
              ))}
            </div>
            <p className="mt-4 flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" /> Total time: {Math.floor(totalTime / 60)}m {totalTime % 60}s
              {answered > 0 && <> · avg {Math.round(totalTime / answered)}s per question</>}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              {isDaily ? (
                <>
                  <Button variant="outline" onClick={() => navigate('/home')}>
                    <Home className="mr-2 h-4 w-4" /> Back to home
                  </Button>
                  <Button onClick={() => { setSession(null); setShowFilters(true) }}>
                    <Dice5 className="mr-2 h-4 w-4" /> Practice more
                  </Button>
                </>
              ) : (
                <Button onClick={() => { setSession(null); setShowFilters(true) }}>
                  <RefreshCw className="mr-2 h-4 w-4" /> New session
                </Button>
              )}
            </div>
            {!loggedIn && (
              <p className="mt-4 text-center text-xs text-muted-foreground">
                Create a free account to save attempts, track accuracy over time and bookmark questions.
              </p>
            )}
          </CardContent>
        </Card>
      </motion.div>
    )
  }

  // ---------- active question ----------
  if (session && !showFilters) {
    const q = session[qIndex]
    return (
      <div className="mx-auto max-w-3xl">
        {isDaily ? (
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-primary">
              <CalendarCheck className="h-4 w-4" />
              <span>Daily challenge{daily ? ` · ${formatDailyDate(daily.date)}` : ''}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/home')}>
              Exit
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Dice5 className="h-4 w-4 text-primary" />
                <span>{results.length} answered · {session.length - results.length} left</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setSession(null); setShowFilters(true) }}>
                End session
              </Button>
            </div>
            <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(qIndex / session.length) * 100}%` }} />
            </div>
          </>
        )}

        <QuestionCard
          key={q.id}
          question={q}
          index={qIndex}
          total={session.length}
          onSubmit={recordResult}
          loggedIn={loggedIn}
          onRequireAuth={onRequireAuth}
        />

        <div className="mt-5 flex justify-end">
          <Button onClick={next} size="lg" className="min-w-[180px]">
            {qIndex + 1 < session.length ? 'Next question' : 'Finish session'}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    )
  }

  // ---------- filter / setup screen ----------
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
          <Dice5 className="h-6 w-6 text-primary" /> Random Practice
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure your session — questions you&apos;ve attempted recently are automatically avoided.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base"><Filter className="h-4 w-4 text-primary" /> Session setup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Label className="text-sm font-semibold">Subject</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {[{ key: 'all', name: 'All subjects' }, ...(taxonomy ?? [])].map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => { setSubject(s.key); setChapters([]) }}
                  className={`rounded-lg border px-3.5 py-1.5 text-sm transition-colors ${
                    subject === s.key ? 'border-primary bg-primary/15 font-semibold text-primary' : 'border-border hover:border-primary/40'
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>

          {subject !== 'all' && availableChapters.length > 0 && (
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Chapters <span className="font-normal text-muted-foreground">(optional — leave empty for all)</span></Label>
                {chapters.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setChapters([])}>Clear</Button>
                )}
              </div>
              <ScrollArea className="mt-2 max-h-48 rounded-lg border border-border p-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {availableChapters.map((c) => (
                    <label key={c.key} className="flex cursor-pointer items-start gap-2 text-sm">
                      <Checkbox
                        checked={chapters.includes(c.key)}
                        onCheckedChange={(v) =>
                          setChapters((cs) => (v ? [...cs, c.key] : cs.filter((k) => k !== c.key)))
                        }
                        className="mt-0.5"
                      />
                      <span className="leading-tight">
                        {c.name}
                        <span className="ml-1 text-xs text-muted-foreground">({c.questionCount})</span>
                      </span>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          <Separator />

          <div>
            <Label className="text-sm font-semibold">Years <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {YEARS.length === 0 && <span className="text-sm text-muted-foreground">Loading years…</span>}
              {YEARS.map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => setYears((ys) => (ys.includes(y) ? ys.filter((x) => x !== y) : [...ys, y]))}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                    years.includes(y) ? 'border-primary bg-primary/15 font-semibold text-primary' : 'border-border hover:border-primary/40'
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Label className="text-sm font-semibold">Difficulty</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {['easy', 'medium', 'hard'].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDifficulties((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d]))}
                    className={`rounded-lg border px-3 py-1.5 text-sm capitalize transition-colors ${
                      difficulties.includes(d) ? 'border-primary bg-primary/15 font-semibold text-primary' : 'border-border hover:border-primary/40'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-sm font-semibold">Question type</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {[{ k: 'mcq_single', l: 'Single MCQ' }, { k: 'mcq_multi', l: 'Multi MCQ' }, { k: 'numerical', l: 'Numerical' }].map((t) => (
                  <button
                    key={t.k}
                    type="button"
                    onClick={() => setTypes((ts) => (ts.includes(t.k) ? ts.filter((x) => x !== t.k) : [...ts, t.k]))}
                    className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                      types.includes(t.k) ? 'border-primary bg-primary/15 font-semibold text-primary' : 'border-border hover:border-primary/40'
                    }`}
                  >
                    {t.l}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <Separator />

          <div>
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">Number of questions</Label>
              <Badge variant="secondary" className="font-mono">{count}</Badge>
            </div>
            <Slider
              className="mt-3"
              min={1}
              max={20}
              step={1}
              value={[count]}
              onValueChange={([v]) => setCount(v)}
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <Checkbox checked={includeAttempted} onCheckedChange={(v) => setIncludeAttempted(!!v)} />
            <span>
              Revision mode <span className="text-muted-foreground">— include questions I attempted in the last 14 days</span>
            </span>
          </label>

          <div className="flex flex-wrap gap-3 pt-1">
            <Button size="lg" onClick={start} disabled={loading} className="min-w-[200px]">
              {loading ? 'Preparing…' : 'Start practicing'}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button size="lg" variant="outline" onClick={randomSingle} disabled={loading}>
              <Dice5 className="mr-2 h-4 w-4" /> Surprise me — 1 random question
            </Button>
          </div>
        </CardContent>
      </Card>

      {!taxonomy && (
        <div className="mt-4 space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-3/4" />
        </div>
      )}
    </div>
  )
}
