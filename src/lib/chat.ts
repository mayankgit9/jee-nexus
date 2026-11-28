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

/** The one public lobby conversation — readable/postable by EVERYONE.
 *  Created by migration 0017 with this fixed id. */
export const LOBBY_CONVERSATION_ID = 'lobby'

/** Lazy auto-join: the lobby is not a "membership" from the user's POV
 *  (no join button, no invite) — but a membership row reuses all the
 *  existing machinery (unread receipts, sidebar, mentions, typing).
 *  Idempotent and safe to call on every lobby interaction. */
export async function ensureLobbyMembership(client: PrismaClient, userId: string): Promise<void> {
  await client.chatMember
    .upsert({
      where: { conversationId_userId: { conversationId: LOBBY_CONVERSATION_ID, userId } },
      create: { conversationId: LOBBY_CONVERSATION_ID, userId, role: 'member' },
      update: {},
    })
    .catch(() => {}) // lobby row always exists via migration; never block UX
}

/** Guest display names for lobby posts: 2-24 chars, no control chars. */
export function sanitizeGuestName(raw: string): string {
  const name = raw.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, 24)
  if (name.length < 2) throw new HttpError(400, 'Guest name must be 2-24 characters')
  return name
}

/** Membership guard — 404s unknown conversations so ids can't be probed.
 *  Also carries the presence/read fields the client needs for receipts:
 *  member lastReadAt ("Seen") and user lastSeenAt (online dots).
 *  LOBBY BYPASS: the lobby is open to everyone — signed-in non-members get
 *  a viewer context without a membership row (auto-join happens lazily on
 *  interaction, not on read). */
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
  if (!mine) {
    if (conversation.type === 'lobby') {
      return { conversation, membership: { role: 'guest', lastReadAt: null } }
    }
    throw new HttpError(403, 'You are not a member of this conversation')
  }
  return { conversation, membership: mine }
}

export function toClientMessage(msg: {
  id: string
  body: string
  createdAt: Date
  senderId: string | null
  senderName?: string | null
  deletedAt?: Date | null
  replyToId?: string | null
  sender?: { id: string; name: string | null } | null
  attachment?: unknown
}) {
  const deleted = Boolean(msg.deletedAt)
  return {
    id: msg.id,
    body: deleted ? '' : msg.body,
    deleted,
    createdAt: msg.createdAt,
    senderId: msg.senderId,
    // guest posts carry a senderName snapshot; account posts prefer the live name
    senderName: msg.sender?.name ?? msg.senderName ?? 'Guest',
    isGuest: msg.senderId === null,
    replyToId: msg.replyToId ?? null,
    replyTo: null as ReplyContext | null, // filled by hydrateReplies()
    attachment: !deleted && msg.attachment ? (msg.attachment as Record<string, unknown>) : null,
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
  user: { id: string; name: string | null; email: string | null; lastSeenAt?: Date | null }
}) {
  return {
    id: m.user.id,
    name: m.user.name ?? 'Student',
    email: m.user.email ? maskEmail(m.user.email) : null,
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

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Resolve "@<display name>" mentions in a message body against conversation
 * members. Case-insensitive; the name must end at a word boundary (so "@may"
 * does not match member "Mayank"); multi-word names are supported
 * ("@Mayank Kumar"). Members are matched longest-name-first and each matched
 * span is blanked before the next attempt, so a member named "Mayank" is not
 * double-pinged by "@Mayank Kumar". Sender excluded, duplicates collapsed,
 * at most 10 mentions per message. Returns the mentioned member ids.
 */
export function parseMentions(
  body: string,
  members: { id: string; name: string | null }[],
  senderId: string
): string[] {
  let work = body
  const out: string[] = []
  const candidates = members
    .filter((m) => m.id !== senderId && m.name && m.name.trim().length >= 2)
    .sort((a, b) => (b.name as string).trim().length - (a.name as string).trim().length)
  for (const m of candidates) {
    if (out.length >= 10) break
    const name = (m.name as string).trim()
    const re = new RegExp(`@${escapeRegExp(name.toLowerCase())}(?![a-zA-Z0-9_])`, 'i')
    if (!re.test(work)) continue
    work = work.replace(re, (match) => ' '.repeat(match.length))
    out.push(m.id)
  }
  return out
}
