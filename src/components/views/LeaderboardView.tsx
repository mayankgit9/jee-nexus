'use client'

// JEE NEXUS — leaderboard view (community practice rankings)
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Trophy, Crown, Timer, Users, Zap, ArrowRight, Target, Flame, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useApi, navigate, formatDuration } from '@/lib/client'
import type { SessionUser } from '@/lib/types'

interface Leader {
  userId: string
  displayName: string
  attempts: number
  correct: number
  accuracy: number
  timeSeconds: number
  isYou: boolean
  rank: number
}

interface LeaderboardData {
  period: 'week' | 'all'
  weekOffset?: number
  leaders: Leader[]
  you: { rank: number; attempts: number; correct: number; accuracy: number; timeSeconds: number } | null
  activeStudents: number
}

const WEEK_OFFSET_MAX = 12
const weekLabel = (offset: number): string =>
  offset === 0 ? 'This week' : offset === 1 ? 'Last week' : `${offset} weeks ago`

const PODIUM_STYLES: Record<number, { ring: string; chip: string; label: string }> = {
  1: { ring: 'border-amber-400/50 bg-amber-400/[0.07]', chip: 'border-amber-400/40 bg-amber-400/15 text-amber-400', label: 'Gold' },
  2: { ring: 'border-slate-300/40 bg-slate-300/[0.06]', chip: 'border-slate-300/40 bg-slate-300/15 text-slate-300', label: 'Silver' },
  3: { ring: 'border-orange-500/40 bg-orange-500/[0.06]', chip: 'border-orange-500/40 bg-orange-500/15 text-orange-400', label: 'Bronze' },
}

const initials = (name: string) =>
  name.split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase() || '?'

function accuracyBarClass(a: number) {
  if (a >= 70) return 'bg-emerald-400'
  if (a >= 40) return 'bg-amber-400'
  return 'bg-rose-400'
}

