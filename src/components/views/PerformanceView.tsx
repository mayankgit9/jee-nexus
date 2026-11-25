'use client'

// JEE NEXUS — performance dashboard
import { BarChart3, Target, TrendingUp, AlertTriangle, Flame } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useApi, navigate, formatDuration, SUBJECT_COLORS } from '@/lib/client'
import { cn } from '@/lib/utils'

interface StatsData {
  stats: {
    totalAttempts: number; correct: number; accuracy: number; totalTimeSeconds: number
    answeredCount: number; distinctQuestions: number; bookmarkCount: number
    examAttempts?: number
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

      {/* recent history */}
      <Card className="mt-4">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Recent attempts</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            {st.recent.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <span className="font-mono text-xs text-muted-foreground">{a.publicId}</span>
                  <span className="mx-2">·</span>
                  <span className="truncate">{a.chapter}</span>
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
        </CardContent>
      </Card>
    </div>
  )
}
