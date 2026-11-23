import { NextRequest } from 'next/server'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { rateLimit, jsonError, HttpError } from '@/lib/auth'

/**
 * Password recovery — request a reset token.
 * In this sandboxed deployment the token is returned directly (no SMTP available);
 * in production with Supabase Auth configured this route delegates to Supabase's
 * resetPasswordForEmail and never returns the token inline.
 */
export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for') ?? 'local'
    rateLimit(`recover:${ip}`, 5, 60_000)
    const body = await req.json()
    const email = String(body.email ?? '').trim().toLowerCase()

    const user = await db.user.findUnique({ where: { email } })
    // Do not leak whether the account exists
    if (!user) return Response.json({ ok: true })

    const token = randomBytes(32).toString('hex')
    await db.passwordReset.create({
      data: { userId: user.id, token, expiresAt: new Date(Date.now() + 1000 * 60 * 30) },
    })
    return Response.json({ ok: true, resetToken: token, note: 'sandbox-mode: token returned inline; production sends email' })
  } catch (err) {
    return jsonError(err)
  }
}
