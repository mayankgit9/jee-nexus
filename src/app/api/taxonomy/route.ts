import { db } from '@/lib/db'
import { jsonError } from '@/lib/auth'

/** Subjects + chapters with live question counts (taxonomy for filters & browsing) */
export async function GET() {
  try {
    const subjects = await db.subject.findMany({
      orderBy: { order: 'asc' },
      include: {
        chapters: {
          orderBy: { order: 'asc' },
          include: { _count: { select: { questions: true } } },
        },
        _count: { select: { questions: true } },
      },
    })
    return Response.json({
      subjects: subjects.map((s) => ({
        key: s.key,
        name: s.name,
        icon: s.icon,
        colorKey: s.colorKey,
        questionCount: s._count.questions,
        chapters: s.chapters.map((c) => ({
          key: c.key,
          name: c.name,
          unit: c.unit,
          questionCount: c._count.questions,
        })),
      })),
    })
  } catch (err) {
    return jsonError(err)
  }
}
