import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { createSession, hashPassword, rateLimit, jsonError, HttpError } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for') ?? 'local'
    await rateLimit(`signup:${ip}`, 5, 60_000)
    const body = await req.json()
    const email = String(body.email ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')
    const name = String(body.name ?? '').trim() || null

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address')
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters')

    const existing = await db.user.findUnique({ where: { email } })
    if (existing) throw new HttpError(409, 'An account with this email already exists')

    // First registered user OR whitelisted email becomes admin
    const isFirst = (await db.user.count()) === 0
    const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
    const role = isFirst || adminEmails.includes(email) ? 'admin' : 'student'

    const user = await db.user.create({
      data: { email, passwordHash: hashPassword(password), name, role },
      select: { id: true, email: true, name: true, role: true },
    })
    await createSession(user.id)
    return Response.json({ user })
  } catch (err) {
    return jsonError(err)
  }
}
