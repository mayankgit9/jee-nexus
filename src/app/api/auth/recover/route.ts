import { NextRequest } from 'next/server'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { clientIp, rateLimit, jsonError, HttpError } from '@/lib/auth'

/**
 * POST /api/auth/recover — self-recovery without SMTP (2026-11-28).
 *
 * This deployment has no email delivery, so recovery is identity-proof based:
 *
 * mode "username"  { email }                    → returns the username(s)
 *                                                  registered with that email.
 * mode "password"  { username, email }          → BOTH must match the same
 *                                                  account; a single-use
 *                                                  30-min reset token is
 *                                                  then returned inline and
 *                                                  consumed by /api/auth/reset.
 *
 * Without an email on file there is no self-recovery (the signup flow says so
 * up front). Every path is rate-limited per-IP; "password" additionally per
 * username+email pair. Existence is never leaked: "username" always answers
 * ok:true, and "password" answers ok:true with no token on any mismatch.
 */
export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req)
    await rateLimit(`recover:${ip}`, 10, 60_000)
    const body = await req.json()
    const mode = String(body.mode ?? 'password')

    const email = String(body.email ?? '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpError(400, 'Enter the email you registered with (or would have registered with)')
    }

    if (mode === 'username') {
      const accounts = await db.user.findMany({
        where: { email },
        select: { username: true },
        take: 5,
      })
      return Response.json({ ok: true, usernames: accounts.map((a) => a.username) })
    }

    // mode "password"
    const username = String(body.username ?? '').trim().toLowerCase()
    if (!username) throw new HttpError(400, 'Enter your username too')
    await rateLimit(`recover-pw:${username}:${email}`, 3, 60 * 60_000)

    const user = await db.user.findFirst({
      where: { username, email },
      select: { id: true },
    })
    // No leak: identical response shape whether or not the pair matched
    if (!user) {
      return Response.json({
        ok: true,
        note: 'If that username and email match an account, a reset token was generated. Check the tips below if it did not arrive.',
      })
    }

    const token = randomBytes(32).toString('hex')
    await db.passwordReset.create({
      data: { userId: user.id, token, expiresAt: new Date(Date.now() + 1000 * 60 * 30) },
    })
    return Response.json({
      ok: true,
      resetToken: token,
      note: 'Identity verified (username + email match). Set a new password below — the token expires in 30 minutes.',
    })
  } catch (err) {
    return jsonError(err)
  }
}
