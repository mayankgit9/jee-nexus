import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, jsonError, HttpError, rateLimit } from '@/lib/auth'
import type { Prisma } from '@prisma/client'

/**
 * Saved custom-test configurations (Part F, migration 0019).
 * GET    /api/exam/configs       → the student's saved builder presets
 * POST   /api/exam/configs       → save { name, config }
 * PATCH  /api/exam/configs       → rename/update { id, name?, config? }
 * DELETE /api/exam/configs?id=   → remove
 * All rows are scoped to the session user.
 */
export async function GET() {
  try {
    const user = await requireUser()
    const rows = await db.savedTestConfig.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    })
    return Response.json({ configs: rows })
  } catch (err) {
    return jsonError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    await rateLimit(`exam-config:${user.id}`, 30, 60_000)
    const body = await req.json()
    const name = String(body.name ?? '').trim().slice(0, 80)
    if (!name) throw new HttpError(400, 'name is required')
    if (typeof body.config !== 'object' || body.config === null) throw new HttpError(400, 'config is required')
    const row = await db.savedTestConfig.create({
      data: { userId: user.id, name, config: body.config },
    })
    return Response.json({ config: row })
  } catch (err) {
    return jsonError(err)
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser()
    const body = await req.json()
    const id = String(body.id ?? '')
    if (!id) throw new HttpError(400, 'id is required')
    const data: { name?: string; config?: Prisma.InputJsonValue; updatedAt: Date } = { updatedAt: new Date() }
    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 80)
    if (typeof body.config === 'object' && body.config !== null) data.config = body.config as Prisma.InputJsonValue
    const r = await db.savedTestConfig.updateMany({ where: { id, userId: user.id }, data })
    if (r.count === 0) throw new HttpError(404, 'Config not found')
    return Response.json({ ok: true })
  } catch (err) {
    return jsonError(err)
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser()
    const id = req.nextUrl.searchParams.get('id')
    if (!id) throw new HttpError(400, 'id is required')
    const r = await db.savedTestConfig.deleteMany({ where: { id, userId: user.id } })
    if (r.count === 0) throw new HttpError(404, 'Config not found')
    return Response.json({ ok: true })
  } catch (err) {
    return jsonError(err)
  }
}
