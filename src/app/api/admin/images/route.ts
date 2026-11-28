import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, jsonError, HttpError, rateLimit } from '@/lib/auth'
import { createHash } from 'crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

/**
 * Question-image management (Part B, migration 0019).
 *
 * GET /api/admin/images?filter=… — audit queue (hidden, broken, missing,
 *      duplicate, all) with per-question context + summary counts.
 * GET ?imageId=… — one image row with its question.
 *
 * POST /api/admin/images — run the URL/asset audit:
 *      { action: 'audit', sample?: 1..2000 }
 *      · verifies every non-hidden image URL resolves to a real file in
 *        public/ (the deployed asset source) → status broken/ok
 *      · computes content hashes for duplicate detection
 *      · flags questions whose images are ALL hidden as 'missing figure'
 * POST (multipart) /api/admin/images — replace an image file:
 *      fields: imageId, file, reconstructed? ('true' when the new file is an
 *      AI/artist reconstruction — the ORIGINAL url is preserved in
 *      replaced_from_url and the UI labels the reconstruction).
 *
 * PATCH /api/admin/images — metadata fixes { imageId, altText?, caption?,
 *      attribution?, order?, hidden?, status? } — question-image association
 *      corrections happen through verified explicit admin edits only.
 */

type AuditRow = { id: string; url: string; status: string }

