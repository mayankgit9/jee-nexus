'use client'

// JEE NEXUS — performance dashboard
import { useEffect, useState } from 'react'
import { BarChart3, Target, TrendingUp, AlertTriangle, Flame, ClipboardList } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useApi, api, navigate, formatDuration, SUBJECT_COLORS } from '@/lib/client'
import { cn } from '@/lib/utils'

interface StatsData {
  stats: {
    totalAttempts: number; correct: number; accuracy: number; totalTimeSeconds: number
    answeredCount: number; distinctQuestions: number; bookmarkCount: number
    examAttempts?: number
    mocks?: {
      id: string; title: string; kind: string; year: number | null
      startedAt: string; status: string
      totalQuestions: number; answered: number; correct: number; accuracy: number
      score: number | null; maxMarks: number | null; timeSpentSeconds: number
    }[]
    subjects: { key: string; name: string; attempted: number; correct: number; accuracy: number }[]
    chapters: { key: string; name: string; subject: string; attempted: number; correct: number; accuracy: number }[]
    daily: { date: string; count: number }[]
    streak?: { current: number; best: number; activeToday: boolean }
    recent: { id: string; isCorrect: boolean | null; subject: string; chapter: string; publicId: string; createdAt: string; source?: 'practice' | 'exam' }[]
  }
}

