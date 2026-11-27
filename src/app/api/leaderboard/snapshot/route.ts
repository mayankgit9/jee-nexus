import { NextRequest } from 'next/server'
import { dbClient } from '@/lib/db'
import { jsonError } from '@/lib/auth'
import { computeRankedBoard, WEEK_MS, WINNER_WINDOW_MAX_AGE } from '@/lib/leaderboard'

/**
 * POST /api/leaderboard/snapshot — pin the top-3 of a CLOSED week.
 *
 * Called by the weekly GitHub Actions cron (weekly-winners.yml) shortly
 * after Monday 00:00 UTC with {"windowStart": "...", "windowEnd": "..."} —
 * a fully closed, exactly-7-days window. Auth: `Authorization: Bearer
 * <SNAPSHOT_TOKEN>` matched against the worker secret / env var; no user
 * session involved (the cron has no account).
 *
 * Ranking reuses computeRankedBoard() — the exact merge the live board
 * shows — then inserts up to 3 rows into weekly_winners with
 * createMany(skipDuplicates): the unique (window_start, window_end, rank)
 * constraint makes cron retries and manual dispatches idempotent. A window
 * that already has winners returns inserted: 0 rather than re-pinning.
 *
 * Validation (hard limits, no DB writes on violation):
 *   - windowEnd - windowStart must be exactly 7 days
 *   - windowEnd must be in the past (only closed weeks are pinned)
 *   - windowEnd no older than WINNER_WINDOW_MAX_AGE weeks (write bound)
 */

function snapshotToken(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCloudflareContext } = require('@opennextjs/cloudflare') as {
      getCloudflareContext(opts: { async: false }): { env: Record<string, unknown> }
    }
    const t = getCloudflareContext({ async: false }).env.SNAPSHOT_TOKEN
    if (typeof t === 'string' && t.length > 0) return t
  } catch {
    // node runtime — fall through to process.env
  }
  return process.env.SNAPSHOT_TOKEN
}

export async function POST(req: NextRequest) {
  try {
    const expected = snapshotToken()
    if (!expected) return Response.json({ error: 'SNAPSHOT_TOKEN not configured' }, { status: 503 })
    const auth = req.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${expected}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await req.json().catch(() => null)) as { windowStart?: string; windowEnd?: string } | null
    if (!body?.windowStart || !body?.windowEnd) {
      return Response.json({ error: 'windowStart and windowEnd are required (ISO strings)' }, { status: 400 })
    }
    const start = new Date(body.windowStart)
    const end = new Date(body.windowEnd)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return Response.json({ error: 'Invalid window timestamps' }, { status: 400 })
    }
    if (end.getTime() - start.getTime() !== WEEK_MS) {
      return Response.json({ error: 'Window must be exactly 7 days' }, { status: 400 })
    }
    const now = Date.now()
    if (end.getTime() > now) {
      return Response.json({ error: 'Only fully closed windows can be pinned' }, { status: 400 })
    }
    if (now - end.getTime() > WINNER_WINDOW_MAX_AGE * WEEK_MS) {
      return Response.json({ error: `Window older than ${WINNER_WINDOW_MAX_AGE} weeks` }, { status: 400 })
    }

    const client = dbClient()
    const ranked = await computeRankedBoard(client, { since: start, until: end })
    const top = ranked.slice(0, 3)
    if (top.length === 0) {
      return Response.json({
        windowStart: start.toISOString(),
        windowEnd: end.toISOString(),
        inserted: 0,
        winners: [],
        note: 'No graded attempts in window — nothing pinned',
      })
    }

    const users = await client.user.findMany({
      where: { id: { in: top.map((t) => t.userId) } },
      select: { id: true, name: true },
    })
    const names = new Map(users.map((u) => [u.id, u.name?.trim() || '']))
    const displayName = (id: string): string => names.get(id) || `Aspirant ${id.slice(-4).toUpperCase()}`

    const result = await client.weeklyWinner.createMany({
      data: top.map((t, i) => ({
        windowStart: start,
        windowEnd: end,
        rank: i + 1,
        userId: t.userId,
        userName: displayName(t.userId),
        attempts: t.attempts,
        correct: t.correct,
        accuracy: Math.round(t.accuracy * 100),
        timeSeconds: t.timeSeconds,
      })),
      skipDuplicates: true,
    })

    return Response.json({
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      inserted: result.count,
      winners: top.map((t, i) => ({
        rank: i + 1,
        userName: displayName(t.userId),
        attempts: t.attempts,
        correct: t.correct,
        accuracy: Math.round(t.accuracy * 100),
      })),
    })
  } catch (err) {
    return jsonError(err)
  }
}
