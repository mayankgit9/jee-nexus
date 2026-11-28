'use client'

// JEE NEXUS — Today's Revision: spaced-repetition dashboard + session runner
// (Part D, migration 0019). Wrong / skipped practice answers auto-schedule
// into this queue; grading a revision answer moves the question up or down
// the interval ladder (POST /api/questions/submit with mode: 'revision').
import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Repeat, CalendarClock, AlertTriangle, ListChecks, RefreshCw, Target, ArrowRight, SkipForward,
  Trophy, Clock, BookMarked, NotebookPen, BookOpen, Layers, CheckCircle2, XCircle, Home, Loader2, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { QuestionCard } from '@/components/QuestionCard'
import type { PublicQuestion, SubmittedResult, SubjectKey } from '@/lib/types'
import { SUBJECT_META } from '@/lib/types'
import { api, useApi, navigate, formatDuration, SUBJECT_COLORS } from '@/lib/client'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

const SUBJECT_KEYS: SubjectKey[] = ['physics', 'chemistry', 'mathematics']
const SELF_RATINGS = ['easy', 'medium', 'difficult'] as const
type SelfRating = (typeof SELF_RATINGS)[number]

interface SubjectProgress {
  name: string
  due: number
  scheduled: number
  accuracy: number
  revised: number
}

interface RevisionDashboard {
  dueToday: number
  overdue: number
  scheduled: number
  revisedThisWeek: number
  revisionAccuracy: number | null
  subjectProgress: Record<SubjectKey, SubjectProgress>
  upcoming: { day: string; count: number }[]
}

interface TaxonomySubject {
  key: SubjectKey
  name: string
  questionCount: number
  chapters: { key: string; name: string; unit: string | null; questionCount: number }[]
}

interface StartPayload {
  questions: PublicQuestion[]
  scheduled?: number
  message?: string
}

/** where a session came from — replayable via "Revise again" */
interface SessionSource {
  source: 'due' | 'notebook' | 'bookmarks' | 'chapter' | 'subject'
  chapterKey?: string
  subjectKey?: SubjectKey
  label: string
  emptyHint: string
}

interface Props {
  /** omit to let the dashboard fetch's 401 drive the sign-in gate */
  loggedIn?: boolean
  onRequireAuth?: () => void
  /** optional pre-fetched taxonomy — the chapter picker fetches its own otherwise */
  taxonomy?: TaxonomySubject[] | null
}

/** pinned to local noon so the bucketed date never shifts with the viewer's TZ */
const parseDay = (iso: string) => new Date(`${iso}T12:00:00`)