export function PerformanceView({ onRequireAuth }: { onRequireAuth: () => void }) {
  const { data, loading, error } = useApi<StatsData>('/api/stats')
  const st = data?.stats

  if (error?.includes('Not authenticated')) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-dashed border-border p-10 text-center">
        <BarChart3 className="mx-auto h-10 w-10 text-muted-foreground" />
        <h2 className="mt-4 text-lg font-semibold">Performance tracking needs an account</h2>
        <p className="mt-2 text-sm text-muted-foreground">Sign in free to unlock accuracy analytics, chapter strengths and progress history.</p>
        <Button className="mt-5" onClick={onRequireAuth}>Sign in / Create account</Button>
      </div>
    )
  }

  if (loading || !st) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Skeleton className="h-24" />
        <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-64" /><Skeleton className="h-64" /></div>
      </div>
    )
  }

  if (st.totalAttempts === 0) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-dashed border-border p-10 text-center">
        <Target className="mx-auto h-10 w-10 text-primary" />
        <h2 className="mt-4 text-lg font-semibold">No data yet</h2>
        <p className="mt-2 text-sm text-muted-foreground">Answer practice questions or take a mock test — every graded attempt lands here.</p>
        <Button className="mt-5" onClick={() => navigate('/practice')}>Start practicing</Button>
      </div>
    )
  }

  const dailyChart = st.daily.map((d) => ({ ...d, label: d.date.slice(5) }))
  const subjectChart = st.subjects.map((s) => ({ name: s.name, accuracy: s.accuracy, attempted: s.attempted, key: s.key }))
  const weakChapters = st.chapters.filter((c) => c.attempted >= 2 && c.accuracy < 70).slice(0, 8)
  const strongChapters = [...st.chapters].filter((c) => c.attempted >= 2 && c.accuracy >= 70).slice(-6).reverse()

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
        <BarChart3 className="h-6 w-6 text-primary" /> Performance
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">Honest analytics — no fake percentile predictions, ever.</p>

      {/* headline stats */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Total attempts', value: st.totalAttempts },
          { label: 'Accuracy', value: `${st.accuracy}%` },
          { label: 'Mock tests taken', value: st.examAttempts ?? 0 },
          { label: 'Time invested', value: formatDuration(st.totalTimeSeconds) },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* daily activity */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex flex-wrap items-center gap-2 text-sm"><TrendingUp className="h-4 w-4 text-primary" /> Daily activity (14 days)
            {st.streak && st.streak.current > 0 && (
              <span className={cn('ml-auto flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                st.streak.activeToday ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground')}>
                <Flame className={cn('h-3 w-3', st.streak.activeToday && 'animate-pulse')} />
                {st.streak.current}-day streak · best {st.streak.best}
              </span>
            )}
          </CardTitle></CardHeader>
          <CardContent>
            {dailyChart.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No activity in the last 14 days.</p>
            ) : (
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailyChart} margin={{ top: 8, right: 8, bottom: 0, left: -22 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                    <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                    <Line type="monotone" dataKey="count" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 3, fill: 'var(--primary)' }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* subject accuracy */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Target className="h-4 w-4 text-primary" /> Subject-wise accuracy</CardTitle></CardHeader>
          <CardContent>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={subjectChart} margin={{ top: 8, right: 8, bottom: 0, left: -22 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                  <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="accuracy" radius={[6, 6, 0, 0]}>
                    {subjectChart.map((s) => (
                      <Cell key={s.key} fill={SUBJECT_COLORS[s.key] ?? 'var(--primary)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
              {st.subjects.map((s) => (
                <div key={s.key} className="rounded-lg border border-border/60 py-1.5">
                  <span style={{ color: SUBJECT_COLORS[s.key] }}>{s.name}</span>
                  <span className="ml-1.5 font-semibold">{s.accuracy}%</span>
                  <div className="text-[10px] text-muted-foreground">{s.attempted} attempts</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* weak / strong chapters */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><AlertTriangle className="h-4 w-4 text-amber-400" /> Chapters needing attention
              {weakChapters.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto shrink-0"
                  onClick={() =>
                    navigate(`/practice?chapters=${encodeURIComponent(weakChapters.map((c) => c.key).join(','))}`)
                  }
                >
                  <Target className="mr-1.5 h-3.5 w-3.5" /> Practice these {weakChapters.length}
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {weakChapters.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nothing flagged yet — attempt more questions per chapter to surface weak spots.</p>
            ) : (
              <div className="space-y-1.5">
                {weakChapters.map((c) => (
                  <div key={c.key} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate">{c.name}</div>
                      <div className="text-[11px] text-muted-foreground">{c.subject} · {c.attempted} attempts</div>
                    </div>
                    <span className={cn('shrink-0 font-bold', c.accuracy < 40 ? 'text-rose-400' : 'text-amber-400')}>{c.accuracy}%</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><TrendingUp className="h-4 w-4 text-emerald-400" /> Strong chapters</CardTitle>
          </CardHeader>
          <CardContent>
            {strongChapters.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Attempt more questions to build your strength profile.</p>
            ) : (
              <div className="space-y-1.5">
                {strongChapters.map((c) => (
                  <div key={c.key} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate">{c.name}</div>
                      <div className="text-[11px] text-muted-foreground">{c.subject} · {c.attempted} attempts</div>
                    </div>
                    <span className="shrink-0 font-bold text-emerald-400">{c.accuracy}%</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* per-mock breakdown — one row per finished CBT attempt */}
      {(st.mocks?.length ?? 0) > 0 && (
        <Card className="mt-4">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ClipboardList className="h-4 w-4 text-primary" /> Recent mocks
              <span className="ml-auto text-xs font-normal text-muted-foreground">{st.mocks!.length} finished</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2.5">
              {st.mocks!.slice(0, 8).map((m) => {
                const acc = m.accuracy
                const barColor = acc >= 70 ? 'var(--primary)' : acc >= 50 ? '#f59e0b' : '#ef4444'
                const kindLabel = m.kind === 'custom'
                  ? 'Custom'
                  : m.kind === 'pyq_year'
                    ? `PYQ${m.year ? ` ${m.year}` : ''}`
                    : m.kind === 'full_length'
                      ? 'Full length'
                      : m.kind === 'subject'
                        ? 'Subject test'
                        : 'Chapter test'
                return (
                  <li key={m.id} className="rounded-xl border border-border/60 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.title}</span>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{kindLabel}</span>
                      {m.status === 'expired' && (
                        <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">Timed out</span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      {/* accuracy bar */}
                      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full" style={{ width: `${acc}%`, background: barColor }} />
                      </div>
                      <span className="shrink-0 text-xs font-semibold" style={{ color: barColor }}>{acc}%</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span>{m.correct}/{m.answered} correct</span>
                      {m.totalQuestions > 0 && <span>{m.answered}/{m.totalQuestions} attempted</span>}
                      {(m.score !== null && m.maxMarks !== null) && <span>Score {Math.round(m.score)}/{Math.round(m.maxMarks)}</span>}
                      {m.timeSpentSeconds > 0 && <span>{formatDuration(m.timeSpentSeconds)}</span>}
                      <span>{new Date(m.startedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                    </div>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* attempt history — full paginated log with filters (was: newest 10 only) */}
      <HistoryCard />
    </div>
  )
}

// ---------- attempt history ----------
interface HistoryItem {
  id: string
  isCorrect: boolean | null
  createdAt: string
  subject: string
  chapter: string
  publicId: string
  source: 'practice' | 'exam'
}

const HISTORY_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'practice', label: 'Practice' },
  { key: 'exam', label: 'Mocks' },
  { key: 'correct', label: 'Correct' },
  { key: 'incorrect', label: 'Incorrect' },
  { key: 'skipped', label: 'Ungraded' },
] as const

function HistoryCard() {
  const [filter, setFilter] = useState<string>('all')
  const [items, setItems] = useState<HistoryItem[] | null>(null)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    api<{ items: HistoryItem[]; total: number; hasMore: boolean }>(`/api/stats/history?filter=${filter}&pageSize=20`)
      .then((d) => {
        if (!alive) return
        setItems(d.items)
        setTotal(d.total)
        setHasMore(d.hasMore)
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [filter])

  const loadMore = async () => {
    if (loadingMore || !items) return
    setLoadingMore(true)
    try {
      const next = Math.floor(items.length / 20) + 1
      const d = await api<{ items: HistoryItem[]; hasMore: boolean }>(`/api/stats/history?filter=${filter}&page=${next}&pageSize=20`)
      setItems((cur) => {
        const seen = new Set((cur ?? []).map((x) => x.id))
        return [...(cur ?? []), ...d.items.filter((x) => !seen.has(x.id))]
      })
      setHasMore(d.hasMore)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm">Attempt history{total > 0 && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{total.toLocaleString()} record{total === 1 ? '' : 's'}</span>}</CardTitle>
        <div className="flex flex-wrap items-center justify-end gap-1">
          {HISTORY_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                filter === f.key ? 'bg-primary/15 font-semibold text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-1.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : error ? (
          <p className="py-6 text-center text-sm text-rose-400">{error}</p>
        ) : items && items.length > 0 ? (
          <>
            <div className="space-y-1.5">
              {items.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <span className="font-mono text-xs text-muted-foreground">{a.publicId}</span>
                    <span className="mx-2">·</span>
                    <span className="truncate">{a.chapter}</span>
                    <span
                      className={cn(
                        'ml-2 rounded px-1 py-0.5 text-[10px] font-medium',
                        a.source === 'exam' ? 'bg-violet-500/15 text-violet-300' : 'bg-sky-500/15 text-sky-300'
                      )}
                    >
                      {a.source === 'exam' ? 'Mock' : 'Practice'}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    {new Date(a.createdAt).toLocaleDateString()}
                    <span className={cn('font-semibold',
                      a.isCorrect === true ? 'text-emerald-400' : a.isCorrect === false ? 'text-rose-400' : 'text-muted-foreground')}>
                      {a.isCorrect === true ? '✓' : a.isCorrect === false ? '✗' : '—'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {hasMore && (
              <Button variant="outline" size="sm" className="mt-3 w-full" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load older attempts'}
              </Button>
            )}
          </>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing here yet — this filter has no attempts.</p>
        )}
      </CardContent>
    </Card>
  )
}
