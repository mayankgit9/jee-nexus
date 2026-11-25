// JEE NEXUS — community chat helpers (DMs + study groups)
//
// Subrequest discipline (prod lesson 2026-11-25): every chat route runs all
// of its queries through ONE dbClient() — never the per-access `db` Proxy —
// so a request costs a bounded number of subrequests on Workers.
import type { PrismaClient } from '@prisma/client'
import { HttpError } from '@/lib/auth'

export const CHAT_LIMITS = {
  messageMaxChars: 2000,
  groupNameMin: 1,
  groupNameMax: 60,
  membersMax: 21, // creator + 20 invitees
  inviteesMax: 20,
  conversationsTake: 50,
  messagesTake: 50,
} as const

/** r***@gmail.com — enough to disambiguate people without leaking addresses */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return '***'
  const head = local.slice(0, 1)
  return `${head}${'•'.repeat(Math.max(2, Math.min(5, local.length - 1)))}@${domain}`
}

/** Membership guard — 404s unknown conversations so ids can't be probed.
 *  Also carries the presence/read fields the client needs for receipts:
 *  member lastReadAt ("Seen") and user lastSeenAt (online dots). */
export async function requireMembership(
  client: PrismaClient,
  conversationId: string,
  userId: string
) {
  const conversation = await client.chatConversation.findUnique({
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
  const mine = conversation.members.find((m) => m.userId === userId)
  if (!mine) throw new HttpError(403, 'You are not a member of this conversation')
  return { conversation, membership: mine }
}

export function toClientMessage(msg: {
  id: string
  body: string
  createdAt: Date
  senderId: string
  deletedAt?: Date | null
  replyToId?: string | null
  sender?: { id: string; name: string | null } | null
}) {
  const deleted = Boolean(msg.deletedAt)
  return {
    id: msg.id,
    body: deleted ? '' : msg.body,
    deleted,
    createdAt: msg.createdAt,
    senderId: msg.senderId,
    senderName: msg.sender?.name ?? 'Student',
    replyToId: msg.replyToId ?? null,
    replyTo: null as ReplyContext | null, // filled by hydrateReplies()
  }
}

/** quoted-context shape embedded under each message that is a reply */
export interface ReplyContext {
  id: string
  senderName: string
  body: string // blank when the parent was deleted
  deleted: boolean
}

/** server-side cap for the quoted snippet — previews only, full body stays on the parent */
const REPLY_SNIPPET_MAX = 160

/**
 * Fetch the parent messages for every reply in a page in ONE query and
 * return messageId → quoted context. Deleted parents ship an empty body —
 * their text must never reach the client again.
 */
export async function hydrateReplies(
  client: PrismaClient,
  messages: { id: string; replyToId?: string | null }[]
): Promise<Map<string, ReplyContext>> {
  const parentIds = Array.from(
    new Set(messages.map((m) => m.replyToId).filter((x): x is string => Boolean(x)))
  )
  const out = new Map<string, ReplyContext>()
  if (parentIds.length === 0) return out
  const parents = await client.chatMessage.findMany({
    where: { id: { in: parentIds } },
    select: {
      id: true,
      body: true,
      deletedAt: true,
      sender: { select: { name: true } },
    },
  })
  for (const p of parents) {
    const deleted = Boolean(p.deletedAt)
    const body = deleted ? '' : p.body.replace(/\s+/g, ' ').slice(0, REPLY_SNIPPET_MAX)
    out.set(p.id, { id: p.id, senderName: p.sender?.name ?? 'Student', body, deleted })
  }
  return out
}

/** attach hydrated reply contexts to already-mapped client messages */
export function attachReplies<
  T extends { id: string; replyToId: string | null; replyTo: ReplyContext | null }
>(messages: T[], replyMap: Map<string, ReplyContext>): T[] {
  for (const m of messages) {
    if (m.replyToId) m.replyTo = replyMap.get(m.replyToId) ?? null
  }
  return messages
}

export function toClientMember(m: {
  userId: string
  role: string
  lastReadAt?: Date | null
  user: { id: string; name: string | null; email: string; lastSeenAt?: Date | null }
}) {
  return {
    id: m.user.id,
    name: m.user.name ?? 'Student',
    email: maskEmail(m.user.email),
    role: m.role,
    lastReadAt: m.lastReadAt ?? null,
    lastSeenAt: m.user.lastSeenAt ?? null,
  }
}

/** Rejects invisible control characters (everything except \n and \t). */
export function sanitizeMessageBody(raw: string): string {
  const text = raw.replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '').trim()
  if (!text.length) throw new HttpError(400, 'Message cannot be empty')
  if (text.length > CHAT_LIMITS.messageMaxChars) {
    throw new HttpError(400, `Message too long (max ${CHAT_LIMITS.messageMaxChars} characters)`)
  }
  return text
}
