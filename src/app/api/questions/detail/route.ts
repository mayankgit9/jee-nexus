import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, jsonError, HttpError } from '@/lib/auth'
import { toPublicQuestion } from '@/lib/questions'

/** Question detail by publicId or internal id (no answers leaked) */
export async function GET(req: NextRequest) {
  try {
    const publicId = req.nextUrl.searchParams.get('publicId')
    const id = req.nextUrl.searchParams.get('id')
    if (!publicId && !id) throw new HttpError(400, 'publicId is required')

    const user = await getSessionUser()
    const question = await db.question.findUnique({
      where: publicId ? { publicId } : { id: id! },
      include: {
        subject: true,
        chapter: true,
        options: true,
        images: { where: { hidden: false } },
        ...(user ? { bookmarks: { where: { userId: user.id }, select: { id: true } } } : {}),
      },
    })
    if (!question || question.verificationStatus === 'rejected') {
      throw new HttpError(404, 'Question not found')
    }
    return Response.json({ question: toPublicQuestion(question) })
  } catch (err) {
    return jsonError(err)
  }
}
