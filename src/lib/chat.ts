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

/** Membership guard — 404s unknown conversations so ids can't be probed. */
export async function requireMembership(
  client: PrismaClient,
  conversationId: string,
  userId: string
) {
  const conversation = await client.chatConversation.findUnique({
    where: { id: conversationId },
    include: {
      members: {
        select: { userId: true, role: true, user: { select: { id: true, name: true, email: true } } },
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
  sender?: { id: string; name: string | null } | null
}) {
  return {
    id: msg.id,
    body: msg.body,
    createdAt: msg.createdAt,
    senderId: msg.senderId,
    senderName: msg.sender?.name ?? 'Student',
  }
}

export function toClientMember(m: {
  userId: string
  role: string
  user: { id: string; name: string | null; email: string }
}) {
  return {
    id: m.user.id,
    name: m.user.name ?? 'Student',
    email: maskEmail(m.user.email),
    role: m.role,
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
