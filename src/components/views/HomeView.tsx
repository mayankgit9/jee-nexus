'use client'

// JEE NEXUS — home view
import { motion } from 'framer-motion'
import { Dice5, ArrowRight, Library, Target, Flame, BookMarked, Activity, ChevronRight, Atom, FlaskConical, Sigma } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import type { SessionUser, SubjectKey } from '@/lib/types'
import { useApi, navigate, SUBJECT_COLORS, formatDuration } from '@/lib/client'
import { cn } from '@/lib/utils'

interface TaxonomySubject { key: SubjectKey; name: string; icon: string; questionCount: number; chapters: { questionCount: number }[] }

interface PyqOverview {
  years: { year: number; total: number }[]
}

interface StatsData {
  stats: {
    totalAttempts: number; correct: number; accuracy: number; totalTimeSeconds: number
    distinctQuestions: number; bookmarkCount: number
    subjects: { key: string; name: string; attempted: number; correct: number; accuracy: number }[]
    recent: { id: string; isCorrect: boolean | null; subject: string; chapter: string; publicId: string; createdAt: string }[]
    daily: { date: string; count: number }[]
  } | null
}

const SUBJECT_ICONS: Record<string, LucideIcon> = { Atom, FlaskConical, Sigma }

export function HomeView({ user, taxonomy }: { user: SessionUser | null; taxonomy: TaxonomySubject[] | null }) {
  const stats = useApi<StatsData>(user ? '/api/stats' : null)
  const pyq = useApi<PyqOverview>('/api/pyq')
  const st = stats.data?.stats ?? null

  const totalQuestions = taxonomy?.reduce((a, s) => a + s.questionCount, 0) ?? 0

  return (
    <div className="mx-auto max-w-5xl">
      {/* hero */}
      <div className="nexus-grid-bg rounded-3xl border border-border bg-card/40 px-6 py-12 text-center sm:px-12 sm:py-16">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs text-primary">
            <Flame className="h-3.5 w-3.5 shrink-0" />
            <span className="whitespace-nowrap">{totalQuestions.toLocaleString()} previous-year questions</span>
            <span className="hidden whitespace-nowrap sm:inline"> · growing daily</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">
            {user ? `Welcome back${user.name ? `, ${user.name.split(' ')[0]}` : ''}.` : 'Practice JEE Main.'}
            <br />
            <span className="text-gradient-nexus">{user ? 'Ready to raise that accuracy?' : 'The way you\'ll actually write it.'}</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-sm text-muted-foreground sm:text-base">
            {user
              ? 'Jump back into random practice, browse PYQs by year, or check your weak chapters.'
              : 'Free previous-year questions with deeply detailed solutions and a true CBT experience. No signup needed to practice.'}
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button size="lg" onClick={() => navigate('/practice')} className="min-w-[190px]">
              <Dice5 className="mr-2 h-4 w-4" /> Start practicing
            </Button>
            <Button size="lg" variant="outline" onClick={() => navigate('/pyq')}>
              <Library className="mr-2 h-4 w-4" /> Browse PYQs by year
            </Button>
          </div>
        </motion.div>
      </div>

      {/* stats row (logged in) */}
      {user && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Questions attempted', value: st ? String(st.totalAttempts) : '—', icon: Target },
            { label: 'Accuracy', value: st ? `${st.accuracy}%` : '—', icon: Activity },
            { label: 'Distinct questions', value: st ? String(st.distinctQuestions) : '—', icon: BookMarked },
            { label: 'Time invested', value: st ? formatDuration(st.totalTimeSeconds) : '—', icon: Flame },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="rounded-lg bg-primary/10 p-2"><s.icon className="h-4 w-4 text-primary" /></div>
                <div>
                  <div className="text-xl font-bold leading-tight">{s.value}</div>
                  <div className="text-[11px] text-muted-foreground">{s.label}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {user && stats.loading && <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-16" />)}</div>}

      {/* subject cards */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold tracking-tight">Choose your subject</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          {(taxonomy ?? []).map((s, i) => {
            const Icon = SUBJECT_ICONS[s.icon] ?? Atom
            return (
              <motion.button
                key={s.key}
                type="button"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.07 }}
                onClick={() => navigate(`/practice?subject=${s.key}`)}
                className="group rounded-2xl border border-border bg-card p-5 text-left transition-all hover:-translate-y-1 hover:border-primary/40"
              >
                <div
                  className="mb-3 inline-flex rounded-xl p-2.5"
                  style={{ background: `color-mix(in oklab, ${SUBJECT_COLORS[s.key]} 14%, transparent)` }}
                >
                  <Icon className="h-5 w-5" style={{ color: SUBJECT_COLORS[s.key] }} />
                </div>
                <div className="font-semibold" style={{ color: SUBJECT_COLORS[s.key] }}>{s.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {s.questionCount.toLocaleString()} questions · {s.chapters.length} chapters
                </div>
                <div className="mt-3 flex items-center gap-1 text-xs text-primary">
                  Practice now <ChevronRight className="h-3.5 w-3.5" />
                </div>
              </motion.button>
            )
          })}
          {!taxonomy && [0, 1, 2].map(i => <Skeleton key={i} className="h-36" />)}
        </div>
      </div>

      {/* recent activity + year shortcuts */}
      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold"><Activity className="h-4 w-4 text-primary" /> Recent activity</h3>
              {user && <Button variant="ghost" size="sm" onClick={() => navigate('/performance')}>View all</Button>}
            </div>
            {!user && (
              <p className="mt-4 text-sm text-muted-foreground">
                <button className="text-primary underline-offset-2 hover:underline" onClick={() => navigate('/login')}>Sign in</button>{' '}
                to track your attempts, accuracy and progress over time.
              </p>
            )}
            {user && stats.loading && <div className="mt-4 space-y-2"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>}
            {user && st && st.recent.length === 0 && (
              <p className="mt-4 text-sm text-muted-foreground">No attempts yet — your history will appear here after your first question.</p>
            )}
            {user && st && st.recent.slice(0, 6).map((a) => (
              <div key={a.id} className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate">{a.chapter}</div>
                  <div className="text-[11px] text-muted-foreground">{a.subject} · {new Date(a.createdAt).toLocaleDateString()}</div>
                </div>
                <Badge variant="outline" className={cn(
                  'shrink-0 text-[11px]',
                  a.isCorrect === true && 'border-emerald-400/30 bg-emerald-400/10 text-emerald-400',
                  a.isCorrect === false && 'border-rose-400/30 bg-rose-400/10 text-rose-400',
                  a.isCorrect === null && 'text-muted-foreground'
                )}>
                  {a.isCorrect === true ? 'correct' : a.isCorrect === false ? 'wrong' : 'skipped'}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><Library className="h-4 w-4 text-primary" /> Year-wise PYQs</h3>
            <div className="mt-4 grid grid-cols-4 gap-2">
              {(pyq.data?.years ?? []).map((y) => (
                <button
                  key={y.year}
                  type="button"
                  onClick={() => navigate(`/pyq/${y.year}`)}
                  className="group rounded-lg border border-border px-2 py-2 text-sm font-medium transition-colors hover:border-primary/50 hover:bg-primary/[0.06]"
                >
                  {y.year}
                  <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">{y.total}</span>
                </button>
              ))}
              {pyq.loading && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-11" />)}
            </div>
            {pyq.data && pyq.data.years.length === 0 && (
              <p className="mt-4 text-sm text-muted-foreground">The question library is being imported — check back soon.</p>
            )}
            <p className="mt-4 text-xs text-muted-foreground">
              Every year listed has real imported questions — no fabricated counts, no placeholder years.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
