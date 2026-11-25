import { NextRequest } from 'next/server'
import { dbClient } from '@/lib/db'
import { requireUser, jsonError, HttpError } from '@/lib/auth'
import { requireMembership } from '@/lib/chat'

/**
 * POST /api/chat/leave { conversationId }
 *   group → remove my membership (delete the conversation when the last
 *           member leaves)
 *   dm    → delete the conversation entirely (messages go for both sides —
 *           the UI says so explicitly before confirming)
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    const client = dbClient()
    const payload = (await req.json().catch(() => ({}))) as { conversationId?: string }
    const conversationId = String(payload.conversationId ?? '')
    if (!conversationId) throw new HttpError(400, 'conversationId is required')

    const { conversation } = await requireMembership(client, conversationId, user.id)

    if (conversation.type === 'dm') {
      await client.chatConversation.delete({ where: { id: conversationId } })
      return Response.json({ ok: true, deleted: true })
    }

    await client.chatMember.delete({
      where: { conversationId_userId: { conversationId, userId: user.id } },
    })
    const remaining = await client.chatMember.count({ where: { conversationId } })
    if (remaining === 0) {
      await client.chatConversation.delete({ where: { id: conversationId } })
    }
    return Response.json({ ok: true, left: true })
  } catch (err) {
    return jsonError(err)
  }
}
