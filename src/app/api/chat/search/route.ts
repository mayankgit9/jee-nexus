import { NextRequest } from 'next/server'
import { dbClient } from '@/lib/db'
import { requireUser, jsonError, HttpError, rateLimit } from '@/lib/auth'

/**
 * GET /api/chat/search?q=...
 * Case-insensitive substring search across every conversation the caller
 * belongs to — DMs and groups alike. Membership is enforced by scoping the
 * query to the caller's conversation ids (server-side; never trusts the
 * client). Returns the most recent 30 matches, newest first, with enough
 * conversation metadata for the client to label DMs/groups.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser()
    const client = dbClient()
    await rateLimit(`chat-search:${user.id}`, 60, 60 * 1000, client)

    const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
    if (q.length < 2) throw new HttpError(400, 'Enter at least 2 characters to search')

    const memberships = await client.chatMember.findMany({
      where: { userId: user.id },
      select: { conversationId: true },
    })
    const conversationIds = memberships.map((m) => m.conversationId)
    if (conversationIds.length === 0) return Response.json({ results: [] })

    const messages = await client.chatMessage.findMany({
      where: {
        conversationId: { in: conversationIds },
        body: { contains: q, mode: 'insensitive' },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 30,
      include: {
        sender: { select: { id: true, name: true } },
        conversation: {
          select: {
            id: true,
            type: true,
            name: true,
            members: { select: { userId: true, user: { select: { id: true, name: true } } } },
          },
        },
      },
    })

    return Response.json({
      results: messages.map((m) => {
        const other = m.conversation.type === 'dm'
          ? m.conversation.members.find((mem) => mem.userId !== user.id)?.user ?? null
          : null
        return {
          id: m.id,
          body: m.body,
          createdAt: m.createdAt,
          senderId: m.senderId,
          senderName: m.sender?.name ?? 'Student',
          conversation: {
            id: m.conversation.id,
            type: m.conversation.type,
            name: m.conversation.name,
            // for DMs the useful label is the other member's name
            otherName: other?.name ?? null,
          },
        }
      }),
    })
  } catch (err) {
    return jsonError(err)
  }
}
