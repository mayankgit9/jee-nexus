import { NextRequest } from 'next/server'
import { dbClient } from '@/lib/db'
import { requireUser, jsonError, HttpError, rateLimit } from '@/lib/auth'
import { CHAT_LIMITS, requireMembership, sanitizeMessageBody, toClientMember, toClientMessage } from '@/lib/chat'

/**
 * GET /api/chat/messages?conversationId=...[&after=ISO][&before=ISO][&limit=n]
 *   no cursor    → latest page (asc order, hasMore)
 *   after=ISO    → incremental poll: messages strictly newer (client dedups by id)
 *   before=ISO   → load-earlier pagination
 * Response embeds the conversation meta (members) so the header renders
 * without a second round-trip.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser()
    const client = dbClient()
    const conversationId = req.nextUrl.searchParams.get('conversationId') ?? ''
    if (!conversationId) throw new HttpError(400, 'conversationId is required')

    const { conversation, membership } = await requireMembership(client, conversationId, user.id)

    const parseIso = (v: string | null): Date | null => {
      if (!v) return null
      const d = new Date(v)
      return Number.isNaN(d.getTime()) ? null : d
    }
    const after = parseIso(req.nextUrl.searchParams.get('after'))
    const before = parseIso(req.nextUrl.searchParams.get('before'))
    const limitParam = req.nextUrl.searchParams.get('limit')
    const limit =
      limitParam !== null && Number.isFinite(Number(limitParam))
        ? Math.min(Math.max(Math.trunc(Number(limitParam)), 1), 100)
        : CHAT_LIMITS.messagesTake

    // fetch limit+1 to compute hasMore without a count query
    let messages: {
      id: string
      body: string
      createdAt: Date
      senderId: string
      sender: { id: string; name: string | null } | null
    }[]
    let hasMore = false

    if (after) {
      messages = await client.chatMessage.findMany({
        where: { conversationId, createdAt: { gt: after } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit + 1,
        include: { sender: { select: { id: true, name: true } } },
      })
      hasMore = messages.length > limit
      if (hasMore) messages = messages.slice(0, limit)
    } else if (before) {
      const page = await client.chatMessage.findMany({
        where: { conversationId, createdAt: { lt: before } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: { sender: { select: { id: true, name: true } } },
      })
      hasMore = page.length > limit
      messages = (hasMore ? page.slice(0, limit) : page).reverse()
    } else {
      const page = await client.chatMessage.findMany({
        where: { conversationId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: { sender: { select: { id: true, name: true } } },
      })
      hasMore = page.length > limit
      messages = (hasMore ? page.slice(0, limit) : page).reverse()
    }

    return Response.json({
      conversation: {
        id: conversation.id,
        type: conversation.type,
        name: conversation.name,
        myRole: membership.role,
        members: conversation.members.map(toClientMember),
      },
      messages: messages.map(toClientMessage),
      hasMore,
    })
  } catch (err) {
    return jsonError(err)
  }
}

/**
 * POST /api/chat/messages { conversationId, body } — send a message.
 * Bumps the conversation's updatedAt (sidebar ordering) and the sender's
 * lastReadAt (you have obviously read what you sent).
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    const client = dbClient()
    await rateLimit(`chat-msg:${user.id}`, 30, 60 * 1000, client)
    const payload = (await req.json().catch(() => ({}))) as { conversationId?: string; body?: string }
    const conversationId = String(payload.conversationId ?? '')
    if (!conversationId) throw new HttpError(400, 'conversationId is required')

    await requireMembership(client, conversationId, user.id)
    const body = sanitizeMessageBody(String(payload.body ?? ''))

    const message = await client.chatMessage.create({
      data: { conversationId, senderId: user.id, body },
      include: { sender: { select: { id: true, name: true } } },
    })
    await client.chatConversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    })
    await client.chatMember.update({
      where: { conversationId_userId: { conversationId, userId: user.id } },
      data: { lastReadAt: new Date() },
    })

    return Response.json({ message: toClientMessage(message) })
  } catch (err) {
    return jsonError(err)
  }
}
