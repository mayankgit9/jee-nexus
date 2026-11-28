import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { clientIp, createSession, verifyPassword, rateLimit, jsonError, HttpError } from '@/lib/auth'

/**
 * POST /api/auth/login — username + password (2026-11-28 auth rework).
 * Usernames are stored lowercase; lookup is case-insensitive for UX.
 */
export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req)
    await rateLimit(`login:${ip}`, 10, 60_000)
    const body = await req.json()
    const username = String(body.username ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')

    const user = await db.user.findUnique({ where: { username } })
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new HttpError(401, 'Invalid username or password')
    }
    await createSession(user.id)
    return Response.json({
      user: { id: user.id, username: user.username, email: user.email, name: user.name, role: user.role },
    })
  } catch (err) {
    return jsonError(err)
  }
}
