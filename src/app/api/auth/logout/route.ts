import { destroySession, jsonError } from '@/lib/auth'

export async function POST() {
  try {
    await destroySession()
    return Response.json({ ok: true })
  } catch (err) {
    return jsonError(err)
  }
}
