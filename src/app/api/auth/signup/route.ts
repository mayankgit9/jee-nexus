import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { clientIp, createSession, hashPassword, rateLimit, jsonError, HttpError } from '@/lib/auth'

// Username rules: 3-20 chars, lowercase letters/digits/dot/dash/underscore.
const USERNAME_RE = /^[a-z0-9_.-]{3,20}$/
// Never let an account shadow system names or the lobby.
const RESERVED = new Set(['admin', 'administrator', 'lobby', 'general', 'support', 'root', 'system', 'mod', 'moderator', 'official', 'jeenexus', 'jee-nexus'])

/**
 * POST /api/auth/signup — username + password + OPTIONAL email.
 * Email is captured purely for self-recovery (forgot username / forgot
 * password); the account works fully without it.
 */
export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req)
    await rateLimit(`signup:${ip}`, 5, 60_000)
    const body = await req.json()

    const username = String(body.username ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')
    const rawEmail = String(body.email ?? '').trim().toLowerCase()
    const email = rawEmail.length > 0 ? rawEmail : null
    const name = String(body.name ?? '').trim() || username

    if (!USERNAME_RE.test(username)) {
      throw new HttpError(400, 'Username must be 3-20 characters: a-z, 0-9, dot, dash or underscore')
    }
    if (RESERVED.has(username)) throw new HttpError(400, 'That username is reserved — pick another')
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters')
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address (or leave it empty)')

    const existing = await db.user.findUnique({ where: { username } })
    if (existing) throw new HttpError(409, 'That username is already taken')
    if (email) {
      const byEmail = await db.user.findUnique({ where: { email } })
      if (byEmail) throw new HttpError(409, 'An account with this email already exists')
    }

    // First registered user OR whitelisted email becomes admin
    const isFirst = (await db.user.count()) === 0
    const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
    const role = isFirst || (email !== null && adminEmails.includes(email)) ? 'admin' : 'student'

    const user = await db.user.create({
      data: { username, email, passwordHash: hashPassword(password), name, role },
      select: { id: true, username: true, email: true, name: true, role: true },
    })
    await createSession(user.id)
    return Response.json({ user })
  } catch (err) {
    return jsonError(err)
  }
}
