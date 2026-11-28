import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, requireUser, jsonError, HttpError, rateLimit } from '@/lib/auth'
import { Prisma } from '@prisma/client'

/**
 * Formula Cards (Part G, migration 0019).
 *
 * GET /api/formulas — published cards with subject/chapter/topic/search
 *      filters + the calling student's progress (favorite/learned/notes).
 * POST /api/formulas — progress actions:
 *      { cardId, action: 'favorite'|'unfavorite'|'learned'|'unlearned'|'note'|'quiz', note?, correct? }
 *
 * Only status='published' cards are served to students — unverified
 * formulas/reactions never auto-publish (content enters via the admin
 * import pipeline in review state first).
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser()
    const sp = req.nextUrl.searchParams
    const subject = sp.get('subject')
    const chapter = sp.get('chapter')
    const search = sp.get('search')?.trim()
    const favoritesOnly = sp.get('favorites') === '1'
    const unlearnedOnly = sp.get('unlearned') === '1'

    const where: Prisma.FormulaCardWhereInput = { status: 'published' }
    if (subject && subject !== 'all') where.subjectKey = subject
    if (chapter && chapter !== 'all') where.chapterKey = chapter
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { formula: { contains: search, mode: 'insensitive' } },
        { topic: { contains: search, mode: 'insensitive' } },
        { explanation: { contains: search, mode: 'insensitive' } },
      ]
    }

    if (favoritesOnly) {
      if (!user) return Response.json({ cards: [], cardsRestricted: true, message: 'Sign in to use favourites' })
      where.progress = { some: { userId: user.id, favorite: true } }
    }

    const [cards, progress] = await Promise.all([
      db.formulaCard.findMany({
        where,
        orderBy: [{ subjectKey: 'asc' }, { chapterKey: 'asc' }, { createdAt: 'asc' }],
        take: 1000,
      }),
      user
        ? db.formulaProgress.findMany({ where: { userId: user.id }, select: { cardId: true, favorite: true, learned: true, personalNote: true, quizSeen: true, quizCorrect: true } })
        : Promise.resolve([] as { cardId: string; favorite: boolean; learned: boolean; personalNote: string | null; quizSeen: number; quizCorrect: number }[]),
    ])

    const pById = new Map(progress.map((p) => [p.cardId, p]))

    let out = cards.map((c) => ({
      id: c.id,
      subject: c.subjectKey,
      chapterKey: c.chapterKey,
      topic: c.topic ?? undefined,
      title: c.title,
      formula: c.formula,
      explanation: c.explanation ?? undefined,
      conditions: c.conditions ?? undefined,
      units: c.units ?? undefined,
      tags: Array.isArray(c.tags) ? (c.tags as string[]) : [],
      favorite: pById.get(c.id)?.favorite ?? false,
      learned: pById.get(c.id)?.learned ?? false,
      personalNote: pById.get(c.id)?.personalNote ?? undefined,
      quizSeen: pById.get(c.id)?.quizSeen ?? 0,
      quizCorrect: pById.get(c.id)?.quizCorrect ?? 0,
    }))
    if (unlearnedOnly) out = out.filter((c) => !c.learned)

    return Response.json({ cards: out })
  } catch (err) {
    return jsonError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    await rateLimit(`formulas-progress:${user.id}`, 120, 60_000)
    const body = await req.json()
    const cardId = String(body.cardId ?? '')
    const action = String(body.action ?? '')
    if (!cardId || !['favorite', 'unfavorite', 'learned', 'unlearned', 'note', 'quiz'].includes(action)) {
      throw new HttpError(400, 'cardId and a valid action are required')
    }
    const card = await db.formulaCard.findUnique({ where: { id: cardId }, select: { id: true } })
    if (!card) throw new HttpError(404, 'Card not found')

    const data: Prisma.FormulaProgressUpdateInput = { updatedAt: new Date(), lastSeenAt: new Date() }
    if (action === 'favorite') data.favorite = true
    if (action === 'unfavorite') data.favorite = false
    if (action === 'learned') data.learned = true
    if (action === 'unlearned') data.learned = false
    if (action === 'note') data.personalNote = String(body.note ?? '').slice(0, 2000)
    if (action === 'quiz') {
      data.quizSeen = { increment: 1 }
      if (body.correct === true) data.quizCorrect = { increment: 1 }
    }

    await db.formulaProgress.upsert({
      where: { userId_cardId: { userId: user.id, cardId } },
      update: data,
      create: {
        userId: user.id,
        cardId,
        ...(action === 'favorite' ? { favorite: true } : {}),
        ...(action === 'learned' ? { learned: true } : {}),
        ...(action === 'note' ? { personalNote: String(body.note ?? '').slice(0, 2000) } : {}),
        ...(action === 'quiz' ? { quizSeen: 1, quizCorrect: body.correct === true ? 1 : 0 } : {}),
        lastSeenAt: new Date(),
      },
    })
    return Response.json({ ok: true })
  } catch (err) {
    return jsonError(err)
  }
}
