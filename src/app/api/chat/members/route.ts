import { NextRequest } from 'next/server'
import { dbClient } from '@/lib/db'
import { requireUser, jsonError, HttpError, rateLimit } from '@/lib/auth'
import { CHAT_LIMITS, requireMembership } from '@/lib/chat'

/**
 * POST /api/chat/members { conversationId, userIds[] } — add members to a
 * group (any current member can invite; study groups are casual). Bumps the
 * conversation's updatedAt so it surfaces in everyone's sidebar.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    await rateLimit(`chat-invite:${user.id}`, 20, 60 * 60 * 1000)
    const client = dbClient()
    const payload = (await req.json().catch(() => ({}))) as { conversationId?: string; userIds?: unknown }
    const conversationId = String(payload.conversationId ?? '')
    if (!conversationId) throw new HttpError(400, 'conversationId is required')

    const { conversation } = await requireMembership(client, conversationId, user.id)
    if (conversation.type !== 'group') throw new HttpError(400, 'Members can only be added to group chats')

    const currentIds = new Set(conversation.members.map((m) => m.userId))
    const userIds = Array.from(
      new Set((Array.isArray(payload.userIds) ? payload.userIds : []).map((x) => String(x)))
    ).filter((id) => id && !currentIds.has(id))
    if (userIds.length === 0) throw new HttpError(400, 'Nothing to add — everyone selected is already a member')
    if (conversation.members.length + userIds.length > CHAT_LIMITS.membersMax) {
      throw new HttpError(400, `Groups are capped at ${CHAT_LIMITS.membersMax} members`)
    }

    const found = await client.user.findMany({ where: { id: { in: userIds } }, select: { id: true } })
    if (found.length !== userIds.length) throw new HttpError(400, 'Some selected users were not found')

    await client.chatMember.createMany({
      data: userIds.map((id) => ({ conversationId, userId: id, role: 'member' })),
      skipDuplicates: true,
    })
    await client.chatConversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    })
    return Response.json({ added: userIds.length })
  } catch (err) {
    return jsonError(err)
  }
}
