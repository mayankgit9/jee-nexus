'use client'

// JEE NEXUS — study planner view: daily target, 12-week activity heatmap,
// weekly progress, chapter-by-chapter syllabus tracker, mock test history
import { useState, type FormEvent } from 'react'
import {
  AlertTriangle, Atom, BookOpen, CalendarDays, Check, ClipboardList, FlaskConical,
  GraduationCap, LogIn, Pencil, RefreshCw, Sigma, Target, TrendingUp, Trophy,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useApi, api, navigate, formatDuration, SUBJECT_COLORS } from '@/lib/client'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

// ---------- types (GET /api/study) ----------
type SubjectKey = 'physics' | 'chemistry' | 'mathematics'

interface StudyChapter {
  id: string
  key: string
  name: string
  unit: string | null
  status: string
  updatedAt: string | null
  questionCount: number
}

interface StudySubject {
  name: string
  totalChapters: number
  byStatus: Record<string, number>
  chapters: StudyChapter[]
}

interface StudyDay {
  date: string
  count: number
  correct: number
}

interface StudyMock {
  id: string
  title: string
  kind: string
  submittedAt: string
  score: number | null
  maxMarks: number | null
  percentage: number | null
  timeSpentSeconds: number | null
}

interface StudyData {
  subjects: Partial<Record<SubjectKey, StudySubject>>
  today: { questions: number; target: number; targetMet: boolean }
  week: { total: number; correct: number; accuracy: number | null; perDay: StudyDay[]; revised: number; revisionCorrect: number }
  calendar: StudyDay[]
  mocks: StudyMock[]
}

// ---------- vocabulary ----------
const SUBJECT_ORDER: SubjectKey[] = ['physics', 'chemistry', 'mathematics']
const SUBJECT_ICONS: Record<string, LucideIcon> = { physics: Atom, chemistry: FlaskConical, mathematics: Sigma }

// five distinct semantic colors: neutral, amber, emerald, rose, violet
const STATUS_DEFS: { key: string; label: string; bar: string; active: string }[] = [
  {
    key: 'not_started', label: 'Not started', bar: 'bg-muted-foreground/35',
    active: 'bg-muted-foreground/15 text-foreground ring-1 ring-inset ring-muted-foreground/30',
  },
  {
    key: 'learning', label: 'Learning', bar: 'bg-amber-500',
    active: 'bg-amber-500/15 text-amber-400 ring-1 ring-inset ring-amber-500/40',
  },
  {
    key: 'completed', label: 'Completed', bar: 'bg-emerald-500',
    active: 'bg-emerald-500/15 text-emerald-400 ring-1 ring-inset ring-emerald-500/40',
  },
  {
    key: 'revision_required', label: 'Needs revision', bar: 'bg-rose-500',
    active: 'bg-rose-500/15 text-rose-400 ring-1 ring-inset ring-rose-500/40',
  },
  {
    key: 'strong', label: 'Strong', bar: 'bg-violet-500',
    active: 'bg-violet-500/15 text-violet-400 ring-1 ring-inset ring-violet-500/40',
  },
]

// mint intensity scale: 0 muted · 1-4 low · 5-14 mid · 15+ high
const HEAT_LEVELS = ['bg-muted', 'bg-primary/25', 'bg-primary/50', 'bg-primary']
const heatClass = (count: number) =>
  count === 0 ? HEAT_LEVELS[0] : count < 5 ? HEAT_LEVELS[1] : count < 15 ? HEAT_LEVELS[2] : HEAT_LEVELS[3]

