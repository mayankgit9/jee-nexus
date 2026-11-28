import { NextRequest } from 'next/server'
import { dbClient } from '@/lib/db'
import { requireUser, jsonError, rateLimit } from '@/lib/auth'
import { maskEmail } from '@/lib/chat'

/**
 * GET /api/chat/users?q=... — searchable directory for starting DMs and
 * adding group members. Matches on name OR email (case-insensitive,
 * minimum 2 characters). Emails are masked — never returned in full.
 *
 * Ranking (prod lesson 2026-11-25): with name ASC + a 10-row cap, once ten
 * older users share a name the NEWEST one is unfindable — exactly the person
 * a new student is most likely looking for. Prefix matches rank first, then
 * newest-first inside each rank (SQL order: prefix wins, recency breaks ties).
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser()
    const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
    if (q.length < 2) return Response.json({ users: [] })

    const client = dbClient()
    await rateLimit(`chat-users:${user.id}`, 60, 60 * 1000, client)
    const rows = (await client.$queryRawUnsafe(
      `select id, name, email
         from app_users
        where id <> $1
          and (name ilike $2 or email ilike $2)
        order by (case when lower(name) like $3 or lower(email) like $3 then 0 else 1 end),
                 created_at desc
        limit 10`,
      user.id,
      `%${q}%`,
      `${q.toLowerCase()}%`
    )) as { id: string; name: string | null; email: string | null }[]

    return Response.json({
      users: rows.map((u) => ({ id: u.id, name: u.name ?? 'Student', email: u.email ? maskEmail(u.email) : null })),
    })
  } catch (err) {
    return jsonError(err)
  }
}
