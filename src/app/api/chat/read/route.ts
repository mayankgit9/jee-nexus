import { NextRequest } from 'next/server'
import { dbClient } from '@/lib/db'
import { requireUser, jsonError, HttpError, rateLimit } from '@/lib/auth'
import { requireMembership } from '@/lib/chat'

/** POST /api/chat/read { conversationId } — mark the conversation as read. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    const client = dbClient()
    await rateLimit(`chat-read:${user.id}`, 60, 60 * 1000, client)
    const payload = (await req.json().catch(() => ({}))) as { conversationId?: string }
    const conversationId = String(payload.conversationId ?? '')
    if (!conversationId) throw new HttpError(400, 'conversationId is required')

    await requireMembership(client, conversationId, user.id)
    await client.chatMember.update({
      where: { conversationId_userId: { conversationId, userId: user.id } },
      data: { lastReadAt: new Date() },
    })
    // stamp any pending @mentions in this conversation as read — keeps the
    // mention state coherent with lastReadAt for toasts and future badges
    await client
      .$executeRaw`update chat_mentions set read_at = now()
         where user_id = ${user.id} and read_at is null
           and message_id in (select id from chat_messages where conversation_id = ${conversationId})`
      .catch(() => {})
    return Response.json({ ok: true })
  } catch (err) {
    return jsonError(err)
  }
}
