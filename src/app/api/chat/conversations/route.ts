import { NextRequest } from 'next/server'
import { dbClient } from '@/lib/db'
import { requireUser, jsonError, HttpError, rateLimit } from '@/lib/auth'
import { CHAT_LIMITS, toClientMember } from '@/lib/chat'

/**
 * GET /api/chat/conversations — the caller's conversation list.
 * Sidebar shape in two queries: memberships with nested members + last
 * message (one findMany), then one grouped unread-count query.
 */
export async function GET() {
  try {
    const user = await requireUser()
    const client = dbClient()

    const memberships = await client.chatMember.findMany({
      where: { userId: user.id },
      orderBy: { conversation: { updatedAt: 'desc' } },
      take: CHAT_LIMITS.conversationsTake,
      include: {
        conversation: {
          include: {
            members: {
              select: {
                userId: true,
                role: true,
                user: { select: { id: true, name: true, email: true, lastSeenAt: true } },
              },
              orderBy: { joinedAt: 'asc' },
            },
            messages: {
              take: 1,
              orderBy: { createdAt: 'desc' },
              select: { body: true, createdAt: true, senderId: true, sender: { select: { id: true, name: true } } },
            },
          },
        },
      },
    })

    // One grouped query for ALL unread counts (JOIN on my membership row per
    // conversation: messages newer than my lastReadAt, not sent by me).
    const ids = memberships.map((m) => m.conversationId)
    const unreadMap = new Map<string, number>()
    if (ids.length > 0) {
      const placeholders = ids.map((_, i) => `$${i + 2}`).join(', ')
      const rows = (await client.$queryRawUnsafe(
        `select cm.conversation_id as cid, count(*)::int as n
           from chat_messages m
           join chat_members cm
             on cm.conversation_id = m.conversation_id and cm.user_id = $1
          where m.conversation_id in (${placeholders})
            and m.sender_id <> $1
            and (cm.last_read_at is null or m.created_at > cm.last_read_at)
          group by cm.conversation_id`,
        user.id,
        ...ids
      )) as { cid: string; n: number }[]
      for (const r of rows) unreadMap.set(r.cid, r.n)
    }

    return Response.json({
      conversations: memberships.map((m) => {
        const conv = m.conversation
        const last = conv.messages[0] ?? null
        return {
          id: conv.id,
          type: conv.type,
          name: conv.name,
          updatedAt: conv.updatedAt,
          myRole: m.role,
          members: conv.members.map(toClientMember),
          lastMessage: last
            ? { body: last.body, createdAt: last.createdAt, senderId: last.senderId, senderName: last.sender?.name ?? 'Student' }
            : null,
          unread: unreadMap.get(conv.id) ?? 0,
        }
      }),
    })
  } catch (err) {
    return jsonError(err)
  }
}

/**
 * POST /api/chat/conversations
 *  { type: 'dm', userId }                 → find-or-create a DM (idempotent)
 *  { type: 'group', name, memberIds[] }   → create a study group
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    const client = dbClient()
    await rateLimit(`chat-create:${user.id}`, 20, 60 * 60 * 1000, client)
    const payload = (await req.json().catch(() => ({}))) as {
      type?: string
      userId?: string
      name?: string
      memberIds?: unknown
    }

    if (payload.type === 'dm') {
      const targetId = String(payload.userId ?? '')
      if (!targetId) throw new HttpError(400, 'userId is required')
      if (targetId === user.id) throw new HttpError(400, 'You cannot DM yourself')
      const target = await client.user.findUnique({ where: { id: targetId }, select: { id: true } })
      if (!target) throw new HttpError(404, 'User not found')

      const existing = await client.chatConversation.findFirst({
        where: {
          type: 'dm',
          AND: [{ members: { some: { userId: user.id } } }, { members: { some: { userId: targetId } } }],
        },
        include: { members: { select: { userId: true } } },
      })
      if (existing && existing.members.length === 2) {
        return Response.json({ conversationId: existing.id, existing: true })
      }

      const conv = await client.chatConversation.create({
        data: {
          type: 'dm',
          members: {
            create: [
              { userId: user.id, role: 'member' },
              { userId: targetId, role: 'member' },
            ],
          },
        },
      })
      return Response.json({ conversationId: conv.id, existing: false })
    }

    if (payload.type === 'group') {
      const name = String(payload.name ?? '').trim()
      if (name.length < CHAT_LIMITS.groupNameMin || name.length > CHAT_LIMITS.groupNameMax) {
        throw new HttpError(400, `Group name must be 1-${CHAT_LIMITS.groupNameMax} characters`)
      }
      const memberIds = Array.from(
        new Set((Array.isArray(payload.memberIds) ? payload.memberIds : []).map((x) => String(x)))
      ).filter((id) => id !== user.id)
      if (memberIds.length < 1) throw new HttpError(400, 'Add at least one member')
      if (memberIds.length > CHAT_LIMITS.inviteesMax) {
        throw new HttpError(400, `At most ${CHAT_LIMITS.inviteesMax} members can be added at once`)
      }
      const found = await client.user.findMany({ where: { id: { in: memberIds } }, select: { id: true } })
      if (found.length !== memberIds.length) throw new HttpError(400, 'Some selected users were not found')

      const conv = await client.chatConversation.create({
        data: {
          type: 'group',
          name,
          createdById: user.id,
          members: {
            create: [
              { userId: user.id, role: 'admin' },
              ...memberIds.map((id) => ({ userId: id, role: 'member' })),
            ],
          },
        },
      })
      return Response.json({ conversationId: conv.id })
    }

    throw new HttpError(400, 'type must be "dm" or "group"')
  } catch (err) {
    return jsonError(err)
  }
}