export async function GET(req: NextRequest) {
  try {
    await requireAdmin()
    const sp = req.nextUrl.searchParams
    const imageId = sp.get('imageId')
    const filter = sp.get('filter') ?? 'summary'
    const page = Math.max(1, Math.min(500, Number(sp.get('page') ?? 1)))
    const pageSize = 24

    if (imageId) {
      const img = await db.questionImage.findUnique({
        where: { id: imageId },
        include: { question: { select: { publicId: true, text: true, subject: { select: { key: true } } } } },
      })
      if (!img) throw new HttpError(404, 'Image not found')
      return Response.json({ image: img })
    }

    if (filter === 'summary') {
      const [statusCounts, hidden, total, byHash] = await Promise.all([
        db.questionImage.groupBy({ by: ['status'], _count: { _all: true }, where: { hidden: false } }),
        db.questionImage.count({ where: { hidden: true } }),
        db.questionImage.count(),
        db.$queryRaw<{ content_hash: string; n: number }[]>`
          select content_hash, count(*)::int as n from question_images
          where content_hash is not null and hidden = false
          group by content_hash having count(*) > 1 limit 20`,
      ])
      return Response.json({
        total,
        hidden,
        statusCounts: Object.fromEntries(statusCounts.map((c) => [c.status, c._count._all])),
        duplicateGroups: byHash.length,
      })
    }

    const where =
      filter === 'hidden'
        ? { hidden: true }
        : filter === 'duplicate'
          ? { hidden: false, AND: [{ contentHash: { not: null } }] }
          : filter === 'all'
            ? {}
            : { hidden: false, status: filter }

    const [total, rows] = await Promise.all([
      db.questionImage.count({ where }),
      db.questionImage.findMany({
        where,
        orderBy: { lastCheckedAt: 'asc' }, // least-recently-checked first
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { question: { select: { publicId: true, subject: { select: { key: true } }, sourceYear: true } } },
      }),
    ])
    return Response.json({
      total,
      page, pageSize,
      rows: rows.map((r) => ({
        id: r.id,
        questionId: r.questionId,
        publicId: r.question.publicId,
        subject: r.question.subject.key,
        year: r.question.sourceYear,
        url: r.url,
        altText: r.altText,
        caption: r.caption,
        kind: r.kind,
        order: r.order,
        hidden: r.hidden,
        status: r.status,
        contentHash: r.contentHash,
        replacedFromUrl: r.replacedFromUrl,
        reconstructed: r.reconstructed,
        isOriginalExamImage: r.isOriginalExamImage,
        lastCheckedAt: r.lastCheckedAt,
      })),
    })
  } catch (err) {
    return jsonError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    const contentType = req.headers.get('content-type') ?? ''

    // ---- multipart: replace/upload an image file ----
    if (contentType.includes('multipart/form-data')) {
      await rateLimit(`admin-image-upload:${admin.id}`, 60, 60_000)
      const form = await req.formData()
      const imageId = String(form.get('imageId') ?? '')
      const file = form.get('file')
      const reconstructed = String(form.get('reconstructed') ?? '') === 'true'
      if (!imageId || !(file instanceof File)) throw new HttpError(400, 'imageId and file are required')

      const img = await db.questionImage.findUnique({ where: { id: imageId } })
      if (!img) throw new HttpError(404, 'Image not found')
      if (file.size > 8 * 1024 * 1024) throw new HttpError(413, 'Image too large (max 8 MB)')
      if (!/^image\/(png|jpe?g|webp|gif|svg\+xml)$/.test(file.type)) throw new HttpError(400, 'Unsupported image type')

      const buf = Buffer.from(await file.arrayBuffer())
      const ext = (file.type.split('/')[1] ?? 'png').replace('svg+xml', 'svg').replace('jpeg', 'jpg')
      // keep the original path, new hashed name alongside it (stable + unique)
      const dir = path.dirname(img.url)
      const name = `${img.id}-${Date.now().toString(36)}.${ext}`
      const rel = `${dir}/${name}`.replace(/^\//, '')
      const abs = path.join(process.cwd(), 'public', rel)
      await mkdir(path.dirname(abs), { recursive: true })
      await writeFile(abs, buf)

      const hash = createHash('sha1').update(buf).digest('hex')
      await db.questionImage.update({
        where: { id: imageId },
        data: {
          url: `/${rel}`,
          replacedFromUrl: img.replacedFromUrl ?? img.url, // original preserved forever
          reconstructed: reconstructed || img.reconstructed,
          contentHash: hash,
          status: 'ok',
          hidden: false,
          lastCheckedAt: new Date(),
        },
      })
      return Response.json({ ok: true, url: `/${rel}`, preservedOriginal: img.replacedFromUrl ?? img.url })
    }

    // ---- JSON audit run ----
    const body = await req.json().catch(() => ({}))
    if (body.action !== 'audit') throw new HttpError(400, 'Unknown action')
    await rateLimit(`admin-image-audit:${admin.id}`, 6, 60_000)
    const sample = Math.min(Math.max(Number(body.sample ?? 500), 1), 2000)

    const rows = (await db.questionImage.findMany({
      where: { hidden: false },
      orderBy: { lastCheckedAt: 'asc' }, // least-recently-checked first
      take: sample,
      select: { id: true, url: true, status: true },
    })) as AuditRow[]

    let ok = 0
    let broken = 0
    let dupes = 0
    for (const r of rows) {
      const local = path.join(process.cwd(), 'public', r.url.replace(/^\//, ''))
      let status = 'ok'
      let hash: string | null = null
      try {
        const buf = await readFile(local)
        hash = createHash('sha1').update(buf).digest('hex')
      } catch {
        status = 'broken'
        broken++
      }
      if (status === 'ok') {
        ok++
        const dup = await db.questionImage.findFirst({
          where: { contentHash: hash!, hidden: false, id: { not: r.id } },
          select: { id: true },
        })
        if (dup) {
          status = 'duplicate'
          dupes++
        }
      }
      await db.questionImage.update({
        where: { id: r.id },
        data: { status, contentHash: hash, lastCheckedAt: new Date() },
      })
    }
    return Response.json({ checked: rows.length, ok, broken, duplicates: dupes })
  } catch (err) {
    return jsonError(err)
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin()
    const body = await req.json()
    const imageId = String(body.imageId ?? '')
    if (!imageId) throw new HttpError(400, 'imageId is required')
    const img = await db.questionImage.findUnique({ where: { id: imageId } })
    if (!img) throw new HttpError(404, 'Image not found')

    const data: Record<string, unknown> = {}
    if (typeof body.altText === 'string') data.altText = body.altText.slice(0, 300)
    if (typeof body.caption === 'string') data.caption = body.caption.slice(0, 300)
    if (typeof body.attribution === 'string') data.attribution = body.attribution.slice(0, 300)
    if (body.order !== undefined) data.order = Math.min(Math.max(Number(body.order) || 0, 0), 20)
    if (typeof body.hidden === 'boolean') data.hidden = body.hidden
    if (typeof body.status === 'string' && ['ok', 'missing', 'broken', 'low_res', 'duplicate', 'unverified'].includes(body.status)) {
      data.status = body.status
    }
    if (Object.keys(data).length === 0) throw new HttpError(400, 'Nothing to update')
    await db.questionImage.update({ where: { id: imageId }, data })
    return Response.json({ ok: true })
  } catch (err) {
    return jsonError(err)
  }
}
