import { NextRequest } from 'next/server'
import { dbClient } from '@/lib/db'
import { requireUser, jsonError, rateLimit } from '@/lib/auth'
import { maskEmail } from '@/lib/chat'

/**
 * GET /api/chat/users?q=... — searchable directory for starting DMs and
 * adding group members. Matches on name OR email (case-insensitive,
 * minimum 2 characters). Emails are masked — never returned in full.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser()
    await rateLimit(`chat-users:${user.id}`, 60, 60 * 1000)
    const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
    if (q.length < 2) return Response.json({ users: [] })

    const client = dbClient()
    const rows = await client.user.findMany({
      where: {
        id: { not: user.id },
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, email: true },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
      take: 10,
    })

    return Response.json({
      users: rows.map((u) => ({ id: u.id, name: u.name ?? 'Student', email: maskEmail(u.email) })),
    })
  } catch (err) {
    return jsonError(err)
  }
}
