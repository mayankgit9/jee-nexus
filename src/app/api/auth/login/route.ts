import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { createSession, verifyPassword, rateLimit, jsonError, HttpError } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for') ?? 'local'
    await rateLimit(`login:${ip}`, 10, 60_000)
    const body = await req.json()
    const email = String(body.email ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')

    const user = await db.user.findUnique({ where: { email } })
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new HttpError(401, 'Invalid email or password')
    }
    await createSession(user.id)
    return Response.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    })
  } catch (err) {
    return jsonError(err)
  }
}