export function LeaderboardView({ user, onRequireAuth }: { user: SessionUser | null; onRequireAuth: () => void }) {
  const [period, setPeriod] = useState<'week' | 'all'>('week')
  const [weekOffset, setWeekOffset] = useState(0)
  const { data, loading, error } = useApi<LeaderboardData>(
    period === 'week' ? `/api/leaderboard?period=week&weekOffset=${weekOffset}` : '/api/leaderboard?period=all'
  )
  const leaders = data?.leaders ?? []
  const podium = leaders.slice(0, 3)
  const rest = leaders.slice(3)
  const you = data?.you ?? null
  const youInTop = podium.concat(rest).some((l) => l.isYou)

  return (
    <div className="mx-auto max-w-3xl">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
            <Trophy className="h-6 w-6 text-primary" /> Leaderboard
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {period === 'week'
              ? 'Practice attempts over the trailing 7 days — consistency beats cramming.'
              : 'All-time practice attempts since day one.'}
          </p>
        </div>
        {/* period switcher + week navigation (past weeks stay browsable) */}
        <div className="flex items-center gap-2">
          {period === 'week' && (
            <div className="flex items-center rounded-lg border border-border bg-card" role="group" aria-label="Week navigation">
              <button
                type="button"
                onClick={() => setWeekOffset((w) => Math.min(WEEK_OFFSET_MAX, w + 1))}
                disabled={weekOffset >= WEEK_OFFSET_MAX || loading}
                className="rounded-lg px-2 py-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                aria-label="Previous week"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-[92px] text-center text-xs font-medium" aria-live="polite">
                {weekLabel(weekOffset)}
              </span>
              <button
                type="button"
                onClick={() => setWeekOffset((w) => Math.max(0, w - 1))}
                disabled={weekOffset === 0 || loading}
                className="rounded-lg px-2 py-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                aria-label="Next week"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
          <div className="flex rounded-lg border border-border bg-card p-1" role="tablist" aria-label="Leaderboard period">
            {(['week', 'all'] as const).map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={period === p}
                onClick={() => {
                  setPeriod(p)
                  if (p === 'week') setWeekOffset(0)
                }}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  period === p ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {p === 'week' ? 'This week' : 'All time'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {data && data.activeStudents > 0 && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5 text-primary" />
          {data.activeStudents.toLocaleString('en-IN')} aspirant{data.activeStudents === 1 ? '' : 's'} active{' '}
          {period === 'week' ? (weekOffset === 0 ? 'this week' : weekOffset === 1 ? 'last week' : `${weekOffset} weeks ago`) : 'all time'}
        </div>
      )}

      {/* loading */}
      {loading && (
        <div className="mt-6 space-y-4">
          <div className="grid grid-cols-3 gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40" />)}</div>
          <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        </div>
      )}

      {error && <p className="mt-6 text-sm text-rose-400">{error}</p>}

      {/* empty */}
      {!loading && !error && leaders.length === 0 && (
        <div className="mt-8 rounded-2xl border border-dashed border-border p-10 text-center">
          <Zap className="mx-auto h-10 w-10 text-primary" />
          <h2 className="mt-4 text-lg font-semibold">A clean slate</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            No attempts recorded {period === 'week' ? 'in the last 7 days' : 'yet'} — the first question you answer puts you on the board.
          </p>
          <Button className="mt-5" onClick={() => navigate(user ? '/practice' : '/login')}>
            {user ? 'Be the first' : 'Sign in to compete'} <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </div>
      )}

      {/* podium */}
      {!loading && podium.length > 0 && (
        <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-3">
          {[podium[1], podium[0], podium[2]].filter(Boolean).map((l, i) => {
            const style = PODIUM_STYLES[l.rank] ?? PODIUM_STYLES[3]
            const isFirst = l.rank === 1
            return (
              <motion.div
                key={l.userId}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08, duration: 0.35 }}
                className={cn(
                  'relative flex flex-col items-center rounded-2xl border px-2 py-5 text-center',
                  style.ring,
                  l.isYou && 'ring-2 ring-primary/60',
                  isFirst && 'sm:py-7'
                )}
              >
                {isFirst && <Crown className="absolute -top-3.5 left-1/2 h-7 w-7 -translate-x-1/2 text-amber-400" aria-hidden="true" />}
                <div className={cn('flex h-12 w-12 items-center justify-center rounded-full border text-sm font-bold sm:h-14 sm:w-14', style.chip)}>
                  {initials(l.displayName)}
                </div>
                <div className="mt-2 line-clamp-1 max-w-full text-xs font-semibold sm:text-sm">
                  {l.displayName}
                </div>
                {l.isYou && <Badge className="mt-1 h-4 px-1.5 text-[9px]">You</Badge>}
                <div className="mt-2 text-xl font-bold leading-none sm:text-2xl">{l.attempts.toLocaleString('en-IN')}</div>
                <div className="text-[10px] text-muted-foreground">attempts</div>
                <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-0.5"><Target className="h-3 w-3" />{l.accuracy}%</span>
                  <span className="flex items-center gap-0.5"><Timer className="h-3 w-3" />{formatDuration(l.timeSeconds)}</span>
                </div>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* ranked list */}
      {!loading && rest.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-border">
          {rest.map((l, i) => (
            <motion.div
              key={l.userId}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: Math.min(i * 0.03, 0.4) }}
              className={cn(
                'flex items-center gap-3 border-b border-border/60 px-4 py-3 last:border-b-0',
                l.isYou ? 'bg-primary/[0.07]' : 'bg-card hover:bg-muted/40'
              )}
            >
              <span className="w-7 shrink-0 text-center text-sm font-semibold text-muted-foreground">{l.rank}</span>
              <span className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                l.isYou ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
              )}>
                {initials(l.displayName)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <span className="truncate">{l.displayName}</span>
                  {l.isYou && <Badge className="h-4 px-1.5 text-[9px]">You</Badge>}
                </div>
                <div className="mt-1 h-1.5 w-full max-w-[180px] overflow-hidden rounded-full bg-muted">
                  <div className={cn('h-full rounded-full', accuracyBarClass(l.accuracy))} style={{ width: `${l.accuracy}%` }} />
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-semibold">{l.attempts.toLocaleString('en-IN')}</div>
                <div className="text-[10px] text-muted-foreground">{l.accuracy}% · {formatDuration(l.timeSeconds)}</div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* your standing */}
      {!loading && user && you && !youInTop && (
        <div className="mt-4 rounded-2xl border border-primary/40 bg-primary/[0.07] px-4 py-3.5">
          {you.rank > 0 ? (
            <div className="flex items-center gap-3">
              <span className="w-7 shrink-0 text-center text-sm font-semibold text-primary">{you.rank}</span>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[11px] font-bold text-primary">
                {(user.name ?? 'You')[0].toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">You</div>
                <div className="text-[11px] text-muted-foreground">
                  {you.attempts.toLocaleString('en-IN')} attempt{you.attempts === 1 ? '' : 's'} · {you.accuracy}% accuracy · {formatDuration(you.timeSeconds)}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => navigate('/practice')}>Climb up</Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Flame className="h-5 w-5 text-primary" />
              <p className="flex-1 text-sm text-muted-foreground">
                You haven&apos;t attempted any questions {period === 'week' ? 'this week' : 'yet'} — one session is all it takes to get ranked.
              </p>
              <Button size="sm" onClick={() => navigate('/practice')}>Start now</Button>
            </div>
          )}
        </div>
      )}

      {/* anonymous CTA */}
      {!loading && !user && leaders.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-border px-4 py-3.5">
          <Trophy className="h-5 w-5 text-primary" />
          <p className="flex-1 text-sm text-muted-foreground">Want your name up there? Sign in free — every attempt counts.</p>
          <Button size="sm" onClick={onRequireAuth}>Sign in / Create account</Button>
        </div>
      )}
    </div>
  )
}
