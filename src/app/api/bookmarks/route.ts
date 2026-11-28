import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, jsonError, HttpError } from '@/lib/auth'
import { toPublicQuestion } from '@/lib/questions'

/** List bookmarks (with question data) */
export async function GET() {
  try {
    const user = await requireUser()
    const bookmarks = await db.bookmark.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        question: {
          include: { subject: true, chapter: true, options: true, images: { where: { hidden: false } } },
        },
      },
      take: 200,
    })
    return Response.json({
      bookmarks: bookmarks.map((b) => ({
        id: b.id,
        createdAt: b.createdAt,
        question: toPublicQuestion({ ...b.question, bookmarks: [] }),
      })),
    })
  } catch (err) {
    return jsonError(err)
  }
}

/** Toggle bookmark for a question */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    const { questionId } = await req.json()
    if (!questionId) throw new HttpError(400, 'questionId is required')

    const question = await db.question.findUnique({ where: { id: String(questionId) } })
    if (!question) throw new HttpError(404, 'Question not found')

    const existing = await db.bookmark.findUnique({
      where: { userId_questionId: { userId: user.id, questionId: String(questionId) } },
    })
    if (existing) {
      await db.bookmark.delete({ where: { id: existing.id } })
      return Response.json({ bookmarked: false })
    }
    await db.bookmark.create({ data: { userId: user.id, questionId: String(questionId) } })
    return Response.json({ bookmarked: true })
  } catch (err) {
    return jsonError(err)
  }
}
