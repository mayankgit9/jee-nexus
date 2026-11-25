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
    // 30/min: admin-gated bulk import. 10/min was calibrated when inserts
    // dominated chunk time (~70s/chunk); the idempotent re-run path skips
    // duplicates in ~2-4s/chunk and burst-hammered the limiter (run
    // 45596846827 died at chunk 21 with 429s). 30 covers the fastest
    // legitimate chunk rate with headroom; login/signup limits stay strict.
    rateLimit(`import:${admin.id}`, 30, 60_000)
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
