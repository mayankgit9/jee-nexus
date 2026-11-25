import { NextRequest } from 'next/server'
import { dbClient } from '@/lib/db'
import { requireUser, jsonError, rateLimit } from '@/lib/auth'
import { requireMembership } from '@/lib/chat'

/**
 * POST /api/chat/typing { conversationId } — typing heartbeat.
 * The client pings this while the composer has text (max every 2.5s);
 * "currently typing" on the receiving side = row updated within 6s.
 * No DELETE is needed for correctness — stale rows are invisible by age and
 * removed by the opportunistic cleanup (5% of calls, 1h cutoff).
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    const client = dbClient()
    await rateLimit(`chat-typing:${user.id}`, 40, 60 * 1000, client)
    const payload = (await req.json().catch(() => ({}))) as { conversationId?: string }
    const conversationId = String(payload.conversationId ?? '')
    if (!conversationId) {
      return Response.json({ error: 'conversationId is required' }, { status: 400 })
    }
    await requireMembership(client, conversationId, user.id)

    await client.chatTyping.upsert({
      where: { conversationId_userId: { conversationId, userId: user.id } },
      create: { conversationId, userId: user.id },
      update: { updatedAt: new Date() },
    })
    if (Math.random() < 0.05) {
      await client
        .$executeRaw`delete from chat_typing where updated_at < now() - interval '1 hour'`
        .catch(() => {})
    }
    return Response.json({ ok: true })
  } catch (err) {
    return jsonError(err)
  }
}