export function RevisionView({ loggedIn, onRequireAuth, taxonomy }: Props) {
  const dash = useApi<RevisionDashboard>(loggedIn === false ? null : '/api/revision')

  // source pickers ("By chapter" needs the taxonomy; "By subject" reads the dashboard)
  const [picker, setPicker] = useState<'chapter' | 'subject' | null>(null)
  const [pickerSubject, setPickerSubject] = useState<SubjectKey>('physics')
  const taxonomyApi = useApi<{ subjects: TaxonomySubject[] }>(
    picker === 'chapter' && !taxonomy ? '/api/taxonomy' : null
  )
  const subjects = taxonomy ?? taxonomyApi.data?.subjects ?? null
  const activeSubject = subjects?.find((s) => s.key === pickerSubject) ?? null

  // ---------- session state ----------
  const [session, setSession] = useState<PublicQuestion[] | null>(null)
  const [lastSource, setLastSource] = useState<SessionSource | null>(null)
  const [qIndex, setQIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, { result: SubmittedResult; time: number }>>({})
  const [ratings, setRatings] = useState<Record<string, SelfRating>>({})
  const [starting, setStarting] = useState(false)

  const authed = loggedIn ?? !!dash.data
  const signIn = () => (onRequireAuth ? onRequireAuth() : navigate('/profile'))

  const startSession = async (src: SessionSource) => {
    if (starting) return
    setStarting(true)
    try {
      const body: Record<string, unknown> = { source: src.source }
      if (src.source === 'chapter') body.chapterKey = src.chapterKey
      if (src.source === 'subject') body.subjectKey = src.subjectKey
      const r = await api<StartPayload>('/api/revision', body)
      if (r.questions.length === 0) {
        toast({ title: 'Nothing to revise yet', description: r.message ?? src.emptyHint })
        return
      }
      setSession(r.questions)
      setLastSource(src)
      setQIndex(0)
      setAnswers({})
      setRatings({})
      setPicker(null)
    } catch (e) {
      toast({ title: 'Could not start the session', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setStarting(false)
    }
  }

  const rateQuestion = async (questionId: string, selfRating: SelfRating) => {
    setRatings((r) => ({ ...r, [questionId]: selfRating }))
    try {
      await api('/api/revision', { questionId, selfRating }, 'PATCH')
    } catch (e) {
      toast({ title: 'Could not save the rating', description: (e as Error).message, variant: 'destructive' })
    }
  }

  const endSession = () => {
    setSession(null)
    setQIndex(0)
    dash.reload()
  }

  // ---------- 401 / error / loading gates ----------
  if (loggedIn === false || dash.error?.includes('Not authenticated')) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-dashed border-border p-10 text-center">
        <Repeat className="mx-auto h-10 w-10 text-muted-foreground" />
        <h2 className="mt-4 text-lg font-semibold">Spaced repetition needs an account</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in free — every wrong or skipped answer is rescheduled automatically, so it comes back right before you&apos;d forget it.
        </p>
        <Button className="mt-5" onClick={signIn}>Sign in / Create account</Button>
      </div>
    )
  }

  if (!dash.data) {
    if (dash.error) {
      return (
        <div className="mx-auto max-w-lg rounded-2xl border border-dashed border-border p-10 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-muted-foreground" />
          <h2 className="mt-4 text-lg font-semibold">Could not load your revision queue</h2>
          <p className="mt-2 text-sm text-rose-400">{dash.error}</p>
          <Button className="mt-5" onClick={() => dash.reload()}>Retry</Button>
        </div>
      )
    }
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
        <Skeleton className="h-44" />
      </div>
    )
  }

  // ---------- session runner ----------
  if (session) {
    const answeredCount = Object.keys(answers).length

    // ----- summary -----
    if (qIndex >= session.length) {
      const correct = session.filter((q) => answers[q.id]?.result.isCorrect === true).length
      const skipped = session.length - answeredCount
      const accuracy = answeredCount > 0 ? Math.round((correct / answeredCount) * 100) : 0
      const totalTime = session.reduce((sum, q) => sum + (answers[q.id]?.time ?? 0), 0)
      return (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-2xl">
          <Card className="nexus-glow">
            <CardHeader className="text-center">
              <Trophy className="mx-auto h-10 w-10 text-primary" />
              <CardTitle className="text-2xl">Revision session complete</CardTitle>
              <p className="text-sm text-muted-foreground">
                {lastSource?.label ?? 'Revision'} · intervals updated — correct answers come back later, mistakes sooner
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'Questions', value: session.length, icon: ListChecks },
                  { label: 'Attempted', value: answeredCount, icon: Repeat },
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
              <p className="mt-4 flex flex-wrap items-center justify-center gap-1.5 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" /> Time spent: {formatDuration(totalTime)}
                {answeredCount > 0 && <> · avg {Math.round(totalTime / answeredCount)}s per question</>}
                {skipped > 0 && <> · {skipped} skipped</>}
              </p>
              <div className="mt-5 space-y-1.5">
                {session.map((q) => {
                  const a = answers[q.id]
                  const rating = ratings[q.id]
                  return (
                    <div key={q.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm">
                      <div className="flex min-w-0 items-center gap-2">
                        {a?.result.isCorrect === true ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                        ) : a?.result.isCorrect === false ? (
                          <XCircle className="h-4 w-4 shrink-0 text-rose-400" />
                        ) : (
                          <SkipForward className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="min-w-0 truncate">{q.chapter.name}</span>
                        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{q.publicId}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                        {rating && (
                          <span className="rounded border border-border px-1.5 py-0.5 text-[10px] capitalize">{rating}</span>
                        )}
                        <span>{a ? `${a.time}s` : 'skipped'}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Button variant="outline" onClick={endSession}>
                  <Home className="mr-2 h-4 w-4" /> Back to dashboard
                </Button>
                <Button onClick={() => lastSource && startSession(lastSource)} disabled={starting}>
                  {starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Revise again
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )
    }

    // ----- active question -----
    const q = session[qIndex]
    const answered = !!answers[q.id]
    return (
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <Repeat className="h-4 w-4 shrink-0 text-primary" />
            <span className="truncate font-medium text-primary">{lastSource?.label ?? 'Revision'}</span>
            <span className="shrink-0 text-muted-foreground">{qIndex + 1} / {session.length} · {answeredCount} answered</span>
          </div>
          <Button variant="ghost" size="sm" onClick={endSession}>
            End session
          </Button>
        </div>
        <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(qIndex / session.length) * 100}%` }} />
        </div>

        <QuestionCard
          key={q.id}
          question={q}
          index={qIndex}
          total={session.length}
          onSubmit={(result, time) =>
            setAnswers((a) => (a[q.id] ? a : { ...a, [q.id]: { result, time } }))
          }
          loggedIn={authed}
          onRequireAuth={signIn}
          // Spaced repetition grading: the submit API moves the interval ladder
          // for this question only when mode === 'revision'. Passed via spread
          // so this compiles whether or not QuestionCard's props declare it —
          // React forwards it and QuestionCard picks it up the moment it reads it.
          {...{ mode: 'revision' as const }}
        />

        {answered && (
          <Card className="mt-4">
            <CardContent className="p-4 sm:p-5">
              <p className="text-sm font-semibold">How did it feel?</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Optional — your rating tunes when this question comes back.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {SELF_RATINGS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => rateQuestion(q.id, r)}
                    className={cn(
                      'rounded-lg border px-3.5 py-1.5 text-sm transition-colors',
                      ratings[q.id] === r
                        ? 'border-primary bg-primary/15 font-semibold text-primary'
                        : 'border-border hover:border-primary/40'
                    )}
                  >
                    {r === 'easy' ? 'Easy' : r === 'medium' ? 'Medium' : 'Difficult'}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          {!answered && (
            <Button variant="ghost" onClick={() => setQIndex((i) => Math.min(i + 1, session.length))} className="text-muted-foreground">
              <SkipForward className="mr-2 h-4 w-4" /> Skip
            </Button>
          )}
          <Button
            onClick={() => setQIndex((i) => Math.min(i + 1, session.length))}
            disabled={!answered}
            size="lg"
            className="min-w-[180px]"
          >
            {qIndex + 1 < session.length ? 'Next question' : 'Finish session'}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    )
  }

  // ---------- dashboard ----------
  const d = dash.data
  const upcomingMax = Math.max(1, ...d.upcoming.map((u) => u.count))
  const upcomingTotal = d.upcoming.reduce((a, u) => a + u.count, 0)

  const stats = [
    {
      label: 'Due today', value: d.dueToday, icon: CalendarClock,
      className: 'border-primary/40 bg-primary/[0.06]',
    },
    {
      label: 'Overdue', value: d.overdue, icon: AlertTriangle,
      className: d.overdue > 0 ? 'border-rose-400/40 bg-rose-400/[0.06]' : undefined,
      valueClassName: d.overdue > 0 ? 'text-rose-400' : undefined,
    },
    { label: 'Scheduled', value: d.scheduled, icon: ListChecks },
    { label: 'Revised this week', value: d.revisedThisWeek, icon: RefreshCw },
    {
      label: 'Revision accuracy', value: d.revisionAccuracy == null ? '—' : `${d.revisionAccuracy}%`,
      icon: Target, valueClassName: d.revisionAccuracy != null && d.revisionAccuracy >= 70 ? 'text-emerald-400' : undefined,
    },
  ]

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
        <Repeat className="h-6 w-6 text-primary" /> Today&apos;s Revision
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Spaced repetition — wrong and skipped answers resurface here right before you&apos;d forget them.
      </p>

      {/* headline stats */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <Card key={s.label} className={s.className}>
            <CardContent className="p-4">
              <s.icon className="mb-1.5 h-4 w-4 text-primary" />
              <div className={cn('text-2xl font-bold', s.valueClassName)}>{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* queue hero — primary session launcher */}
      {d.scheduled > 0 ? (
        <Card className="mt-4 nexus-glow">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                {d.scheduled} {d.scheduled === 1 ? 'question' : 'questions'} scheduled · {d.dueToday} due now
                {d.overdue > 0 && <span className="text-rose-400"> · {d.overdue} overdue</span>}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {d.dueToday > 0
                  ? 'Answer honestly — correct questions drift further away, mistakes come back sooner.'
                  : 'Nothing due right now — the queue refills as intervals expire.'}
              </p>
            </div>
            <Button size="lg" onClick={() => startSession(DUE_SOURCE)} disabled={starting || d.dueToday === 0} className="min-w-[200px]">
              {starting ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Preparing…</>
              ) : (
                <>Start revision session <ArrowRight className="ml-2 h-4 w-4" /></>
              )}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-border p-8 text-center">
          <CalendarClock className="mx-auto h-9 w-9 text-muted-foreground" />
          <p className="mt-3 font-medium">Nothing due for revision</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Mistakes and skipped questions collect here automatically — answer a few practice questions and they&apos;ll resurface at the right time.
          </p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/practice')}>
            Practice questions
          </Button>
        </div>
      )}

      {/* subject progress */}
      <Card className="mt-4">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm"><Target className="h-4 w-4 text-primary" /> Subject progress</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {SUBJECT_KEYS.map((k) => {
            const s = d.subjectProgress[k]
            return (
              <div key={k} className="rounded-lg border border-border/60 px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: SUBJECT_COLORS[k] }} />
                    <span className="text-sm font-medium">{SUBJECT_META[k].name}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className={cn('font-normal', s.due > 0 && 'border-primary/40 bg-primary/10 text-primary')}>
                      {s.due} due
                    </Badge>
                    <Badge variant="outline" className="font-normal">{s.scheduled} scheduled</Badge>
                    <Badge variant="outline" className="font-normal">{s.revised > 0 ? `${s.accuracy}%` : '—'} accuracy</Badge>
                    <Badge variant="outline" className="font-normal">{s.revised} revised</Badge>
                  </div>
                </div>
                {s.scheduled > 0 && (
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(s.due / s.scheduled) * 100}%`, background: SUBJECT_COLORS[k] }}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* upcoming 7 days */}
      <Card className="mt-4">
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
            <CalendarClock className="h-4 w-4 text-primary" /> Coming up — next 7 days
            {upcomingTotal === 0 && (
              <span className="text-xs font-normal text-muted-foreground">nothing scheduled yet</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end justify-between gap-1.5 sm:gap-3">
            {d.upcoming.map((u) => (
              <div
                key={u.day}
                className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
                title={`${u.count} ${u.count === 1 ? 'question' : 'questions'} due ${parseDay(u.day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
              >
                <span className="text-[11px] font-semibold text-muted-foreground">{u.count > 0 ? u.count : ''}</span>
                <div className="flex h-24 w-full items-end">
                  <div
                    className={cn('w-full rounded-t-md', u.count > 0 ? 'bg-primary/80' : 'bg-muted')}
                    style={{ height: u.count > 0 ? `${Math.max((u.count / upcomingMax) * 100, 8)}%` : '4%' }}
                  />
                </div>
                <span className="truncate text-[10px] text-muted-foreground">
                  {parseDay(u.day).toLocaleDateString('en-IN', { weekday: 'short' })}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* session sources */}
      <Card className="mt-4">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm"><Layers className="h-4 w-4 text-primary" /> Start a session</CardTitle>
          <p className="text-xs text-muted-foreground">Any pool works — picked questions join the queue and come due right away.</p>
        </CardHeader>
        <CardContent>
          <div className={cn('grid gap-3 sm:grid-cols-2', starting && 'pointer-events-none opacity-60')}>
            <button
              type="button"
              onClick={() => startSession(DUE_SOURCE)}
              disabled={d.dueToday === 0}
              className="flex w-full items-start gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 disabled:pointer-events-none disabled:opacity-50"
            >
              <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  Due questions
                  <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">{d.dueToday} due</Badge>
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  Clear today&apos;s backlog — oldest-due first.
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => startSession(NOTEBOOK_SOURCE)}
              className="flex w-full items-start gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50"
            >
              <NotebookPen className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">From Mistake Notebook</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  Your recent mistakes, resurfaced until they stick.
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => startSession(BOOKMARKS_SOURCE)}
              className="flex w-full items-start gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50"
            >
              <BookMarked className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">From Bookmarks</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  Saved questions, back for another pass.
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setPicker(picker === 'chapter' ? null : 'chapter')}
              className={cn(
                'flex w-full items-start gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/50',
                picker === 'chapter' ? 'border-primary/60' : 'border-border'
              )}
            >
              <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">By chapter</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  Pick a chapter — its questions join the queue.
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setPicker(picker === 'subject' ? null : 'subject')}
              className={cn(
                'flex w-full items-start gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/50',
                picker === 'subject' ? 'border-primary/60' : 'border-border'
              )}
            >
              <Layers className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">By subject</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  Bulk-schedule a whole subject for daily passes.
                </span>
              </span>
            </button>
          </div>

          {/* chapter picker */}
          {picker === 'chapter' && (
            <div className="mt-4 rounded-xl border border-border/70 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">Choose a chapter</p>
                <Button variant="ghost" size="icon" aria-label="Close chapter picker" onClick={() => setPicker(null)} className="h-7 w-7">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {SUBJECT_KEYS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setPickerSubject(k)}
                    className={cn(
                      'rounded-lg border px-3.5 py-1.5 text-sm transition-colors',
                      pickerSubject === k ? 'border-primary bg-primary/15 font-semibold text-primary' : 'border-border hover:border-primary/40'
                    )}
                  >
                    {SUBJECT_META[k].name}
                  </button>
                ))}
              </div>
              <div className="mt-3">
                {taxonomyApi.loading && !subjects && (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9" />)}
                  </div>
                )}
                {taxonomyApi.error && subjects === null && (
                  <p className="py-4 text-center text-sm text-rose-400">
                    Could not load chapters — <button type="button" className="underline" onClick={() => taxonomyApi.reload()}>retry</button>
                  </p>
                )}
                {activeSubject && (
                  <>
                    <ScrollArea className="max-h-64 rounded-lg border border-border p-3">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {activeSubject.chapters.filter((c) => c.questionCount > 0).map((c) => (
                          <button
                            key={c.key}
                            type="button"
                            onClick={() =>
                              startSession({
                                source: 'chapter',
                                chapterKey: c.key,
                                label: `${activeSubject.name} · ${c.name}`,
                                emptyHint: 'This chapter has no questions yet.',
                              })
                            }
                            className="rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:border-primary/50 hover:bg-primary/[0.04]"
                          >
                            {c.name}
                            <span className="ml-1.5 text-xs text-muted-foreground">({c.questionCount})</span>
                          </button>
                        ))}
                      </div>
                    </ScrollArea>
                    {activeSubject.chapters.filter((c) => c.questionCount > 0).length === 0 && (
                      <p className="py-4 text-center text-sm text-muted-foreground">No chapters with questions in this subject yet.</p>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* subject picker */}
          {picker === 'subject' && (
            <div className="mt-4 rounded-xl border border-border/70 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">Choose a subject</p>
                <Button variant="ghost" size="icon" aria-label="Close subject picker" onClick={() => setPicker(null)} className="h-7 w-7">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {SUBJECT_KEYS.map((k) => {
                  const s = d.subjectProgress[k]
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() =>
                        startSession({
                          source: 'subject',
                          subjectKey: k,
                          label: SUBJECT_META[k].name,
                          emptyHint: 'No questions in this subject yet.',
                        })
                      }
                      className="rounded-xl border border-border p-4 text-left transition-colors hover:border-primary/50 hover:bg-primary/[0.04]"
                    >
                      <span className="text-sm font-semibold" style={{ color: SUBJECT_COLORS[k] }}>{SUBJECT_META[k].name}</span>
                      <span className="mt-1.5 block text-xs text-muted-foreground">{s.due} due · {s.scheduled} in queue</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// Session source descriptors (module-level: stable identities, no re-renders)
const DUE_SOURCE: SessionSource = {
  source: 'due',
  label: 'Due questions',
  emptyHint: 'Nothing due right now — the queue refills as intervals expire.',
}
const NOTEBOOK_SOURCE: SessionSource = {
  source: 'notebook',
  label: 'Mistake Notebook',
  emptyHint: 'No mistakes saved yet — wrong answers land here automatically.',
}
const BOOKMARKS_SOURCE: SessionSource = {
  source: 'bookmarks',
  label: 'Bookmarks',
  emptyHint: 'No bookmarks yet — save questions while practicing to revise them here.',
}
