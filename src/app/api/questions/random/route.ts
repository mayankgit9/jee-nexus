import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/auth'
import { selectRandomQuestions } from '@/lib/questions'

/** Random practice selection with filters + repeat avoidance */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const user = await getSessionUser()

    const parseStrArray = (v: unknown): string[] | undefined =>
      Array.isArray(v) && v.length ? v.map(String) : undefined
    const parseNumArray = (v: unknown): number[] | undefined =>
      Array.isArray(v) && v.length ? v.map(Number).filter((n) => !isNaN(n)) : undefined

    const questions = await selectRandomQuestions({
      subject: body.subject ? String(body.subject) : undefined,
      chapterKeys: parseStrArray(body.chapterKeys),
      years: parseNumArray(body.years),
      difficulties: parseStrArray(body.difficulties),
      types: parseStrArray(body.types),
      count: body.count ? Number(body.count) : 1,
      excludeQuestionIds: parseStrArray(body.excludeQuestionIds),
      userId: user?.id,
      includeAttempted: body.includeAttempted === true,
    })

    if (questions.length === 0) {
      return Response.json(
        { questions: [], message: 'No questions match these filters. Try widening your selection.' },
        { status: 200 }
      )
    }
    return Response.json({ questions })
  } catch (err) {
    return jsonError(err)
  }
}
