import { NextRequest } from 'next/server'
import { dbClient } from '@/lib/db'
import { requireUser, jsonError, rateLimit, HttpError } from '@/lib/auth'
import { requireMembership } from '@/lib/chat'

/** every code point must be emoji-territory: emoji blocks, variation
 *  selectors, ZWJ, skin-tone modifiers, keycaps — plain text can't sneak in */
const EMOJI_CODE_POINT =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}\u{20E3}\u{2122}\u{2139}]/u

function isEmojiOnly(emoji: string): boolean {
  const cps = Array.from(emoji)
  if (cps.length < 1 || cps.length > 3 || emoji.length > 16) return false
  return cps.every((cp) => EMOJI_CODE_POINT.test(cp))
}

/**
 * POST /api/chat/reactions { messageId, emoji } — toggle a reaction.
 * Insert-on-missing / delete-on-present on the (message, user, emoji) key,
 * so repeated calls can never inflate a count. Responds with the message's
 * full reaction aggregate so the UI updates from one round trip.
 *
 * Membership is enforced via the message's conversation — the aggregate is
 * never exposed to non-members.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    const client = dbClient()
    await rateLimit(`chat-react:${user.id}`, 60, 60 * 1000, client)
    const payload = (await req.json().catch(() => ({}))) as { messageId?: string; emoji?: string }
    const messageId = String(payload.messageId ?? '')
    const emoji = String(payload.emoji ?? '').trim()
    if (!messageId) throw new HttpError(400, 'messageId is required')
    if (!isEmojiOnly(emoji)) throw new HttpError(400, 'Invalid emoji')

    const message = await client.chatMessage.findUnique({
      where: { id: messageId },
      select: { conversationId: true },
    })
    if (!message) throw new HttpError(404, 'Message not found')
    await requireMembership(client, message.conversationId, user.id)

    const existing = await client.chatReaction.findUnique({
      where: { messageId_userId_emoji: { messageId, userId: user.id, emoji } },
      select: { emoji: true },
    })
    let reacted: boolean
    if (existing) {
      await client.chatReaction.delete({
        where: { messageId_userId_emoji: { messageId, userId: user.id, emoji } },
      })
      reacted = false
    } else {
      await client.chatReaction.create({ data: { messageId, userId: user.id, emoji } })
      reacted = true
    }

    const rows = await client.chatReaction.findMany({
      where: { messageId },
      select: { emoji: true, userId: true },
      orderBy: { createdAt: 'asc' },
    })
    return Response.json({ reacted, reactions: aggregate(rows, user.id) })
  } catch (err) {
    return jsonError(err)
  }
}

/** grouped for the client: [{ emoji, count, mine }] */
function aggregate(
  rows: { emoji: string; userId: string }[],
  meId: string
): { emoji: string; count: number; mine: boolean }[] {
  const map = new Map<string, { emoji: string; count: number; mine: boolean }>()
  for (const r of rows) {
    const entry = map.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false }
    entry.count += 1
    if (r.userId === meId) entry.mine = true
    map.set(r.emoji, entry)
  }
  return [...map.values()]
}
