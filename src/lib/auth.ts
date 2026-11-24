// JEE NEXUS — server-side session auth (scrypt + httpOnly cookie)
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import type { SessionUser } from '@/lib/types'

const COOKIE_NAME = 'jee_nexus_session'
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30 // 30 days

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, key] = stored.split(':')
  if (!salt || !key) return false
  const hash = scryptSync(password, salt, 64)
  const keyBuf = Buffer.from(key, 'hex')
  if (keyBuf.length !== hash.length) return false
  return timingSafeEqual(hash, keyBuf)
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await db.session.create({ data: { token, userId, expiresAt } })
  const jar = await cookies()
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt,
    path: '/',
  })
  return token
}

export async function destroySession(): Promise<void> {
  const jar = await cookies()
  const token = jar.get(COOKIE_NAME)?.value
  if (token) {
    await db.session.deleteMany({ where: { token } })
  }
  jar.delete(COOKIE_NAME)
}

/** Returns the logged-in user (or null). Trims expired sessions opportunistically. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies()
  const token = jar.get(COOKIE_NAME)?.value
  if (!token) return null
  const session = await db.session.findUnique({
    where: { token },
    include: { user: true },
  })
  if (!session) return null
  if (session.expiresAt.getTime() < Date.now()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {})
    return null
  }
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role === 'admin' ? 'admin' : 'student',
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}

/** Guard: any logged-in user */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) throw new HttpError(401, 'Not authenticated')
  return user
}

/** Guard: admin only (server-side role check, never frontend-only) */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser()
  if (user.role !== 'admin') throw new HttpError(403, 'Admin access required')
  return user
}

export function jsonError(err: unknown) {
  if (err instanceof HttpError) {
    return Response.json({ error: err.message }, { status: err.status })
  }
  // Structured logging: workerd's console serializer drops the message line of
  // Prisma errors (only the stack survives), which made production 500s
  // undiagnosable. Log explicit fields as one flat string instead.
  const e = err as { name?: string; code?: string; message?: string; meta?: unknown; stack?: string }
  console.error(
    `[api] ${e?.name ?? 'Error'} code=${e?.code ?? '-'} msg=${String(e?.message ?? err).slice(0, 500)}` +
      ` meta=${JSON.stringify(e?.meta ?? null)?.slice(0, 300)} stack=${(e?.stack ?? '').split('\n').slice(0, 4).join(' | ')}`
  )
  return Response.json({ error: 'Internal server error' }, { status: 500 })
}

/** Simple in-memory rate limiter (per-process). Production edge proxies add global limits. */
const buckets = new Map<string, { count: number; resetAt: number }>()
export function rateLimit(key: string, max: number, windowMs: number): void {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return
  }
  b.count++
  if (b.count > max) throw new HttpError(429, 'Too many requests — slow down')
}