/** pinned to local noon so IST day keys never shift across timezones */
const parseDayKey = (iso: string) => new Date(`${iso}T12:00:00`)
const fmtDay = (iso: string) => parseDayKey(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

const fmtMockDate = (iso: string) => {
  const d = new Date(iso)
  return d.getFullYear() === new Date().getFullYear()
    ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

const mockKindLabel = (kind: string) =>
  kind === 'custom' ? 'Custom'
    : kind === 'pyq_year' ? 'PYQ'
      : kind === 'full_length' ? 'Full length'
        : kind === 'subject' ? 'Subject test'
          : 'Chapter test'

const pctTone = (pct: number | null) =>
  pct === null
    ? 'text-muted-foreground'
    : pct >= 70
      ? 'border-primary/40 bg-primary/10 text-primary'
      : pct >= 40
        ? 'border-amber-400/30 bg-amber-400/10 text-amber-400'
        : 'border-rose-400/30 bg-rose-400/10 text-rose-400'

/** status counts with optimistic overrides applied on top of the server payload */
const countByStatus = (chapters: StudyChapter[], overrides: Record<string, string>): Record<string, number> => {
  const counts: Record<string, number> = {}
  for (const ch of chapters) {
    const s = overrides[ch.id] ?? ch.status
    counts[s] = (counts[s] ?? 0) + 1
  }
  return counts
}

// ---------- 12-week activity heatmap (pure CSS grid, no chart lib) ----------
function HeatCalendar({ calendar }: { calendar: StudyDay[] }) {
  if (calendar.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No activity data yet.</p>
  }
  const weeks = Math.max(1, Math.ceil(calendar.length / 7))
  const startDow = calendar.length > 0 ? parseDayKey(calendar[0].date).getDay() : 0
  // month label appears only when the month changes between week columns
  const monthLabels = Array.from({ length: weeks }, (_, w) => {
    const first = parseDayKey(calendar[w * 7].date)
    const prev = w > 0 ? parseDayKey(calendar[(w - 1) * 7].date) : null
    return {
      label: first.toLocaleDateString('en-IN', { month: 'short' }),
      show: !prev || first.getMonth() !== prev.getMonth(),
    }
  })
  const dowLabels = Array.from({ length: 7 }, (_, r) => {
    const dow = (startDow + r) % 7
    return dow === 1 ? 'M' : dow === 3 ? 'W' : dow === 5 ? 'F' : ''
  })
  const activeDays = calendar.filter((d) => d.count > 0).length
  const totalQuestions = calendar.reduce((a, d) => a + d.count, 0)

  return (
    <div>
      <div className="overflow-x-auto pb-1">
        <div className="w-fit">
          {/* month labels — one cell per week column */}
          <div className="flex gap-1.5">
            <div className="w-4 shrink-0" aria-hidden="true" />
            <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${weeks}, 16px)` }}>
              {monthLabels.map((m, i) => (
                <div key={i} className="h-3 text-[9px] leading-3 text-muted-foreground">{m.show ? m.label : ''}</div>
              ))}
            </div>
          </div>
          {/* day-of-week gutter + 7 x 12 cell grid, oldest week on the left */}
          <div className="mt-1 flex gap-1.5">
            <div className="grid w-4 shrink-0 gap-1" style={{ gridTemplateRows: 'repeat(7, 16px)' }}>
              {dowLabels.map((l, r) => (
                <div key={r} className="flex items-center justify-end text-[9px] leading-none text-muted-foreground">{l}</div>
              ))}
            </div>
            <div
              className="grid grid-flow-col gap-1"
              style={{ gridTemplateRows: 'repeat(7, 16px)' }}
              role="img"
              aria-label={`Activity over the last ${calendar.length} days — ${activeDays} active days, ${totalQuestions} questions`}
            >
              {calendar.map((d) => (
                <div
                  key={d.date}
                  title={`${fmtDay(d.date)} · ${d.count === 0 ? 'No questions' : `${d.count} question${d.count === 1 ? '' : 's'}`}`}
                  className={cn('h-4 w-4 rounded-[3px] transition-colors hover:ring-1 hover:ring-primary/60', heatClass(d.count))}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span>Less</span>
          {HEAT_LEVELS.map((c) => (
            <span key={c} className={cn('h-3 w-3 rounded-[3px]', c)} aria-hidden="true" />
          ))}
          <span>More</span>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {activeDays} active {activeDays === 1 ? 'day' : 'days'} · {totalQuestions.toLocaleString('en-IN')} questions in 12 weeks
        </span>
      </div>
    </div>
  )
}

// ---------- one subject: stacked status bar + chapter rows ----------
function SubjectPanel({
  subject,
  overrides,
  onSetStatus,
}: {
  subject: StudySubject
  overrides: Record<string, string>
  onSetStatus: (chapterId: string, status: string) => void
}) {
  const counts = countByStatus(subject.chapters, overrides)
  const total = subject.totalChapters || subject.chapters.length

  if (total === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No chapters mapped for this subject yet.</p>
  }

  return (
    <div>
      {/* chapter count by status — stacked semantic bar */}
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" role="img" aria-label="Chapters by status">
        {STATUS_DEFS.map((s) => {
          const n = counts[s.key] ?? 0
          if (n === 0) return null
          return (
            <div
              key={s.key}
              className={cn('h-full', s.bar)}
              style={{ width: `${(n / total) * 100}%` }}
              title={`${s.label}: ${n}`}
            />
          )
        })}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
        {STATUS_DEFS.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className={cn('h-2 w-2 rounded-full', s.bar)} aria-hidden="true" />
            {s.label}
            <span className="font-semibold text-foreground">{counts[s.key] ?? 0}</span>
          </span>
        ))}
      </div>

      {/* chapter rows with a 5-way status segmented control */}
      <div className="mt-4 space-y-1.5">
        {subject.chapters.map((ch) => {
          const status = overrides[ch.id] ?? ch.status
          const updated = overrides[ch.id] ? 'just now' : ch.updatedAt ? fmtDay(ch.updatedAt) : null
          return (
            <div
              key={ch.id}
              className="flex flex-col gap-2.5 rounded-xl border border-border/60 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium" title={ch.name}>{ch.name}</div>
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {ch.unit ? `${ch.unit} · ` : ''}{ch.questionCount.toLocaleString('en-IN')} Qs
                  {updated && ` · updated ${updated}`}
                </div>
              </div>
              <div className="grid shrink-0 grid-cols-5 gap-0.5 sm:w-[330px]">
                {STATUS_DEFS.map((s) => {
                  const isActive = status === s.key
                  return (
                    <button
                      key={s.key}
                      type="button"
                      title={s.label}
                      aria-pressed={isActive}
                      onClick={() => !isActive && onSetStatus(ch.id, s.key)}
                      className={cn(
                        'rounded-md px-1 py-1.5 text-center text-[10px] font-semibold leading-tight transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/70',
                        isActive ? s.active : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                      )}
                    >
                      {s.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------- main view ----------
export function StudyView() {
  const { data, error, loading, reload } = useApi<StudyData>('/api/study')
  // optimistic local overrides on top of the server payload (PATCH /api/study)
  const [statusOverrides, setStatusOverrides] = useState<Record<string, string>>({})
  const [targetOverride, setTargetOverride] = useState<number | null>(null)
  const [editingTarget, setEditingTarget] = useState(false)
  const [targetDraft, setTargetDraft] = useState('20')

  const setChapterStatus = (chapterId: string, status: string) => {
    setStatusOverrides((cur) => ({ ...cur, [chapterId]: status }))
    api('/api/study', { chapterId, status }, 'PATCH').catch((e: Error) => {
      // revert to the server value on failure
      setStatusOverrides((cur) => {
        const next = { ...cur }
        delete next[chapterId]
        return next
      })
      toast({ title: 'Could not update chapter status', description: e.message, variant: 'destructive' })
    })
  }

  const saveTarget = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const n = Math.round(Number(targetDraft))
    if (!Number.isFinite(n) || n < 5 || n > 200) {
      toast({ title: 'Pick a target between 5 and 200 questions', variant: 'destructive' })
      return
    }
    const prev = targetOverride
    setEditingTarget(false)
    if (n === (targetOverride ?? data?.today.target)) return
    setTargetOverride(n)
    api('/api/study', { targetQuestions: n }, 'PATCH')
      .then(() => toast({ title: `Daily target set to ${n} questions` }))
      .catch((e: Error) => {
        setTargetOverride(prev)
        toast({ title: 'Could not save target', description: e.message, variant: 'destructive' })
      })
  }

  if (error?.includes('Not authenticated')) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-dashed border-border p-10 text-center">
        <GraduationCap className="mx-auto h-10 w-10 text-muted-foreground" />
        <h2 className="mt-4 text-lg font-semibold">The study planner needs an account</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in free to track every chapter, set a daily target and build your activity calendar.
        </p>
        <Button className="mt-5" onClick={() => navigate('/profile')}>
          <LogIn className="h-4 w-4" /> Sign in / Create account
        </Button>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-52" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <Skeleton className="h-9 w-44 rounded-full" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
        <Skeleton className="h-[480px]" />
        <Skeleton className="h-56" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-dashed border-border p-10 text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-amber-400" />
        <h2 className="mt-4 text-lg font-semibold">Could not load your study plan</h2>
        <p className="mt-2 break-words text-sm text-muted-foreground">{error}</p>
        <Button className="mt-5" onClick={reload}>
          <RefreshCw className="h-4 w-4" /> Try again
        </Button>
      </div>
    )
  }

  if (!data) return null

  const currentTarget = targetOverride ?? data.today.target
  const targetMet = data.today.questions >= currentTarget
  const targetPct = Math.min(100, (data.today.questions / currentTarget) * 100)
  const week = data.week
  const weekChart = week.perDay.map((d, i) => ({
    label: parseDayKey(d.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' }),
    count: d.count,
    isToday: i === week.perDay.length - 1,
  }))
  const subjects = SUBJECT_ORDER.filter((sk) => data.subjects[sk])

  return (
    <div className="mx-auto max-w-4xl">
      {/* ---------- header + today chip ---------- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
            <GraduationCap className="h-6 w-6 text-primary" /> Study Planner
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Chapter-by-chapter syllabus tracking, daily targets and an honest activity record.
          </p>
        </div>

        {editingTarget ? (
          <form onSubmit={saveTarget} className="flex shrink-0 items-center gap-2">
            <Input
              type="number"
              inputMode="numeric"
              min={5}
              max={200}
              required
              value={targetDraft}
              onChange={(e) => setTargetDraft(e.target.value)}
              className="h-9 w-24"
              aria-label="Daily target in questions"
            />
            <Button type="submit" size="sm">
              <Check className="h-3.5 w-3.5" /> Save
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditingTarget(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <div
            className={cn(
              'flex items-center gap-2 self-start rounded-full border py-1.5 pl-3.5 pr-1.5 text-xs font-semibold',
              targetMet
                ? 'border-primary/40 bg-primary/10 text-primary shadow-[0_0_24px_-8px_var(--primary)]'
                : 'border-border bg-muted/40 text-foreground'
            )}
          >
            {targetMet ? <Trophy className="h-4 w-4 shrink-0" /> : <Target className="h-4 w-4 shrink-0 text-primary/70" />}
            <span>
              {data.today.questions} / {currentTarget} questions today
            </span>
            <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block" aria-hidden="true">
              <span
                className="block h-full rounded-full bg-primary transition-[width] duration-500"
                style={{ width: `${targetPct}%` }}
              />
            </span>
            <button
              type="button"
              onClick={() => {
                setTargetDraft(String(currentTarget))
                setEditingTarget(true)
              }}
              className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Edit daily target"
            >
              <Pencil className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {/* ---------- activity calendar + weekly progress ---------- */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <CalendarDays className="h-4 w-4 text-primary" /> Activity calendar
              <span className="ml-auto text-xs font-normal text-muted-foreground">last 12 weeks</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <HeatCalendar calendar={data.calendar} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <TrendingUp className="h-4 w-4 text-primary" /> This week
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                {week.total.toLocaleString('en-IN')} questions
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {[
                {
                  label: 'Questions',
                  value: week.total.toLocaleString('en-IN'),
                  sub: `${week.correct.toLocaleString('en-IN')} correct`,
                },
                {
                  label: 'Accuracy',
                  value: week.accuracy === null ? '—' : `${week.accuracy}%`,
                  sub: week.total > 0 ? 'graded attempts' : 'attempt to track',
                },
                {
                  label: 'Revised',
                  value: String(week.revised),
                  sub: week.revised > 0 ? `${week.revisionCorrect} correct` : 'none this week',
                },
              ].map((t) => (
                <div key={t.label} className="rounded-xl border border-border/60 p-3">
                  <div className="text-xl font-bold leading-none">{t.value}</div>
                  <div className="mt-1.5 text-xs text-muted-foreground">{t.label}</div>
                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground/80" title={t.sub}>{t.sub}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weekChart} margin={{ top: 8, right: 8, bottom: 0, left: -22 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                  <Tooltip
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                  />
                  <Bar dataKey="count" name="Questions" radius={[6, 6, 0, 0]}>
                    {weekChart.map((d, i) => (
                      <Cell
                        key={i}
                        fill={d.isToday ? 'var(--primary)' : 'color-mix(in oklab, var(--primary) 45%, transparent)'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-1 text-center text-[10px] text-muted-foreground">Questions per day · brighter bar is today</p>
          </CardContent>
        </Card>
      </div>

      {/* ---------- syllabus tracker ---------- */}
      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
            <BookOpen className="h-4 w-4 text-primary" /> Syllabus tracker
            <span className="ml-auto hidden text-xs font-normal text-muted-foreground sm:inline">
              tap a status to update — saves instantly
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {subjects.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No chapters mapped yet — syllabus data is on its way.</p>
          ) : (
            <Tabs defaultValue={subjects[0]}>
              <TabsList className="w-full">
                {subjects.map((sk) => {
                  const s = data.subjects[sk]!
                  const counts = countByStatus(s.chapters, statusOverrides)
                  const done = (counts.completed ?? 0) + (counts.strong ?? 0)
                  const Icon = SUBJECT_ICONS[sk] ?? Atom
                  return (
                    <TabsTrigger key={sk} value={sk} className="gap-1.5">
                      <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: SUBJECT_COLORS[sk] }} />
                      <span className="truncate">{s.name}</span>
                      <span className="hidden font-mono text-[10px] text-muted-foreground sm:inline">
                        {done}/{s.totalChapters}
                      </span>
                    </TabsTrigger>
                  )
                })}
              </TabsList>
              {subjects.map((sk) => (
                <TabsContent key={sk} value={sk} className="mt-2">
                  <SubjectPanel subject={data.subjects[sk]!} overrides={statusOverrides} onSetStatus={setChapterStatus} />
                </TabsContent>
              ))}
            </Tabs>
          )}
        </CardContent>
      </Card>

      {/* ---------- mock test history ---------- */}
      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ClipboardList className="h-4 w-4 text-primary" /> Mock test history
            <span className="ml-auto text-xs font-normal text-muted-foreground">{data.mocks.length} submitted</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.mocks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center">
              <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground/60" />
              <p className="mt-3 text-sm text-muted-foreground">
                No mock tests yet — full-length NTA-style papers with server-authoritative timers.
              </p>
              <Button className="mt-4" onClick={() => navigate('/mock')}>Take your first mock test</Button>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {data.mocks.map((m) => (
                <li key={m.id} className="flex items-center gap-3 rounded-xl border border-border/60 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 truncate text-sm font-medium" title={m.title}>{m.title}</span>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                        {mockKindLabel(m.kind)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground">
                      <span>{fmtMockDate(m.submittedAt)}</span>
                      <span>{formatDuration(m.timeSpentSeconds ?? 0)}</span>
                      {m.score !== null && m.maxMarks !== null && (
                        <span>
                          {Math.round(m.score)} / {Math.round(m.maxMarks)} marks
                        </span>
                      )}
                    </div>
                  </div>
                  <Badge variant="outline" className={cn('shrink-0 text-xs', pctTone(m.percentage))}>
                    {m.percentage === null ? '—' : `${m.percentage}%`}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
