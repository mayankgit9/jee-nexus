// JEE NEXUS — server-side session auth (scrypt + httpOnly cookie)
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'
import { db, dbClient } from '@/lib/db'
import type { PrismaClient } from '@prisma/client'
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
    username: session.user.username,
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

/** Guard: any logged-in user.
 *  Also feeds presence: app_users.last_seen_at is bumped at most once per
 *  45s per user (in-process throttle — precision doesn't matter, write
 *  volume does). Failure is silent: presence must never block a request. */
const presenceThrottle = new Map<string, number>()
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) throw new HttpError(401, 'Not authenticated')
  const now = Date.now()
  if (now - (presenceThrottle.get(user.id) ?? 0) > 45_000) {
    presenceThrottle.set(user.id, now)
    // best-effort, fire-and-forget: an isolate death mid-write costs nothing
    void dbClient()
      .user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } })
      .catch(() => {})
  }
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
  // P2021 = table does not exist on this database (feature shipped before its
  // migration ran). Honest 503 instead of a bare 500.
  if (e?.code === 'P2021') {
    console.error(`[api] table missing (P2021): ${String(e?.message ?? '').slice(0, 200)}`)
    return Response.json(
      { error: 'This feature is not active on the live database yet — migration pending. Try again soon.' },
      { status: 503 }
    )
  }
  console.error(
    `[api] ${e?.name ?? 'Error'} code=${e?.code ?? '-'} msg=${String(e?.message ?? err).slice(0, 500)}` +
      ` meta=${JSON.stringify(e?.meta ?? null)?.slice(0, 300)} stack=${(e?.stack ?? '').split('\n').slice(0, 12).join(' | ')}`
  )
  return Response.json({ error: 'Internal server error' }, { status: 500 })
}

/**
 * DB-backed sliding-window rate limiter (async — every call site awaits it).
 *
 * The previous in-memory Map worked locally (single process) but was PROVEN
 * ineffective on Cloudflare Workers: each isolate keeps its own Map, so the
 * 30/min chat-send limit never tripped in production (live e2e 2026-11-25:
 * 31/31 sends returned 200). The window now lives in Postgres
 * (rate_limit_counters) so every isolate shares it; the limiter itself is a
 * write (see the Hyperdrive lesson below) and rejected attempts only bump
 * the counter — spam cannot grow the table.
 *
 * WORKERS RESOURCE LESSON (prod incident 2026-11-25, error 1102): on Workers
 * every `db` Proxy access instantiates a fresh Prisma engine + pg pool. The
 * first version ran count/insert/cleanup through separate Proxy accesses —
 * up to 3 extra engines per request — which pushed busy isolates (import
 * runner + chat) past the 128MB limit and 503'd random requests. ALL limiter
 * queries therefore go through ONE client: passed in by routes that already
 * hold a dbClient() (chat routes: zero extra engines), else one dbClient()
 * created here (never the per-access Proxy).
 *
 * HYPERDRIVE CACHE LESSONS (prod-verified 2026-11-25, FOUR live iterations):
 * (1) an events-table COUNT is a read — Hyperdrive served the identical
 *     query text stale (31 sends all saw the first result); (2) running it
 *     in a $transaction did not bypass the cache; (3) a uuid in a SQL
 *     comment to bust the text hash broke parameter typing (42P18: comment
 *     params are invisible to the parser); (4) even INSERT..ON CONFLICT..
 *     RETURNING got cached — DML with a result set is apparently treated as
 *     a cacheable read, so bursts saw a stale "hits" and never tripped.
 * CONCLUSION: the limiter must be a write with NO result set and NO reads.
 * It now is: ONE $executeRaw upsert (command tag only) into
 * rate_limit_counters, where a BEFORE trigger (migration 0010) RAISEs
 * RATE_LIMIT_EXCEEDED once hits would pass limit_max — mapped to 429 here.
 * Rejected attempts abort inside Postgres (spam extends nothing), the check
 * is atomic by definition, and there is nothing left for any cache to serve.
 *
 * Fails OPEN on DB errors: a limiter outage must not take features down (the
 * guarded action still has its own auth/membership checks) — prod-verified
 * during the 42P18 incident: every guarded route stayed 200.
 */
export async function rateLimit(
  key: string,
  max: number,
  windowMs: number,
  client: PrismaClient = dbClient()
): Promise<void> {
  try {
    const seconds = Math.round(windowMs / 1000)
    await client.$executeRaw`
      insert into rate_limit_counters (key, window_start, hits, window_seconds, limit_max)
      values (${key}, now(), 1, ${seconds}, ${max})
      on conflict (key) do update set
        hits = case when rate_limit_counters.window_start < now() - (rate_limit_counters.window_seconds * interval '1 second')
                    then 1 else rate_limit_counters.hits + 1 end,
        window_start = case when rate_limit_counters.window_start < now() - (rate_limit_counters.window_seconds * interval '1 second')
                    then now() else rate_limit_counters.window_start end`
  } catch (err) {
    const msg = String((err as Error)?.message ?? err)
    if (msg.includes('RATE_LIMIT_EXCEEDED')) throw new HttpError(429, 'Too many requests — slow down')
    console.error(`[rateLimit] degraded, failing open (key=${key}): ${msg.slice(0, 200)}`)
    return
  }
  // Opportunistic cleanup (2% of calls): inactive keys only — a plain write.
  // 2h is safely past the longest window in use (1h).
  if (Math.random() < 0.02) {
    await client
      .$executeRaw`delete from rate_limit_counters where window_start < now() - interval '2 hours'`
      .catch(() => {})
  }
}

/**
 * Client IP for rate-limit keys. Cloudflare sets cf-connecting-ip on every
 * request reaching the worker; x-forwarded-for (when present) is a comma
 * list whose first hop is the client. Prod evidence (2026-11-25): neither
 * was being read correctly — every anonymous client shared the 'local'
 * bucket (signup:local), so one user's flood could lock out everyone.
 */
export function clientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'local'
  )
}
