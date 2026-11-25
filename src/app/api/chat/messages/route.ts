import { NextRequest } from 'next/server'
import { dbClient } from '@/lib/db'
import { requireUser, jsonError, HttpError, rateLimit } from '@/lib/auth'
import { CHAT_LIMITS, requireMembership, sanitizeMessageBody, toClientMember, toClientMessage } from '@/lib/chat'

/** grouped reaction chips: [{ emoji, count, mine }] per message id */
function aggregateReactions(
  rows: { messageId: string; emoji: string; userId: string }[],
  meId: string
): Record<string, { emoji: string; count: number; mine: boolean }[]> {
  const out: Record<string, { emoji: string; count: number; mine: boolean }[]> = {}
  const order: string[] = []
  for (const r of rows) {
    if (!out[r.messageId]) {
      out[r.messageId] = []
      order.push(r.messageId)
    }
    const entry = out[r.messageId].find((x) => x.emoji === r.emoji)
    if (entry) {
      entry.count += 1
      if (r.userId === meId) entry.mine = true
    } else {
      out[r.messageId].push({ emoji: r.emoji, count: 1, mine: r.userId === meId })
    }
  }
  for (const id of order) out[id].sort((a, b) => b.count - a.count)
  return out
}

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

    const fetchMessages = async (): Promise<{
      messages: {
        id: string
        body: string
        createdAt: Date
        senderId: string
        sender: { id: string; name: string | null } | null
      }[]
      hasMore: boolean
    }> => {
      if (after) {
        const rows = await client.chatMessage.findMany({
          where: { conversationId, createdAt: { gt: after } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: limit + 1,
          include: { sender: { select: { id: true, name: true } } },
        })
        const more = rows.length > limit
        return { messages: more ? rows.slice(0, limit) : rows, hasMore: more }
      }
      if (before) {
        const page = await client.chatMessage.findMany({
          where: { conversationId, createdAt: { lt: before } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: limit + 1,
          include: { sender: { select: { id: true, name: true } } },
        })
        const more = page.length > limit
        return { messages: (more ? page.slice(0, limit) : page).reverse(), hasMore: more }
      }
      const page = await client.chatMessage.findMany({
        where: { conversationId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: { sender: { select: { id: true, name: true } } },
      })
      const more = page.length > limit
      return { messages: (more ? page.slice(0, limit) : page).reverse(), hasMore: more }
    }

    // typing + presence ride along on every poll (one batched round trip
    // with the message query keeps the 3s poll at two subrequests total)
    const typingCutoff = new Date(Date.now() - 6_000)
    const [page, typingRows] = await Promise.all([
      fetchMessages(),
      client.chatTyping.findMany({
        where: {
          conversationId,
          userId: { not: user.id },
          updatedAt: { gt: typingCutoff },
        },
        include: { user: { select: { name: true } } },
      }),
    ])
    if (Math.random() < 0.02) {
      await client
        .$executeRaw`delete from chat_typing where updated_at < now() - interval '1 hour'`
        .catch(() => {})
    }
    const { messages, hasMore } = page

    // reactions for this page (single IN query over the page's message ids)
    let reactions: Record<string, { emoji: string; count: number; mine: boolean }[]> = {}
    if (messages.length > 0) {
      const rows = (await client.$queryRawUnsafe(
        `select message_id, emoji, user_id from chat_reactions where message_id = any($1::text[])`,
        messages.map((m) => m.id)
      )) as { message_id: string; emoji: string; user_id: string }[]
      reactions = aggregateReactions(
        rows.map((r) => ({ messageId: r.message_id, emoji: r.emoji, userId: r.user_id })),
        user.id
      )
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
      typing: typingRows.map((t) => ({ userId: t.userId, name: t.user.name ?? 'Student' })),
      reactions,
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
