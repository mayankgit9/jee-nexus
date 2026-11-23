import { NextRequest } from 'next/server'
import { requireAdmin, jsonError, HttpError, rateLimit } from '@/lib/auth'
import { importQuestions, type ImportQuestionInput } from '@/lib/import'

/**
 * POST /api/admin/import — bulk import questions (JSON array body).
 * Accepts { questions: [...], fileName? } — validates, dedups, inserts as 'imported'.
 */
export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    rateLimit(`import:${admin.id}`, 10, 60_000)
    const body = await req.json()
    const questions = body.questions
    if (!Array.isArray(questions) || questions.length === 0) {
      throw new HttpError(400, 'Body must contain a non-empty "questions" array')
    }
    if (questions.length > 500) throw new HttpError(400, 'Max 500 questions per import batch')

    const result = await importQuestions(questions as ImportQuestionInput[], {
      adminId: admin.id,
      fileName: String(body.fileName ?? 'api-import.json'),
      sourceFormat: 'json',
    })
    return Response.json(result)
  } catch (err) {
    return jsonError(err)
  }
}
