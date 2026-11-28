import { NextRequest } from 'next/server'
import { dbClient } from '@/lib/db'
import { getSessionUser, requireUser, jsonError, HttpError, rateLimit, clientIp } from '@/lib/auth'
import {
  CHAT_LIMITS, LOBBY_CONVERSATION_ID, ensureLobbyMembership, requireMembership, sanitizeMessageBody,
  sanitizeGuestName, toClientMember, toClientMessage,
  hydrateReplies, attachReplies, parseMentions,
} from '@/lib/chat'

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

/** message row as fetched for the client — sender optional (guest posts) */
type MsgRow = {
  id: string
  body: string
  createdAt: Date
  senderId: string | null
  senderName: string | null
  replyToId: string | null
  deletedAt: Date | null
  sender: { id: string; name: string | null } | null
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
    // Lobby is readable by EVERYONE (even without an account); every other
    // conversation still requires a signed-in member.
    const user = await getSessionUser()
    const client = dbClient()
    const conversationId = req.nextUrl.searchParams.get('conversationId') ?? ''
    if (!conversationId) throw new HttpError(400, 'conversationId is required')

    let conversation
    let membership: { role: string; lastReadAt: Date | null } | null = null
    if (user) {
      const m = await requireMembership(client, conversationId, user.id)
      conversation = m.conversation
      membership = { role: String(m.membership.role), lastReadAt: m.membership.lastReadAt ?? null }
    } else {
      conversation = await client.chatConversation.findUnique({
        where: { id: conversationId },
        include: {
          members: {
            select: {
              userId: true,
              role: true,
              lastReadAt: true,
              user: { select: { id: true, name: true, email: true, lastSeenAt: true } },
            },
            orderBy: { joinedAt: 'asc' },
          },
        },
      })
      if (!conversation) throw new HttpError(404, 'Conversation not found')
      if (conversation.type !== 'lobby') throw new HttpError(401, 'Not authenticated')
    }

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
      messages: MsgRow[]
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
        return { messages: (more ? rows.slice(0, limit) : rows) as MsgRow[], hasMore: more }
      }
      if (before) {
        const page = await client.chatMessage.findMany({
          where: { conversationId, createdAt: { lt: before } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: limit + 1,
          include: { sender: { select: { id: true, name: true } } },
        })
        const more = page.length > limit
        return { messages: ((more ? page.slice(0, limit) : page).reverse()) as MsgRow[], hasMore: more }
      }
      const page = await client.chatMessage.findMany({
        where: { conversationId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: { sender: { select: { id: true, name: true } } },
      })
      const more = page.length > limit
      return { messages: ((more ? page.slice(0, limit) : page).reverse()) as MsgRow[], hasMore: more }
    }

    // typing + presence ride along on every poll (one batched round trip
    // with the message query keeps the 3s poll at two subrequests total).
    // Guests have no typing state (composer identity is ephemeral).
    const typingCutoff = new Date(Date.now() - 6_000)
    const [page, typingRows] = await Promise.all([
      fetchMessages(),
      user
        ? client.chatTyping.findMany({
            where: {
              conversationId,
              userId: { not: user.id },
              updatedAt: { gt: typingCutoff },
            },
            include: { user: { select: { name: true } } },
          })
        : Promise.resolve([]),
    ])
    if (Math.random() < 0.02) {
      await client
        .$executeRaw`delete from chat_typing where updated_at < now() - interval '1 hour'`
        .catch(() => {})
    }
    const { messages, hasMore } = page

    // reactions for this page — only for live (non-deleted) messages
    const liveIds = messages.filter((m) => !m.deletedAt).map((m) => m.id)
    let reactions: Record<string, { emoji: string; count: number; mine: boolean }[]> = {}
    if (liveIds.length > 0) {
      const rows = (await client.$queryRawUnsafe(
        `select message_id, emoji, user_id from chat_reactions where message_id = any($1::text[])`,
        liveIds
      )) as { message_id: string; emoji: string; user_id: string }[]
      reactions = aggregateReactions(
        rows.map((r) => ({ messageId: r.message_id, emoji: r.emoji, userId: r.user_id })),
        user?.id ?? ''
      )
    }

    // quoted context for replies (single query for the whole page)
    const replyMap = await hydrateReplies(client, messages)

    // poll overlay: ids of deleted messages so already-rendered bubbles can
    // become tombstones without a reload (bounded by the partial index)
    let deletedIds: string[] | undefined
    if (after) {
      const tombstones = await client.chatMessage.findMany({
        where: { conversationId, NOT: { deletedAt: null } },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
      deletedIds = tombstones.map((t) => t.id)
    }

    return Response.json({
      conversation: {
        id: conversation.id,
        type: conversation.type,
        name: conversation.name,
        myRole: membership?.role ?? 'guest',
        members: conversation.members.map(toClientMember),
      },
      messages: attachReplies(messages.map(toClientMessage), replyMap),
      hasMore,
      typing: typingRows.map((t) => ({ userId: t.userId, name: t.user.name ?? 'Student' })),
      reactions,
      deletedIds,
    })
  } catch (err) {
    return jsonError(err)
  }
}

/**
 * POST /api/chat/messages { conversationId, body, replyToId?, guestName? } —
 * send a message, optionally as a quoted reply.
 *
 * LOBBY + GUESTS (2026-11-28): the lobby is open to everyone. Signed-out
 * visitors post with an ephemeral display name (guestName, 2-24 chars) —
 * sender_id NULL, name snapshot in sender_name, IP rate-limited (5/min).
 * Signed-in members keep the full experience: receipts, reactions, mentions,
 * replies, 30/min limit. Other conversation types still require membership.
 */
export async function POST(req: NextRequest) {
  try {
    const client = dbClient()
    const user = await getSessionUser()
    const payload = (await req.json().catch(() => ({}))) as {
      conversationId?: string
      body?: string
      replyToId?: string
      guestName?: string
    }
    const conversationId = String(payload.conversationId ?? '')
    if (!conversationId) throw new HttpError(400, 'conversationId is required')
    const body = sanitizeMessageBody(String(payload.body ?? ''))

    // ---------- guest path (lobby only) ----------
    if (!user) {
      const conversation = await client.chatConversation.findUnique({
        where: { id: conversationId },
        select: { id: true, type: true },
      })
      if (!conversation) throw new HttpError(404, 'Conversation not found')
      if (conversation.type !== 'lobby') throw new HttpError(401, 'Sign in to post outside the lobby')
      const ip = clientIp(req)
      await rateLimit(`chat-lobby:${ip}`, 5, 60_000, client)
      const guestName = sanitizeGuestName(String(payload.guestName ?? 'Guest'))
      const message = await client.chatMessage.create({
        data: { conversationId, senderId: null, senderName: guestName, body },
        include: { sender: { select: { id: true, name: true } } },
      })
      await client.chatConversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      })
      const mapped = attachReplies([toClientMessage(message)], new Map())
      return Response.json({ message: mapped[0], mentions: 0 })
    }

    // ---------- member path ----------
    await rateLimit(`chat-msg:${user.id}`, 30, 60 * 1000, client)
    if (conversationId === LOBBY_CONVERSATION_ID) {
      // invisible auto-join: lobby needs no "Join" button
      await ensureLobbyMembership(client, user.id)
    }
    const { conversation } = await requireMembership(client, conversationId, user.id)

    // optional reply target: must exist AND belong to the same conversation
    let replyToId: string | null = null
    const rawReplyTo = String(payload.replyToId ?? '').trim()
    if (rawReplyTo) {
      const target = await client.chatMessage.findUnique({
        where: { id: rawReplyTo },
        select: { id: true, conversationId: true },
      })
      if (!target || target.conversationId !== conversationId) {
        throw new HttpError(400, 'replyToId must reference a message in this conversation')
      }
      replyToId = target.id
    }

    const message = await client.chatMessage.create({
      data: {
        conversationId,
        senderId: user.id,
        senderName: user.name ?? user.username,
        body,
        replyToId,
      },
      include: { sender: { select: { id: true, name: true } } },
    })
    await client.chatConversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    })
    await client.chatMember.updateMany({
      where: { conversationId, userId: user.id },
      data: { lastReadAt: new Date() },
    })

    // @mentions: resolve "@<display name>" against the conversation's members
    // and store one notification row per mentioned member (sender never
    // mentions themselves; parseMentions caps at 10). DMs don't mention —
    // the toast already names the sender there.
    let mentionCount = 0
    if (conversation.type === 'group' || conversation.type === 'lobby') {
      const rows = await client.chatMember.findMany({
        where: { conversationId },
        select: { userId: true, user: { select: { name: true } } },
      })
      const ids = parseMentions(
        body,
        rows.map((r) => ({ id: r.userId, name: r.user.name })),
        user.id
      )
      if (ids.length > 0) {
        await client.chatMention.createMany({
          data: ids.map((userId) => ({ messageId: message.id, userId })),
        })
        mentionCount = ids.length
      }
    }

    // hydrate the reply context so the sender's optimistic append renders the quote
    const replyMap = await hydrateReplies(client, [message])
    const mapped = attachReplies([toClientMessage(message)], replyMap)
    return Response.json({ message: mapped[0], mentions: mentionCount })
  } catch (err) {
    return jsonError(err)
  }
}

/**
 * DELETE /api/chat/messages { messageId } — soft-delete the caller's OWN
 * message. The row keeps its body for audit but every read path blanks it
 * afterwards; reactions on the tombstone are dropped and rejected.
 */
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser()
    const client = dbClient()
    await rateLimit(`chat-del:${user.id}`, 30, 60 * 1000, client)
    const payload = (await req.json().catch(() => ({}))) as { messageId?: string }
    const messageId = String(payload.messageId ?? '')
    if (!messageId) throw new HttpError(400, 'messageId is required')

    const message = await client.chatMessage.findUnique({
      where: { id: messageId },
      select: { id: true, conversationId: true, senderId: true, deletedAt: true },
    })
    if (!message) throw new HttpError(404, 'Message not found')
    // membership guard doubles as a 404 shield for foreign conversations
    await requireMembership(client, message.conversationId, user.id)
    if (message.senderId !== user.id) throw new HttpError(403, 'You can only delete your own messages')
    if (message.deletedAt) return Response.json({ deleted: true, already: true })

    await client.chatMessage.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
    })
    await client.chatReaction.deleteMany({ where: { messageId } }).catch(() => {})

    return Response.json({ deleted: true })
  } catch (err) {
    return jsonError(err)
  }
}
