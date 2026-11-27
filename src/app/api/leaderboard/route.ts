import { NextRequest } from 'next/server'
import { dbClient } from '@/lib/db'
import { getSessionUser, jsonError, rateLimit } from '@/lib/auth'
import { computeRankedBoard, WEEK_MS, WEEK_OFFSET_MAX_BOUND } from '@/lib/leaderboard'

/**
 * GET /api/leaderboard?period=week|all&weekOffset=0..12 — community practice
 * leaderboard.
 *
 * Public: anonymous visitors can browse (names only, emails never ship);
 * a signed-in caller additionally gets `you` (rank + stats) and `isYou`
 * markers. Ranking metric: graded attempts in period (practice attempts
 * + submitted/expired CBT answers, same merge as the stats dashboard),
 * ties broken by correct count then least time (most efficient wins).
 *
 * weekOffset (period=week only) walks BACK through past windows: 0 = the
 * trailing 7 days (unchanged from the original rolling behavior), 1 = the
 * 7 days before that, etc. — so archives stay browsable after the week
 * ends (weekly winners used to vanish into the all-time board).
 *
 * Ranking merge lives in src/lib/leaderboard.ts so the weekly winners
 * snapshot ranks with the exact same logic.
 */
export async function GET(req: NextRequest) {
  try {
    const period = req.nextUrl.searchParams.get('period') === 'all' ? 'all' : 'week'
    const client = dbClient()

    // optional auth: board is public, `you` requires a session
    const user = await getSessionUser()
    const ip = req.headers.get('cf-connecting-ip') ?? 'anon'
    await rateLimit(`leaderboard:${user?.id ?? ip}`, 30, 60 * 1000, client)

    const offsetRaw = Number.parseInt(req.nextUrl.searchParams.get('weekOffset') ?? '0', 10)
    const weekOffset = period === 'week' && Number.isFinite(offsetRaw)
      ? Math.min(WEEK_OFFSET_MAX_BOUND, Math.max(0, offsetRaw))
      : 0

    const now = Date.now()
    // offset 0 keeps the original trailing-7-days window; higher offsets
    // walk back in 7-day blocks: [now-(k+1)w, now-kw)
    const since = period === 'week' ? new Date(now - (weekOffset + 1) * WEEK_MS) : undefined
    const until = period === 'week' && weekOffset > 0 ? new Date(now - weekOffset * WEEK_MS) : undefined

    const ranked = await computeRankedBoard(client, { since, until })

    // names for the top 50 + the caller (rank lookups need the caller only)
    const top = ranked.slice(0, 50)
    const nameIds = [...new Set([...top.map((t) => t.userId), ...(user ? [user.id] : [])])]
    const users = nameIds.length
      ? await client.user.findMany({ where: { id: { in: nameIds } }, select: { id: true, name: true } })
      : []
    const names = new Map(users.map((u) => [u.id, u.name?.trim() || '']))

    const displayName = (id: string): string =>
      names.get(id) || `Aspirant ${id.slice(-4).toUpperCase()}`

    const leaders = top.map((t, i) => ({
      userId: t.userId,
      displayName: displayName(t.userId),
      attempts: t.attempts,
      correct: t.correct,
      accuracy: Math.round(t.accuracy * 100),
      timeSeconds: t.timeSeconds,
      isYou: user?.id === t.userId,
      rank: i + 1,
    }))

    let you: { rank: number; attempts: number; correct: number; accuracy: number; timeSeconds: number } | null = null
    if (user) {
      const idx = ranked.findIndex((r) => r.userId === user.id)
      const mine = ranked[idx]
      if (mine) {
        you = {
          rank: idx + 1,
          attempts: mine.attempts,
          correct: mine.correct,
          accuracy: Math.round(mine.accuracy * 100),
          timeSeconds: mine.timeSeconds,
        }
      } else {
        // signed in but no attempts in this period
        you = { rank: 0, attempts: 0, correct: 0, accuracy: 0, timeSeconds: 0 }
      }
    }

    return Response.json({ period, weekOffset, leaders, you, activeStudents: ranked.length })
  } catch (err) {
    return jsonError(err)
  }
}
