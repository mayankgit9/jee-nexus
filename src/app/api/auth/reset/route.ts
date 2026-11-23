import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword, createSession, rateLimit, jsonError, HttpError } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for') ?? 'local'
    rateLimit(`reset:${ip}`, 5, 60_000)
    const body = await req.json()
    const token = String(body.token ?? '')
    const password = String(body.password ?? '')
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters')

    const pr = await db.passwordReset.findUnique({ where: { token } })
    if (!pr || pr.usedAt || pr.expiresAt.getTime() < Date.now()) {
      throw new HttpError(400, 'This reset link is invalid or has expired')
    }

    await db.$transaction([
      db.user.update({ where: { id: pr.userId }, data: { passwordHash: hashPassword(password) } }),
      db.passwordReset.update({ where: { id: pr.id }, data: { usedAt: new Date() } }),
      db.session.deleteMany({ where: { userId: pr.userId } }),
    ])
    await createSession(pr.userId)
    return Response.json({ ok: true })
  } catch (err) {
    return jsonError(err)
  }
}
