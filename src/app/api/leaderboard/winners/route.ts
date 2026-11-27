import { dbClient } from '@/lib/db'
import { jsonError, rateLimit, clientIp } from '@/lib/auth'

/**
 * GET /api/leaderboard/winners — public hall of fame: pinned top-3 of every
 * CLOSED week (written by the weekly cron via POST /api/leaderboard/snapshot).
 * Rows grouped per window in JS, newest week first, rank ascending inside.
 * Names are pinned snapshots (userName at pin time) — no email ever ships.
 */
export async function GET(req: Request) {
  try {
    const client = dbClient()
    await rateLimit(`winners:${clientIp(req)}`, 30, 60 * 1000, client)

    const rows = await client.weeklyWinner.findMany({
      orderBy: [{ windowEnd: 'desc' }, { rank: 'asc' }],
      take: 90, // 30 weeks x 3
    })

    const windows = new Map<
      string,
      { windowStart: string; windowEnd: string; winners: Array<{ rank: number; userName: string; userId: string | null; attempts: number; correct: number; accuracy: number; timeSeconds: number }> }
    >()
    for (const r of rows) {
      const key = `${r.windowStart.toISOString()}|${r.windowEnd.toISOString()}`
      let w = windows.get(key)
      if (!w) {
        w = { windowStart: r.windowStart.toISOString(), windowEnd: r.windowEnd.toISOString(), winners: [] }
        windows.set(key, w)
      }
      w.winners.push({
        rank: r.rank,
        userName: r.userName,
        userId: r.userId,
        attempts: r.attempts,
        correct: r.correct,
        accuracy: r.accuracy,
        timeSeconds: r.timeSeconds,
      })
    }

    return Response.json({ windows: [...windows.values()] })
  } catch (err) {
    return jsonError(err)
  }
}
