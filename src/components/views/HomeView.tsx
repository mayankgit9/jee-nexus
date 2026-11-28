'use client'

// JEE NEXUS — home view (dashboard: hero, stats, daily challenge, subjects,
// continue-practicing launcher, PYQ spotlight)
import { useEffect, useState, useSyncExternalStore } from 'react'
import { animate, motion, useReducedMotion } from 'framer-motion'
import type { Variants } from 'framer-motion'
import {
  Atom, ArrowRight, BarChart3, BookOpen, CheckCircle2, ChevronRight, ClipboardList,
  Dice5, FlaskConical, Flame, Library, LogIn, MessageSquare, Sigma, Sparkles, Target,
  Trophy, XCircle, Activity, CalendarRange,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import type { SessionUser, SubjectKey, PublicQuestion, QuestionSolution } from '@/lib/types'
import { useApi, navigate, SUBJECT_COLORS } from '@/lib/client'
import { cn } from '@/lib/utils'

interface TaxonomySubject { key: SubjectKey; name: string; icon: string; questionCount: number; chapters: { questionCount: number }[] }

interface PyqOverview {
  years: { year: number; total: number; subjects?: Record<string, number> }[]
}

interface DailyOverview {
  date: string
  question: PublicQuestion | null
  attemptedCount: number
  answered: { isCorrect: boolean | null } | null
  solution?: QuestionSolution | null
}

/** "26 Nov 2026" — pinned to IST noon so the label matches the challenge day */
const formatDailyDate = (iso: string) =>
  new Date(`${iso}T12:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

interface StatsData {
  stats: {
    totalAttempts: number; correct: number; accuracy: number; totalTimeSeconds: number
    distinctQuestions: number; bookmarkCount: number
    streak?: { current: number; best: number; activeToday: boolean }
    subjects: { key: string; name: string; attempted: number; correct: number; accuracy: number }[]
    // chapters arrive weakest-first from /api/stats; mocks are finished CBTs
    chapters?: { key: string; name: string; subject: string; attempted: number; correct: number; accuracy: number }[]
    mocks?: { id: string; score: number; maxMarks: number; accuracy: number }[]
    recent: { id: string; isCorrect: boolean | null; subject: string; chapter: string; publicId: string; createdAt: string }[]
    daily: { date: string; count: number }[]
  } | null
}

const SUBJECT_ICONS: Record<string, LucideIcon> = { Atom, FlaskConical, Sigma }

// ---------- motion vocabulary ----------
const EASE: [number, number, number, number] = [0.2, 0.8, 0.2, 1]
const stack: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } }
// a section that animates itself AND staggers its card children
const groupItem: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE, staggerChildren: 0.05 } },
}
const item: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } },
}

/** Count-up number (font-mono usage handled by the parent); reduced-motion safe */
function CountUp({ value, suffix = '' }: { value: number; suffix?: string }) {
  const reduce = useReducedMotion()
  const [display, setDisplay] = useState(0)
  useEffect(() => {
    if (reduce) return
    const controls = animate(0, value, {
      duration: 1,
      ease: EASE,
      onUpdate: (v) => setDisplay(v),
    })
    return () => controls.stop()
  }, [value, reduce])
  return (
    <>
      {(reduce ? value : Math.round(display)).toLocaleString('en-IN')}
      {suffix}
    </>
  )
}

/** brief accuracy ring thresholds, as chip tones */
const accuracyTone = (acc: number) =>
  acc >= 70
    ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-400'
    : acc >= 50
      ? 'border-amber-400/30 bg-amber-400/10 text-amber-400'
      : 'border-rose-400/30 bg-rose-400/10 text-rose-400'

// greeting by IST time of day — via useSyncExternalStore so the server
// snapshot ('Welcome') hydrates cleanly and the client picks the real one
const NOOP_SUBSCRIBE = () => () => {}
const SERVER_GREETING = () => 'Welcome'
function istGreeting(): string {
  try {
    const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()))
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  } catch {
    // Intl timezone data unavailable — neutral greeting
    return 'Welcome'
  }
}

export function HomeView({ user, taxonomy }: { user: SessionUser | null; taxonomy: TaxonomySubject[] | null }) {
  const stats = useApi<StatsData>(user ? '/api/stats' : null)
  const pyq = useApi<PyqOverview>('/api/pyq')
  const daily = useApi<DailyOverview>('/api/daily')
  const reduceMotion = useReducedMotion()
  const st = stats.data?.stats ?? null
  const dq = daily.data?.question ?? null
  const dailyDone = daily.data?.answered ?? null

  const totalQuestions = taxonomy?.reduce((a, s) => a + s.questionCount, 0) ?? 0
  const yearsCount = pyq.data?.years.length ?? 0
  const chapterCount = taxonomy?.reduce((a, s) => a + s.chapters.length, 0) ?? 0
  const latestYear = pyq.data?.years[0] ?? null

  // best mock score (%), derived from /api/stats mocks payload — no new API
  const mockBest = (() => {
    let best: number | null = null
    for (const m of st?.mocks ?? []) {
      const pct = m.maxMarks > 0 ? Math.round((m.score / m.maxMarks) * 100) : m.accuracy
      if (best === null || pct > best) best = pct
    }
    return best
  })()
  const mockCount = st?.mocks?.length ?? 0

  // weak-chapter launcher — /api/stats returns chapters weakest-first
  const focusChapters = (st?.chapters ?? []).filter((c) => c.attempted > 0).slice(0, 3)
  const hasWeak = focusChapters.some((c) => c.accuracy < 70)

  // greeting by IST time of day (hydration-safe: server snapshot is neutral)
  const greeting = useSyncExternalStore(NOOP_SUBSCRIBE, istGreeting, SERVER_GREETING)
  const firstName = user ? (user.name ?? user.username).split(' ')[0] : null

  const heroSub = user
    ? `${totalQuestions.toLocaleString('en-IN')} previous-year questions · ${chapterCount} chapters · ${yearsCount} years of JEE Main. Pick up exactly where you left off.`
    : `${totalQuestions.toLocaleString('en-IN')} previous-year questions with deeply detailed solutions, a true NTA-style CBT experience and a community of aspirants. No signup needed to practice.`

  return (
    <motion.div variants={stack} initial={reduceMotion ? false : 'hidden'} animate="show" className="mx-auto max-w-6xl">
      {/* ---------- hero band ---------- */}
      <motion.section variants={item} className="nexus-grid-bg surface relative overflow-hidden rounded-3xl px-6 py-10 sm:px-10 sm:py-14">
        <div className="nexus-orb nexus-orb-1" aria-hidden="true" />
        <div className="nexus-orb nexus-orb-2" aria-hidden="true" />
        <div className="nexus-orb nexus-orb-3" aria-hidden="true" />
        <div className="relative">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">
            {greeting}{firstName ? `, ${firstName}` : ', aspirant'}
          </p>
          <h1 className="mt-3 max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-5xl sm:leading-[1.1]">
            Practice like it&apos;s <span className="text-gradient-nexus">the real exam</span>
          </h1>
          <p className="mt-4 max-w-2xl break-words text-sm leading-relaxed text-muted-foreground sm:text-base">{heroSub}</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              onClick={() => navigate('/practice')}
              className="glow-primary min-w-[190px] gap-2 active:scale-[0.98]"
            >
              <Dice5 className="h-4 w-4" /> Start Practice
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => navigate('/practice?daily=1')}
              className="gap-2 border-primary/40 bg-primary/[0.06] text-primary hover:bg-primary/15 hover:text-primary active:scale-[0.98]"
            >
              <Flame className="h-4 w-4" /> Daily Challenge
            </Button>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><Library className="h-3.5 w-3.5 text-primary" /> {yearsCount} years · {chapterCount} chapters</span>
            <span className="flex items-center gap-1.5"><MessageSquare className="h-3.5 w-3.5 text-primary" /> Community &amp; study groups</span>
            <span className="flex items-center gap-1.5"><ClipboardList className="h-3.5 w-3.5 text-primary" /> True NTA-style CBT</span>
          </div>
        </div>
      </motion.section>

      {/* ---------- stat strip ---------- */}
      <motion.section variants={item} aria-label="Stat strip" className="mt-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {user && stats.loading && !st ? (
            [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[96px] rounded-xl" />)
          ) : user ? (
            <>
              {[
                {
                  icon: Target,
                  label: 'Questions practiced',
                  value: st ? <CountUp value={st.totalAttempts} /> : '—',
                  sub: st ? `${st.distinctQuestions.toLocaleString('en-IN')} unique questions` : 'Sign in to track',
                },
                {
                  icon: Activity,
                  label: 'Accuracy',
                  value: st ? <CountUp value={st.accuracy} suffix="%" /> : '—',
                  sub: st ? `${st.correct.toLocaleString('en-IN')} correct answers` : 'Sign in to track',
                },
                {
                  icon: Flame,
                  label: 'Day streak',
                  value: st ? <CountUp value={st.streak?.current ?? 0} /> : '—',
                  sub: st?.streak?.activeToday ? 'Active today — keep it burning' : st?.streak ? 'Play today to extend it' : 'Sign in to track',
                  hot: st?.streak?.activeToday ?? false,
                },
                {
                  icon: ClipboardList,
                  label: 'Mock score best',
                  value: mockBest !== null ? <CountUp value={mockBest} suffix="%" /> : '—',
                  sub: mockCount > 0 ? `${mockCount} mock${mockCount === 1 ? '' : 's'} attempted` : 'No mock attempts yet',
                },
              ].map((tile) => (
                <div key={tile.label} className="surface surface-hover rounded-xl p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{tile.label}</span>
                    <tile.icon className={cn('h-4 w-4 shrink-0', tile.hot ? 'text-amber-400' : 'text-primary/70')} aria-hidden="true" />
                  </div>
                  <div className="mt-2 truncate bg-gradient-to-r from-primary to-chart-2 bg-clip-text font-mono text-2xl font-bold leading-none text-transparent">
                    {tile.value}
                  </div>
                  <div className="mt-1.5 truncate text-[11px] text-muted-foreground" title={tile.sub}>{tile.sub}</div>
                </div>
              ))}
            </>
          ) : (
            <>
              {[
                { icon: Library, label: 'PYQ bank', value: <CountUp value={totalQuestions} />, sub: 'previous-year questions' },
                { icon: CalendarRange, label: 'Years covered', value: <CountUp value={yearsCount} />, sub: 'JEE Main sessions' },
                { icon: BookOpen, label: 'Chapters', value: <CountUp value={chapterCount} />, sub: 'full syllabus mapped' },
              ].map((tile) => (
                <div key={tile.label} className="surface surface-hover rounded-xl p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{tile.label}</span>
                    <tile.icon className="h-4 w-4 shrink-0 text-primary/70" aria-hidden="true" />
                  </div>
                  <div className="mt-2 truncate bg-gradient-to-r from-primary to-chart-2 bg-clip-text font-mono text-2xl font-bold leading-none text-transparent">
                    {tile.value}
                  </div>
                  <div className="mt-1.5 truncate text-[11px] text-muted-foreground">{tile.sub}</div>
                </div>
              ))}
              <motion.button
                type="button"
                onClick={() => navigate('/login')}
                whileTap={{ scale: 0.97 }}
                className="surface surface-hover group rounded-xl p-4 text-left"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Your stats</span>
                  <LogIn className="h-4 w-4 shrink-0 text-primary/70" aria-hidden="true" />
                </div>
                <div className="mt-2 text-lg font-bold leading-tight text-primary">Sign in free</div>
                <div className="mt-1.5 truncate text-[11px] text-muted-foreground">Track accuracy, streaks &amp; mock scores</div>
              </motion.button>
            </>
          )}
        </div>
      </motion.section>

      {/* ---------- daily challenge ---------- */}
      <div className="mt-6">
        {daily.loading && !dq && <Skeleton className="h-[104px] w-full rounded-2xl" />}
        {dq && (
          <motion.div variants={item}>
            <button
              type="button"
              onClick={() => navigate('/practice?daily=1')}
              aria-label="Open today's daily challenge"
              className="surface surface-hover group relative flex w-full flex-col gap-4 overflow-hidden rounded-2xl p-5 text-left active:scale-[0.99] sm:flex-row sm:items-center sm:gap-5"
            >
              <div
                className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-60 blur-3xl transition-opacity duration-300 group-hover:opacity-100"
                style={{ background: 'radial-gradient(circle, oklch(0.8 0.15 85 / 14%), transparent 70%)' }}
                aria-hidden="true"
              />
              <div className="relative shrink-0">
                <div
                  className={cn(
                    'flex h-12 w-12 items-center justify-center rounded-xl ring-1',
                    dailyDone?.isCorrect === true && 'bg-emerald-400/10 ring-emerald-400/30',
                    dailyDone?.isCorrect === false && 'bg-rose-400/10 ring-rose-400/30',
                    !dailyDone && 'bg-gradient-to-br from-amber-400/25 to-amber-400/5 ring-amber-400/40'
                  )}
                >
                  {dailyDone?.isCorrect === true ? (
                    <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                  ) : dailyDone?.isCorrect === false ? (
                    <XCircle className="h-6 w-6 text-rose-400" />
                  ) : (
                    <Flame className="h-6 w-6 text-amber-400" />
                  )}
                </div>
                {!dailyDone && (
                  <span className="absolute -right-1 -top-1 flex h-3 w-3">
                    <span className="nexus-pulse absolute inline-flex h-full w-full rounded-full bg-amber-400" />
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-400" />
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    {dailyDone
                      ? dailyDone.isCorrect === true
                        ? 'Daily challenge conquered'
                        : dailyDone.isCorrect === false
                          ? 'Daily challenge — reviewed'
                          : 'Daily challenge — revealed'
                      : 'Daily Challenge'}
                    <Badge variant="outline" className="border-amber-400/40 bg-amber-400/10 px-1.5 py-0 text-[10px] font-semibold text-amber-400">QOTD</Badge>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {formatDailyDate(daily.data!.date)} · {dq.subject.name} · {dq.chapter.name}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {daily.data!.attemptedCount > 0
                    ? `${daily.data!.attemptedCount.toLocaleString('en-IN')} ${daily.data!.attemptedCount === 1 ? 'aspirant has' : 'aspirants have'} played today — one question, same for everyone`
                    : 'One question a day, same for every aspirant — keep the streak alive'}
                </p>
              </div>
              <span
                className={cn(
                  'relative inline-flex h-9 shrink-0 items-center gap-1.5 self-start rounded-lg px-4 text-sm font-semibold transition-all duration-200 sm:self-auto',
                  dailyDone
                    ? 'border border-border text-muted-foreground group-hover:text-foreground'
                    : 'bg-primary text-primary-foreground group-hover:shadow-[0_0_24px_-6px_var(--primary)]'
                )}
              >
                {dailyDone ? 'Review attempt' : "Attempt today's QOTD"}
                <ChevronRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </span>
            </button>
          </motion.div>
        )}
      </div>

      {/* ---------- subject cards ---------- */}
      <motion.section variants={groupItem} aria-labelledby="choose-subject" className="mt-8">
        <motion.div variants={item} className="flex items-end justify-between gap-3">
          <h2 id="choose-subject" className="text-lg font-semibold tracking-tight">Choose your subject</h2>
          <button
            type="button"
            onClick={() => navigate('/practice')}
            className="flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
          >
            Mixed practice <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </motion.div>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          {(taxonomy ?? []).map((s) => {
            const Icon = SUBJECT_ICONS[s.icon] ?? Atom
            const share = totalQuestions > 0 ? Math.round((s.questionCount / totalQuestions) * 100) : 0
            return (
              <motion.div key={s.key} variants={item}>
                <button
                  type="button"
                  onClick={() => navigate(`/practice?subject=${s.key}`)}
                  className="group surface surface-hover relative h-full w-full overflow-hidden rounded-2xl p-5 text-left active:scale-[0.98]"
                >
                  <div
                    className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
                    style={{ background: `color-mix(in oklab, ${SUBJECT_COLORS[s.key]} 22%, transparent)` }}
                    aria-hidden="true"
                  />
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className="inline-flex rounded-xl p-2.5"
                      style={{ background: `color-mix(in oklab, ${SUBJECT_COLORS[s.key]} 14%, transparent)` }}
                    >
                      <Icon className="h-5 w-5" style={{ color: SUBJECT_COLORS[s.key] }} />
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">{s.questionCount.toLocaleString('en-IN')} Qs</span>
                  </div>
                  <div className="mt-3 font-semibold" style={{ color: SUBJECT_COLORS[s.key] }}>{s.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {s.chapters.length} chapters · {share}% of bank
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="presentation">
                    <motion.div
                      initial={reduceMotion ? false : { width: 0 }}
                      animate={{ width: `${share}%` }}
                      transition={{ duration: 0.8, delay: 0.3, ease: EASE }}
                      className="h-full rounded-full"
                      style={{ background: `linear-gradient(90deg, color-mix(in oklab, ${SUBJECT_COLORS[s.key]} 55%, transparent), ${SUBJECT_COLORS[s.key]})` }}
                    />
                  </div>
                  <div className="mt-3 flex items-center gap-1 text-xs font-medium" style={{ color: SUBJECT_COLORS[s.key] }}>
                    Practice now <ChevronRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
                  </div>
                </button>
              </motion.div>
            )
          })}
          {!taxonomy && [0, 1, 2].map((i) => <Skeleton key={i} className="h-44" />)}
        </div>
      </motion.section>

      {/* ---------- continue practicing + recent activity ---------- */}
      <motion.section variants={item} aria-label="Continue practicing" className="mt-8 grid gap-4 lg:grid-cols-2">
        {/* weak-chapter launcher */}
        <div className="surface rounded-2xl p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Target className="h-4 w-4 text-primary" /> Continue practicing
            </h3>
            {user && <Button variant="ghost" size="sm" onClick={() => navigate('/performance')}>All analytics</Button>}
          </div>
          {!user && (
            <div className="mt-4">
              <p className="text-sm text-muted-foreground">
                <button className="text-primary underline-offset-2 hover:underline" onClick={() => navigate('/login')}>Sign in</button>{' '}
                to unlock weak-chapter drills, accuracy trends and your personal practice map.
              </p>
              <Button className="mt-4 w-full gap-2 active:scale-[0.98]" onClick={() => navigate('/practice')}>
                <Dice5 className="h-4 w-4" /> Start mixed practice
              </Button>
            </div>
          )}
          {user && stats.loading && !st && (
            <div className="mt-4 space-y-2"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
          )}
          {user && st && focusChapters.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs text-muted-foreground">
                {hasWeak ? 'Your weakest chapters right now — drill them to move the needle.' : 'Your most-practiced chapters — keep the momentum going.'}
              </p>
              {focusChapters.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => navigate(`/practice?chapters=${encodeURIComponent(c.key)}`)}
                  className="group flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-border/70 bg-background/40 px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.06]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium" title={c.name}>{c.name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{c.subject} · {c.attempted} attempted</div>
                  </div>
                  <Badge variant="outline" className={cn('shrink-0 text-[11px]', accuracyTone(c.accuracy))}>{c.accuracy}%</Badge>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5" />
                </button>
              ))}
              <Button className="mt-1 w-full gap-2 active:scale-[0.98]" onClick={() => navigate(`/practice?chapters=${encodeURIComponent(focusChapters.map((c) => c.key).join(','))}`)}>
                <Dice5 className="h-4 w-4" /> Drill these {focusChapters.length} chapters
              </Button>
            </div>
          )}
          {user && st && focusChapters.length === 0 && (
            <div className="mt-4 rounded-xl border border-dashed border-border p-4 text-center">
              <p className="text-sm text-muted-foreground">
                {st.totalAttempts > 0
                  ? 'No weak chapters detected — solid coverage. Keep the streak alive.'
                  : 'No attempts yet — your first session builds your weak-spot map.'}
              </p>
              <Button className="mt-3 w-full gap-2 active:scale-[0.98]" onClick={() => navigate('/practice')}>
                <Dice5 className="h-4 w-4" /> Start mixed practice
              </Button>
            </div>
          )}
        </div>

        {/* recent activity */}
        <div className="surface rounded-2xl p-5">
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
          {user && stats.loading && !st && <div className="mt-4 space-y-2"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>}
          {user && st && st.recent.length === 0 && (
            <p className="mt-4 text-sm text-muted-foreground">No attempts yet — your history will appear here after your first question.</p>
          )}
          {user && st && st.recent.slice(0, 6).map((a) => (
            <div key={a.id} className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate" title={a.chapter}>{a.chapter}</div>
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
        </div>
      </motion.section>

      {/* ---------- PYQ spotlight ---------- */}
      <motion.section variants={item} aria-labelledby="pyq-spotlight" className="surface relative mt-8 overflow-hidden rounded-2xl p-5 sm:p-6">
        <div
          className="pointer-events-none absolute -left-20 -top-24 h-56 w-56 rounded-full opacity-50 blur-3xl"
          style={{ background: 'radial-gradient(circle, oklch(0.82 0.16 166 / 16%), transparent 70%)' }}
          aria-hidden="true"
        />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <Library className="h-3.5 w-3.5 text-primary" /> PYQ Spotlight
              {latestYear && (
                <Badge variant="outline" className="border-primary/40 bg-primary/10 text-[10px] font-semibold normal-case tracking-normal text-primary">Latest</Badge>
              )}
            </div>
            {latestYear ? (
              <>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="bg-gradient-to-r from-primary to-chart-2 bg-clip-text font-mono text-5xl font-bold leading-none text-transparent">
                    {latestYear.year}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {latestYear.total.toLocaleString('en-IN')} questions · {latestYear.year} session
                  </span>
                </div>
                {latestYear.subjects && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(['physics', 'chemistry', 'mathematics'] as SubjectKey[]).map((sk) => {
                      const n = latestYear.subjects?.[sk]
                      if (!n) return null
                      return (
                        <span key={sk} className="flex items-center gap-1.5 rounded-full border border-border/70 bg-background/40 px-2.5 py-1 text-[11px] text-muted-foreground">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: SUBJECT_COLORS[sk] }} aria-hidden="true" />
                          {n.toLocaleString('en-IN')} {sk === 'mathematics' ? 'maths' : sk}
                        </span>
                      )
                    })}
                  </div>
                )}
              </>
            ) : (
              pyq.loading && <Skeleton className="mt-2 h-12 w-56" />
            )}
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col">
            <Button onClick={() => navigate('/pyq')} className="gap-2 transition-shadow hover:shadow-[0_0_24px_-6px_var(--primary)] active:scale-[0.98]">
              <Library className="h-4 w-4" /> Browse PYQ Library
            </Button>
            {latestYear && (
              <Button variant="outline" onClick={() => navigate(`/pyq/${latestYear.year}`)} className="active:scale-[0.98]">
                Practice {latestYear.year} paper
              </Button>
            )}
          </div>
        </div>
        <div className="relative mt-5 flex flex-wrap gap-2">
          {(pyq.data?.years ?? []).slice(0, 8).map((y) => (
            <button
              key={y.year}
              type="button"
              onClick={() => navigate(`/pyq/${y.year}`)}
              className={cn(
                'rounded-lg border px-2.5 py-1.5 font-mono text-xs transition-colors hover:border-primary/50 hover:bg-primary/[0.06]',
                y.year === latestYear?.year ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground'
              )}
            >
              {y.year}
            </button>
          ))}
          {pyq.loading && [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-8 w-16" />)}
        </div>
        <p className="relative mt-4 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          Every year listed has real imported questions — no fabricated counts, no placeholder years.
        </p>
      </motion.section>

      {/* ---------- feature strip ---------- */}
      <motion.section variants={groupItem} aria-label="Explore the arena" className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            icon: MessageSquare,
            title: 'Community chat',
            body: 'DM batchmates and build study groups — doubt solving is faster together.',
            cta: 'Open Community',
            onClick: () => navigate('/community'),
          },
          {
            icon: Trophy,
            title: 'Leaderboard',
            body: 'Weekly and all-time rankings — see where you stand among serious aspirants.',
            cta: 'See rankings',
            onClick: () => navigate('/leaderboard'),
          },
          {
            icon: ClipboardList,
            title: 'Mock tests (CBT)',
            body: 'Full-length NTA-style papers with server-authoritative timers and review filters.',
            cta: 'Take a mock',
            onClick: () => navigate('/mock'),
          },
          {
            icon: BarChart3,
            title: 'Deep analytics',
            body: 'Accuracy by subject and chapter, weak-spot detection, 14-day activity trends.',
            cta: 'See performance',
            onClick: () => navigate('/performance'),
          },
        ].map((f) => (
          <motion.div key={f.title} variants={item}>
            <button
              type="button"
              onClick={f.onClick}
              className="group surface surface-hover flex h-full w-full flex-col rounded-2xl p-5 text-left active:scale-[0.98]"
            >
              <div className="mb-3 inline-flex w-fit rounded-xl bg-primary/10 p-2.5">
                <f.icon className="h-5 w-5 text-primary" />
              </div>
              <div className="font-semibold">{f.title}</div>
              <p className="mt-1 flex-1 text-xs leading-relaxed text-muted-foreground">{f.body}</p>
              <span className="mt-3 flex items-center gap-1 text-xs font-medium text-primary">
                {f.cta} <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
              </span>
            </button>
          </motion.div>
        ))}
      </motion.section>
    </motion.div>
  )
}
