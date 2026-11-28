'use client'

// JEE NEXUS — Community view: the public lobby + DMs + study group chats.
//
// LOBBY-FIRST (2026-11-28): opening Community always lands in the permanent
// public lobby (id 'lobby', type 'lobby'). Guests — signed-out visitors — can
// read it and post under an editable ephemeral name (localStorage
// jee_lobby_guest_name); DMs, groups, mentions, reactions and typing stay
// account-only.
//
// Polling architecture (no websockets on Workers/OpenNext):
//   sidebar      GET /api/chat/conversations   every 10s
//   active chat  GET /api/chat/messages?after= every 3s (dedup by id)
// Both pause when the tab is hidden. All sends/reads are explicit REST calls.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowLeft, ArrowDown, Ban, Check, CheckCheck, Copy, CornerUpLeft, Globe2, Hash, Loader2, MessagesSquare, MessageSquare, MessageSquarePlus,
  Pencil, Search, Send, Smile, Trash2, Users, X, LogIn, UserPlus, ArrowDownToLine,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import type { SessionUser } from '@/lib/types'
import { api, navigate } from '@/lib/client'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------- types

interface ChatUser {
  id: string
  name: string
  email: string
  role?: string
  lastSeenAt?: string | null
  lastReadAt?: string | null
}

interface Conversation {
  id: string
  type: 'dm' | 'group' | 'lobby'
  name: string | null
  updatedAt: string
  myRole: string
  members: ChatUser[]
  lastMessage: { body: string; createdAt: string; senderId: string | null; senderName: string } | null
  unread: number
}

interface ChatMessage {
  id: string
  body: string
  deleted?: boolean
  createdAt: string
  senderId: string | null // guest posts have no account behind them
  senderName: string
  isGuest?: boolean
  replyToId?: string | null
  replyTo?: { id: string; senderName: string; body: string; deleted: boolean } | null
}

interface ConvMeta {
  id: string
  type: 'dm' | 'group' | 'lobby'
  name: string | null
  myRole: string
  members: ChatUser[]
}

interface SearchResult {
  id: string
  body: string
  createdAt: string
  senderId: string
  senderName: string
  conversation: { id: string; type: 'dm' | 'group' | 'lobby'; name: string | null; otherName: string | null }
}

interface TypingUser {
  userId: string
  name: string
}

interface ReactionChip {
  emoji: string
  count: number
  mine: boolean
}

/** compact picker set — covers the common study-group responses */
const REACTION_EMOJIS = ['👍', '🔥', '❤️', '😂', '🎉', '🤔', '😮', '👏', '🙏', '💪']

/** composer quick-insert set — study-chat staples */
const COMPOSER_EMOJIS = [
  '😀', '😂', '🙂', '😅', '😍', '🤔', '😎', '😴',
  '👍', '👎', '👏', '🙏', '💪', '🤝', '✌️', '🫡',
  '🔥', '✨', '🎉', '🎯', '📚', '✏️', '🧠', '☕',
  '❤️', '💯', '⚡', '🚀', '😢', '😮', '🤯', '😱',
]

type Filter = 'all' | 'dm' | 'group'

// ---------------------------------------------------------------- lobby

/** the permanent public lobby — readable and postable by EVERYONE */
const LOBBY_ID = 'lobby'
/** identity line shown in the lobby header + pinned sidebar card */
const LOBBY_TAGLINE = 'General Chat — open to everyone'
/** localStorage key for the guest display name in the lobby */
const GUEST_NAME_KEY = 'jee_lobby_guest_name'

/** random fun default guest name, e.g. "Guest-4213" */
function randomGuestName(): string {
  return `Guest-${Math.floor(1000 + Math.random() * 9000)}`
}

// ---------------------------------------------------------------- helpers

const AVATAR_GRADIENTS = [
  'from-emerald-400/80 to-teal-500/80',
  'from-amber-300/80 to-orange-400/80',
  'from-violet-400/80 to-purple-500/80',
  'from-sky-400/80 to-blue-500/80',
  'from-rose-400/80 to-pink-500/80',
  'from-lime-400/80 to-green-500/80',
  'from-cyan-400/80 to-sky-500/80',
  'from-fuchsia-400/80 to-violet-500/80',
]

function gradientFor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length]
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

function conversationTitle(c: Conversation, meId: string): string {
  if (c.type === 'lobby') return 'Lobby'
  if (c.type === 'group') return c.name ?? 'Study group'
  const other = c.members.find((m) => m.id !== meId)
  return other?.name ?? 'Direct message'
}

function timeLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  if (now.getTime() - d.getTime() < 6 * 24 * 3600 * 1000) {
    return d.toLocaleDateString([], { weekday: 'short' })
  }
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })
}

function clockLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function previewOf(c: Conversation, meId: string): string {
  if (!c.lastMessage) return c.type === 'group' ? 'Group created' : 'Say hello'
  const prefix = c.lastMessage.senderId === meId ? 'You: ' : c.type === 'group' ? `${c.lastMessage.senderName.split(' ')[0]}: ` : ''
  const body = c.lastMessage.body.replace(/\s+/g, ' ')
  return `${prefix}${body.length > 60 ? body.slice(0, 60) + '…' : body}`
}

/** Escape a string for literal use inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Member-name mention matcher (word-bounded, case-insensitive, longest
 * names first so "@Riya Sen" is consumed before a member named "Riya").
 * Returns true if any matched token names the given user. Mirrors the
 * server-side parseMentions rules in lib/chat.ts without importing it
 * (lib/auth is server-only).
 */
function memberMentionTokens(body: string | undefined, members: ChatUser[]): string[] {
  if (!body) return []
  const names = members
    .filter((m) => m.name && m.name.trim().length >= 2)
    .map((m) => (m.name as string).trim())
  if (!names.length) return []
  const re = new RegExp(
    `@(?:${[...names].sort((a, b) => b.length - a.length).map(escapeRe).join('|')})(?![a-zA-Z0-9_])`,
    'gi'
  )
  const tokens: string[] = []
  let mt: RegExpExecArray | null
  while ((mt = re.exec(body)) !== null) tokens.push(mt[0].slice(1).toLowerCase())
  return tokens
}

function mentionsMe(body: string | undefined, members: ChatUser[], myName: string): boolean {
  const myLower = myName.trim().toLowerCase()
  return Boolean(myLower) && memberMentionTokens(body, members).includes(myLower)
}

/** "online" = seen by the server within the last 5 minutes */
const ONLINE_WINDOW_MS = 5 * 60 * 1000

function isOnline(lastSeenAt?: string | null): boolean {
  if (!lastSeenAt) return false
  return Date.now() - new Date(lastSeenAt).getTime() < ONLINE_WINDOW_MS
}

function lastSeenLabel(lastSeenAt?: string | null): string {
  if (!lastSeenAt) return 'offline'
  const delta = Date.now() - new Date(lastSeenAt).getTime()
  if (delta < 60_000) return 'last seen just now'
  if (delta < 3_600_000) return `last seen ${Math.floor(delta / 60_000)}m ago`
  if (delta < 24 * 3_600_000) return `last seen ${Math.floor(delta / 3_600_000)}h ago`
  if (delta < 48 * 3_600_000) return 'last seen yesterday'
  return `last seen ${new Date(lastSeenAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}`
}

/** window the body around the first case-insensitive match so the hit is visible */
function snippetOf(body: string, q: string): string {
  const clean = body.replace(/\s+/g, ' ')
  const idx = clean.toLowerCase().indexOf(q.toLowerCase())
  if (idx < 0) return clean.length > 120 ? clean.slice(0, 120) + '…' : clean
  const start = Math.max(0, idx - 40)
  const end = Math.min(clean.length, idx + q.length + 70)
  return (start > 0 ? '…' : '') + clean.slice(start, end) + (end < clean.length ? '…' : '')
}

// ---------------------------------------------------------------- main view

export function CommunityView({
  user,
  loggedIn,
}: {
  user: SessionUser | null
  loggedIn: boolean
  /** kept for API compatibility — guests are prompted to sign in via /profile */
  onRequireAuth?: () => void
}) {
  const { toast } = useToast()
  const meId = user?.id ?? ''

  // sidebar state
  const [conversations, setConversations] = useState<Conversation[] | null>(null)
  const [convError, setConvError] = useState<string | null>(null)
  const [convLoading, setConvLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [newChatOpen, setNewChatOpen] = useState(false)

  // message search (sidebar)
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const searchSeq = useRef(0)

  // active conversation state
  const [activeId, setActiveId] = useState<string | null>(null)
  const [meta, setMeta] = useState<ConvMeta | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [messagesError, setMessagesError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [addMembersOpen, setAddMembersOpen] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [leaving, setLeaving] = useState(false)
  // typing + presence + scroll UX
  const [typing, setTyping] = useState<TypingUser[]>([])
  const [showJump, setShowJump] = useState(false)
  const [reactions, setReactions] = useState<Record<string, ReactionChip[]>>({})
  const [pickerFor, setPickerFor] = useState<string | null>(null)
  const [reacting, setReacting] = useState(false)
  const lastTypingPing = useRef(0)

  // replies + deletes + emoji + rename
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)

  // composer
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  // @mention autocomplete: { start, token } = location of the trailing
  // "@<token>" in the draft (null = popup closed); mentionIdx = highlighted row
  const [mention, setMention] = useState<{ start: number; token: string } | null>(null)
  const [mentionIdx, setMentionIdx] = useState(0)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const stickToBottom = useRef(true)
  const initialLoadDone = useRef(false)

  // guest lobby state (signed-out visitors): display name + inline editor
  const [guestName, setGuestName] = useState('')
  const [guestEditing, setGuestEditing] = useState(false)
  const [guestDraft, setGuestDraft] = useState('')

  // ---------- lobby / mode derived ----------
  const guestView = !loggedIn
  const lobbyConv = useMemo(() => (conversations ?? []).find((c) => c.id === LOBBY_ID) ?? null, [conversations])
  const isLobbyChat = meta?.type === 'lobby'
  /** the lobby shares the group message layout (sender names, mention highlights) */
  const groupLike = meta?.type === 'group' || isLobbyChat
  /** mention autocomplete: groups for everyone, lobby for signed-in members only */
  const canMention = meta?.type === 'group' || (isLobbyChat && loggedIn)

  const refreshConversations = useCallback(async () => {
    try {
      const r = await api<{ conversations: Conversation[] }>('/api/chat/conversations')
      setConversations(r.conversations)
      setConvError(null)
    } catch (e) {
      setConvError((e as Error).message)
    } finally {
      setConvLoading(false)
    }
  }, [])

  // debounced message search — fires when the sidebar query reaches 2 chars
  useEffect(() => {
    const q = searchQ.trim()
    if (q.length < 2) {
      setSearchResults(null)
      setSearching(false)
      return
    }
    const seq = ++searchSeq.current
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const r = await api<{ results: SearchResult[] }>(
          `/api/chat/search?q=${encodeURIComponent(q)}`
        )
        if (seq === searchSeq.current) setSearchResults(r.results)
      } catch {
        if (seq === searchSeq.current) setSearchResults([])
      } finally {
        if (seq === searchSeq.current) setSearching(false)
      }
    }, 350)
    return () => clearTimeout(t)
  }, [searchQ])

  const markRead = useCallback(
    async (conversationId: string) => {
      if (!loggedIn) return // guests have no read receipts
      await api('/api/chat/read', { conversationId }).catch(() => {})
      setConversations((prev) =>
        prev ? prev.map((c) => (c.id === conversationId ? { ...c, unread: 0 } : c)) : prev
      )
    },
    [loggedIn]
  )

  /** open a conversation: load latest page + mark read */
  const openConversation = useCallback(
    async (id: string) => {
      setActiveId(id)
      setMessagesLoading(true)
      setMessagesError(null)
      setMessages([])
      setMeta(null)
      setTyping([])
      setReplyTo(null)
      setConfirmDelete(null)
      setEmojiOpen(false)
      setMention(null)
      initialLoadDone.current = false
      try {
        const r = await api<{ conversation: ConvMeta; messages: ChatMessage[]; hasMore: boolean; typing?: TypingUser[]; reactions?: Record<string, ReactionChip[]> }>(
          `/api/chat/messages?conversationId=${encodeURIComponent(id)}`
        )
        setMeta(r.conversation)
        setMessages(r.messages)
        setHasMore(r.hasMore)
        setTyping(r.typing ?? [])
        setReactions(r.reactions ?? {})
        setPickerFor(null)
        stickToBottom.current = true
        setShowJump(false)
        void markRead(id)
      } catch (e) {
        setMessagesError((e as Error).message)
      } finally {
        setMessagesLoading(false)
      }
    },
    [markRead]
  )

  // deep link: #/community?c=<id> (notification toast "Open" navigates here)
  // — consumed ONCE per mount, after the sidebar list has loaded, so the
  // target conversation exists and in-view navigation isn't hijacked later
  const deepLinkDone = useRef(false)
  useEffect(() => {
    if (deepLinkDone.current || convLoading || !conversations) return
    deepLinkDone.current = true
    const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
    const c = q.get('c')
    if (c && conversations.some((x) => x.id === c)) {
      void openConversation(c)
      return
    }
    // lobby-first: with no ?c= target, the public lobby opens by default
    void openConversation(LOBBY_ID)
  }, [conversations, convLoading, openConversation])

  // guests can only see the lobby — open it immediately on mount
  const guestOpenDone = useRef(false)
  useEffect(() => {
    if (guestOpenDone.current || loggedIn) return
    guestOpenDone.current = true
    void openConversation(LOBBY_ID)
  }, [loggedIn, openConversation])

  // guest display name: persisted in localStorage, prefilled with a random
  // fun name ("Guest-1234") the first time so the composer is never unnamed
  useEffect(() => {
    let name = ''
    try {
      const saved = window.localStorage.getItem(GUEST_NAME_KEY)
      name = saved ? saved.trim().slice(0, 24) : ''
    } catch {
      name = ''
    }
    if (name.length < 2) {
      name = randomGuestName()
      try {
        window.localStorage.setItem(GUEST_NAME_KEY, name)
      } catch {
        /* private mode — the name just won't persist */
      }
    }
    setGuestName(name)
  }, [])

  const loadEarlier = useCallback(async () => {
    if (!activeId || !messages.length || loadingEarlier) return
    setLoadingEarlier(true)
    const list = listRef.current
    const prevHeight = list?.scrollHeight ?? 0
    try {
      const oldest = messages[0]
      const r = await api<{ messages: ChatMessage[]; hasMore: boolean }>(
        `/api/chat/messages?conversationId=${encodeURIComponent(activeId)}&before=${encodeURIComponent(oldest.createdAt)}`
      )
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id))
        return [...r.messages.filter((m) => !seen.has(m.id)), ...prev]
      })
      setHasMore(r.hasMore)
      // keep the viewport anchored where it was
      requestAnimationFrame(() => {
        const el = listRef.current
        if (el) el.scrollTop = el.scrollHeight - prevHeight + el.scrollTop
      })
    } catch (e) {
      toast({ title: 'Could not load earlier messages', description: (e as Error).message })
    } finally {
      setLoadingEarlier(false)
    }
  }, [activeId, messages, loadingEarlier, toast])

  /** incremental poll for the open conversation — messages + typing + presence + tombstones */
  const pollNew = useCallback(async () => {
    if (!activeId || !messages.length) return
    const last = messages[messages.length - 1]
    try {
      const r = await api<{
        messages: ChatMessage[]
        conversation: ConvMeta
        typing?: TypingUser[]
        reactions?: Record<string, ReactionChip[]>
        deletedIds?: string[]
      }>(
        `/api/chat/messages?conversationId=${encodeURIComponent(activeId)}&after=${encodeURIComponent(last.createdAt)}`
      )
      setTyping(r.typing ?? [])
      setMeta((prev) => (prev ? { ...prev, members: r.conversation.members } : prev))
      if (r.reactions && Object.keys(r.reactions).length > 0) {
        setReactions((prev) => ({ ...prev, ...r.reactions }))
      }
      // live tombstones: mark any loaded message the sender has deleted,
      // and blank the quoted context of loaded replies to it
      if (r.deletedIds && r.deletedIds.length > 0) {
        const gone = new Set(r.deletedIds)
        setMessages((prev) =>
          prev.some((m) => (gone.has(m.id) && !m.deleted) || (m.replyToId && gone.has(m.replyToId) && m.replyTo && !m.replyTo.deleted))
            ? prev.map((m) => {
                if (gone.has(m.id)) return { ...m, deleted: true, body: '' }
                if (m.replyToId && gone.has(m.replyToId)) {
                  return { ...m, replyTo: m.replyTo ? { ...m.replyTo, deleted: true, body: '' } : m.replyTo }
                }
                return m
              })
            : prev
        )
        setReactions((prev) => {
          const next = { ...prev }
          let touched = false
          for (const id of gone) {
            if (next[id]) {
              delete next[id]
              touched = true
            }
          }
          return touched ? next : prev
        })
      }
      if (r.messages.length === 0) return
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id))
        const fresh = r.messages.filter((m) => !seen.has(m.id))
        if (!fresh.length) return prev
        const fromOthers = fresh.some((m) => m.senderId !== meId)
        if (fromOthers) void markRead(activeId)
        return [...prev, ...fresh]
      })
    } catch {
      /* transient — next tick retries */
    }
  }, [activeId, messages, meId, markRead])

  const onDraftChange = useCallback(
    (value: string) => {
      setDraft(value)
      // typing heartbeat: only while there is text, at most every 2.5s
      // (guests have no typing state — the endpoint is account-only)
      const now = Date.now()
      if (value.trim() && activeId && loggedIn && now - lastTypingPing.current > 2_500) {
        lastTypingPing.current = now
        void api('/api/chat/typing', { conversationId: activeId }).catch(() => {})
      }
      // mention popup: a trailing "@token" (start-of-text or after whitespace,
      // no spaces inside) opens the member picker while ANY member name
      // contains the token; anything else closes it. Groups — and the lobby
      // for signed-in members. DMs already surface the sender's name in the
      // notification toast.
      const m = /(^|\s)@([^\s@]{0,30})$/.exec(value)
      const token = m?.[2]
      if (m && token !== undefined && canMention) {
        const lower = token.toLowerCase()
        const hit = meta!.members.some((x) => x.id !== meId && x.name.toLowerCase().includes(lower))
        if (hit) {
          setMention({ start: m.index + m[1].length, token })
          setMentionIdx(0)
          return
        }
      }
      setMention(null)
    },
    [activeId, meta, meId, loggedIn, canMention]
  )

  // candidates for the mention popup (max 6, sender excluded)
  const mentionCandidates = useMemo(
    () =>
      mention && canMention
        ? meta!.members
            .filter((m) => m.id !== meId && m.name.toLowerCase().includes(mention.token.toLowerCase()))
            .slice(0, 6)
        : [],
    [mention, canMention, meta, meId]
  )

  /** complete the highlighted @mention: swap the token for "@<name> " */
  const acceptMention = useCallback(
    (name: string) => {
      if (!mention) return
      setDraft((prev) => {
        const before = prev.slice(0, mention.start)
        const after = prev.slice(mention.start + 1 + mention.token.length)
        return `${before}@${name} ${after}`
      })
      setMention(null)
      composerRef.current?.focus()
    },
    [mention]
  )

  // conversations whose latest unread message mentions me (sidebar markers)
  const mentionedConvIds = useMemo(
    () =>
      new Set(
        (conversations ?? [])
          .filter(
            (c) =>
              c.unread > 0 && c.lastMessage && mentionsMe(c.lastMessage.body, c.members, user?.name ?? '')
          )
          .map((c) => c.id)
      ),
    [conversations, user]
  )

  /**
   * Highlight "@<member name>" tokens inside message bodies and quoted
   * snippets. Longest names consume first (matching the server parser);
   * mentions of ME get the accent treatment, mentions of others stay quiet.
   * own = the containing bubble was sent by me (styles must survive the
   * mint/white bubble palette); snippet = quoted-reply context (no chips).
   */
  const renderMentionText = useCallback(
    (body: string, own: boolean, snippet: boolean): ReactNode[] => {
      if (!body) return [body]
      const tokens = groupLike && meta ? memberMentionTokens(body, meta.members) : []
      if (!tokens.length) return [body]
      const myLower = (user?.name ?? '').trim().toLowerCase()
      const re = new RegExp(
        `@(?:${meta!.members
          .filter((m) => m.name && m.name.trim().length >= 2)
          .map((m) => escapeRe((m.name as string).trim()))
          .sort((a, b) => b.length - a.length)
          .join('|')})(?![a-zA-Z0-9_])`,
        'gi'
      )
      const nodes: ReactNode[] = []
      let last = 0
      let k = 0
      let mt: RegExpExecArray | null
      while ((mt = re.exec(body)) !== null) {
        if (mt.index > last) nodes.push(body.slice(last, mt.index))
        const token = mt[0]
        const isMe = myLower !== '' && token.slice(1).toLowerCase() === myLower
        let cls: string
        if (snippet) {
          cls = isMe && !own ? 'font-semibold text-primary' : 'font-semibold'
        } else if (own) {
          cls = 'rounded bg-white/20 px-0.5 font-semibold'
        } else {
          cls = isMe ? 'rounded bg-primary/15 px-1 font-semibold text-primary' : 'font-semibold text-foreground'
        }
        nodes.push(
          <span key={k++} className={cls}>
            {token}
          </span>
        )
        last = mt.index + token.length
      }
      if (last < body.length) nodes.push(body.slice(last))
      return nodes
    },
    [meta, user, groupLike]
  )

  /** toggle a reaction; the API returns the fresh aggregate for that message */
  const toggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (reacting) return
      setReacting(true)
      setPickerFor(null)
      try {
        const r = await api<{ reacted: boolean; reactions: ReactionChip[] }>('/api/chat/reactions', {
          messageId,
          emoji,
        })
        setReactions((prev) => {
          const next = { ...prev }
          if (r.reactions.length > 0) next[messageId] = r.reactions
          else delete next[messageId]
          return next
        })
      } catch (e) {
        toast({ title: 'Could not react', description: (e as Error).message })
      } finally {
        setReacting(false)
      }
    },
    [reacting, toast]
  )

  const sendMessage = useCallback(async () => {
    const body = draft.trim()
    if (!body || !activeId || sending) return

    // ---------- guest path: lobby only, ephemeral display name ----------
    if (!loggedIn) {
      const name = guestName.trim()
      if (name.length < 2 || name.length > 24) {
        setGuestDraft(guestName)
        setGuestEditing(true)
        toast({ title: 'Add a display name', description: 'Your guest name must be 2-24 characters.' })
        return
      }
      setSending(true)
      try {
        const r = await api<{ message: ChatMessage }>('/api/chat/messages', {
          conversationId: activeId,
          body,
          guestName: name,
        })
        setDraft('')
        if (composerRef.current) composerRef.current.style.height = 'auto'
        setMessages((prev) => (prev.some((m) => m.id === r.message.id) ? prev : [...prev, r.message]))
        stickToBottom.current = true
        setConversations((prev) =>
          prev
            ? prev.map((c) =>
                c.id === activeId
                  ? { ...c, updatedAt: new Date().toISOString(), lastMessage: { body, createdAt: r.message.createdAt, senderId: null, senderName: name } }
                  : c
              )
            : prev
        )
      } catch (e) {
        toast({ title: 'Message not sent', description: (e as Error).message })
      } finally {
        setSending(false)
      }
      return
    }

    // ---------- member path (signed in) ----------
    setSending(true)
    try {
      const r = await api<{ message: ChatMessage }>('/api/chat/messages', {
        conversationId: activeId,
        body,
        ...(replyTo ? { replyToId: replyTo.id } : {}),
      })
      setDraft('')
      setMention(null)
      setReplyTo(null)
      if (composerRef.current) composerRef.current.style.height = 'auto'
      setMessages((prev) => (prev.some((m) => m.id === r.message.id) ? prev : [...prev, r.message]))
      stickToBottom.current = true
      setConversations((prev) =>
        prev
          ? prev.map((c) =>
              c.id === activeId
                ? { ...c, updatedAt: new Date().toISOString(), lastMessage: { body, createdAt: r.message.createdAt, senderId: meId, senderName: 'You' } }
                : c
            )
          : prev
      )
    } catch (e) {
      toast({ title: 'Message not sent', description: (e as Error).message })
    } finally {
      setSending(false)
    }
  }, [draft, activeId, sending, meId, replyTo, toast, loggedIn, guestName])

  /** save the edited guest name (2-24 chars) to state + localStorage */
  const saveGuestName = useCallback(() => {
    const name = guestDraft.replace(/\s+/g, ' ').trim().slice(0, 24)
    if (name.length < 2) {
      toast({ title: 'Name too short', description: 'Your guest name needs 2-24 characters.' })
      return
    }
    setGuestName(name)
    try {
      window.localStorage.setItem(GUEST_NAME_KEY, name)
    } catch {
      /* private mode — the name just won't persist */
    }
    setGuestEditing(false)
    composerRef.current?.focus()
  }, [guestDraft, toast])

  /** soft-delete the caller's own message and swap the bubble for a tombstone */
  const deleteMessage = useCallback(async () => {
    if (!confirmDelete || deleting) return
    setDeleting(true)
    const target = confirmDelete
    try {
      await api('/api/chat/messages', { messageId: target }, 'DELETE')
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id === target) return { ...m, deleted: true, body: '' }
          // replies quoting the deleted message lose their snippet too
          if (m.replyToId === target && m.replyTo) {
            return { ...m, replyTo: { ...m.replyTo, deleted: true, body: '' } }
          }
          return m
        })
      )
      setReactions((prev) => {
        const next = { ...prev }
        delete next[target]
        return next
      })
      setConversations((prev) =>
        prev
          ? prev.map((c) =>
              c.id === activeId && c.lastMessage
                ? { ...c, lastMessage: { ...c.lastMessage, body: 'Message deleted' } }
                : c
            )
          : prev
      )
    } catch (e) {
      toast({ title: 'Could not delete message', description: (e as Error).message })
    } finally {
      setDeleting(false)
      setConfirmDelete(null)
    }
  }, [confirmDelete, deleting, activeId, toast])

  /** admins rename the study group; local state updates everywhere at once */
  const renameGroup = useCallback(async () => {
    const name = renameValue.trim()
    if (!meta || !name || renaming || name === meta.name) {
      setRenameOpen(false)
      return
    }
    setRenaming(true)
    try {
      await api('/api/chat/conversations', { conversationId: meta.id, name }, 'PATCH')
      setMeta((prev) => (prev ? { ...prev, name } : prev))
      setConversations((prev) =>
        prev ? prev.map((c) => (c.id === meta.id ? { ...c, name } : c)) : prev
      )
      toast({ title: 'Group renamed', description: name })
      setRenameOpen(false)
    } catch (e) {
      toast({ title: 'Could not rename group', description: (e as Error).message })
    } finally {
      setRenaming(false)
    }
  }, [meta, renameValue, renaming, toast])

  /** jump to a quoted/replied message and flash it */
  const scrollToMessage = useCallback((id: string) => {
    const el = listRef.current?.querySelector(`[data-mid="${id}"]`) as HTMLElement | null
    if (!el) {
      toast({ title: 'Original message is not loaded', description: 'Scroll up and load earlier messages to see it.' })
      return
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightId(id)
    window.setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 1600)
  }, [toast])

  const leaveConversation = useCallback(async () => {
    if (!activeId) return
    setLeaving(true)
    try {
      await api('/api/chat/leave', { conversationId: activeId })
      toast({
        title: meta?.type === 'dm' ? 'Chat deleted' : 'Left the group',
        description: meta?.type === 'dm' ? 'The conversation was removed for both members.' : undefined,
      })
      setActiveId(null)
      setMeta(null)
      setMessages([])
      await refreshConversations()
    } catch (e) {
      toast({ title: 'Could not leave chat', description: (e as Error).message })
    } finally {
      setLeaving(false)
      setConfirmLeave(false)
    }
  }, [activeId, meta, refreshConversations, toast])

  // ---------- effects: data loading + polling ----------

  useEffect(() => {
    if (!loggedIn) return
    void refreshConversations()
  }, [loggedIn, refreshConversations])

  useEffect(() => {
    if (!loggedIn) return
    const t = setInterval(() => {
      if (!document.hidden) void refreshConversations()
    }, 10_000)
    return () => clearInterval(t)
  }, [loggedIn, refreshConversations])

  useEffect(() => {
    if (!activeId) return
    const t = setInterval(() => {
      if (!document.hidden) void pollNew()
    }, 3_000)
    return () => clearInterval(t)
  }, [activeId, pollNew])

  // auto-scroll on new messages (only if pinned to bottom)
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight
    }
    initialLoadDone.current = true
  }, [messages])

  const onScroll = useCallback(() => {
    const el = listRef.current
    if (!el) return
    const pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 140
    stickToBottom.current = pinned
    setShowJump((prev) => (prev === !pinned ? prev : !pinned))
  }, [])

  // ---------- derived ----------

  const filtered = useMemo(() => {
    if (!conversations) return null
    const list = conversations.filter((c) => c.id !== LOBBY_ID) // lobby lives in its pinned slot
    if (filter === 'all') return list
    return list.filter((c) => c.type === filter)
  }, [conversations, filter])

  const totalUnread = useMemo(
    () => (conversations ?? []).reduce((n, c) => n + c.unread, 0),
    [conversations]
  )

  // unread count in the browser tab while the user is elsewhere
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\)\s+/, '')
    document.title = totalUnread > 0 ? `(${totalUnread}) ${base}` : base
    return () => {
      document.title = document.title.replace(/^\(\d+\)\s+/, '')
    }
  }, [totalUnread])

  const activeTitle = meta
    ? meta.type === 'lobby'
      ? 'Lobby'
      : meta.type === 'group'
        ? meta.name ?? 'Study group'
        : meta.members.find((m) => m.id !== meId)?.name ?? 'Direct message'
    : ''
  const rollingOut = (convError ?? messagesError ?? '').includes('not active on the live database')

  // ---------------------------------------------------------------- render

  return (
    <div className="mx-auto max-w-6xl">
      {/* page heading */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Community</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The open lobby, direct messages and study groups{' '}
            {totalUnread > 0 && <span className="font-medium text-primary">· {totalUnread} unread</span>}
          </p>
        </div>
        {loggedIn && (
          <Button onClick={() => setNewChatOpen(true)} className="gap-1.5">
            <MessageSquarePlus className="h-4 w-4" /> New chat
          </Button>
        )}
      </div>

      {rollingOut && (
        <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-500 dark:text-amber-300">
          Community chat is rolling out to the live database — the tables are being migrated. Everything else keeps working; check back shortly.
        </div>
      )}

      {/* extra mobile headroom (19rem) keeps the composer clear of the fixed bottom tab bar */}
      <div className="grid h-[calc(100dvh-19rem)] overflow-hidden rounded-2xl border bg-card shadow-lg md:h-[calc(100dvh-12.5rem)] md:grid-cols-[300px_1fr]">
        {/* ------------------------------------------------ sidebar */}
        <aside className={cn('min-h-0 flex-col border-r md:flex', activeId ? 'hidden' : 'flex')}>
          {loggedIn ? (
          <div className="space-y-3 border-b p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Search messages…"
                className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-7 text-xs outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/50"
              />
              {searchQ && (
                <button
                  type="button"
                  onClick={() => setSearchQ('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className={cn('flex gap-1.5', searchQ.trim().length >= 2 && 'hidden')}>
              {(['all', 'dm', 'group'] as Filter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={cn(
                    'flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors',
                    filter === f ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  {f === 'all' ? 'All' : f === 'dm' ? 'Direct' : 'Groups'}
                </button>
              ))}
            </div>
          </div>
          ) : (
            <div className="border-b px-3.5 py-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <MessagesSquare className="h-3.5 w-3.5" /> Community chat
              </p>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {/* ------------- pinned public lobby (always on top) ------------- */}
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => void openConversation(LOBBY_ID)}
              className={cn(
                'mb-2 flex w-full items-center gap-3 rounded-xl border px-2.5 py-2.5 text-left transition-all hover:-translate-y-px',
                activeId === LOBBY_ID
                  ? 'border-primary/50 bg-primary/10 shadow-[0_0_20px_-8px_var(--primary)]'
                  : 'border-emerald-400/25 bg-emerald-400/[0.06] hover:border-emerald-400/50'
              )}
              aria-label="Open the public lobby"
            >
              <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400/90 to-teal-500/90 text-white">
                <Globe2 className="h-[18px] w-[18px]" />
                {lobbyConv && lobbyConv.unread > 0 && (
                  <span
                    className={cn(
                      'absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-primary-foreground ring-2 ring-card',
                      mentionedConvIds.has(LOBBY_ID) ? 'bg-rose-500' : 'bg-primary'
                    )}
                  >
                    {lobbyConv.unread > 9 ? '9+' : lobbyConv.unread}
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
                    <span className="truncate">Lobby</span>
                    <span
                      className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_2px_var(--card)]"
                      title="Live — open to everyone"
                      aria-label="Live"
                    />
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {lobbyConv?.lastMessage ? timeLabel(lobbyConv.lastMessage.createdAt) : 'always on'}
                  </span>
                </span>
                <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs">
                  {mentionedConvIds.has(LOBBY_ID) && (
                    <span
                      className="shrink-0 rounded bg-rose-500/15 px-1 py-px text-[10px] font-bold text-rose-500"
                      title="You were mentioned in the latest lobby message"
                    >
                      @ you
                    </span>
                  )}
                  <span className="min-w-0 truncate text-emerald-500/90">{LOBBY_TAGLINE}</span>
                </span>
              </span>
            </motion.button>

            {loggedIn ? (
              searchQ.trim().length >= 2 ? (
              /* ------------------------- message search results */
              searching ? (
                <div className="space-y-2 p-1">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-14 w-full rounded-xl" />
                  ))}
                </div>
              ) : !searchResults || searchResults.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  No messages matching “{searchQ.trim()}”
                </div>
              ) : (
                <ul className="space-y-0.5">
                  {searchResults.map((r) => {
                    const label = r.conversation.type === 'lobby'
                      ? 'Lobby'
                      : r.conversation.type === 'group'
                        ? r.conversation.name ?? 'Study group'
                        : r.conversation.otherName ?? 'Direct message'
                    return (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSearchQ('')
                            void openConversation(r.conversation.id)
                          }}
                          className="w-full rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-muted"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
                              {r.conversation.type === 'group' && <Hash className="mr-0.5 inline h-3 w-3 text-muted-foreground" />}
                              {label}
                            </span>
                            <span className="shrink-0 text-[10px] text-muted-foreground">{timeLabel(r.createdAt)}</span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                            <span className="font-medium text-foreground/80">{r.senderName}: </span>
                            {snippetOf(r.body, searchQ.trim())}
                          </p>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )
            ) : convLoading && !conversations ? (
              <div className="space-y-2 p-1">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3.5 w-2/3" />
                      <Skeleton className="h-3 w-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : convError && !conversations ? (
              <div className="p-4 text-center text-sm text-muted-foreground">{convError}</div>
            ) : !filtered || filtered.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <MessageSquare className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">{filter === 'all' ? 'No chats yet' : `No ${filter === 'dm' ? 'direct messages' : 'groups'} yet`}</p>
                  <p className="mt-1 text-xs text-muted-foreground">The Lobby above is always open — start a DM or create a study group.</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setNewChatOpen(true)} className="gap-1.5">
                  <MessageSquarePlus className="h-3.5 w-3.5" /> New chat
                </Button>
              </div>
            ) : (
              <ul className="space-y-0.5">
                {filtered.map((c) => {
                  const title = conversationTitle(c, meId)
                  const isActive = c.id === activeId
                  const dmOther = c.type === 'dm' ? c.members.find((m) => m.id !== meId) : null
                  const dmOnline = dmOther ? isOnline(dmOther.lastSeenAt) : false
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => void openConversation(c.id)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors',
                          isActive ? 'bg-primary/12' : 'hover:bg-muted'
                        )}
                      >
                        <span
                          className={cn(
                            'relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-xs font-bold text-white',
                            gradientFor(c.id)
                          )}
                        >
                          {c.type === 'group' ? <Hash className="h-4 w-4" /> : initialsOf(title)}
                          {c.unread > 0 && (
                            <span
                              className={cn(
                                'absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-primary-foreground ring-2 ring-card',
                                mentionedConvIds.has(c.id) ? 'bg-rose-500' : 'bg-primary'
                              )}
                            >
                              {c.unread > 9 ? '9+' : c.unread}
                            </span>
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className={cn('flex min-w-0 items-center gap-1.5 text-sm', c.unread > 0 ? 'font-semibold' : 'font-medium')}>
                              <span className="min-w-0 flex-1 truncate">{title}</span>
                              {dmOnline && (
                                <span
                                  className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_2px_var(--card)]"
                                  title="Online"
                                />
                              )}
                            </span>
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {c.lastMessage ? timeLabel(c.lastMessage.createdAt) : ''}
                            </span>
                          </span>
                          <span className={cn('mt-0.5 flex min-w-0 items-center gap-1.5 text-xs', c.unread > 0 ? 'text-foreground/80' : 'text-muted-foreground')}>
                            {mentionedConvIds.has(c.id) && (
                              <span
                                className="shrink-0 rounded bg-rose-500/15 px-1 py-px text-[10px] font-bold text-rose-500"
                                title="You were mentioned in the latest message"
                              >
                                @ you
                              </span>
                            )}
                            <span className="min-w-0 truncate">{previewOf(c, meId)}</span>
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )
            ) : (
              <div className="px-1">
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className="rounded-xl border border-primary/25 bg-primary/[0.06] p-3"
                >
                  <p className="text-xs font-semibold text-foreground">Sign in to unlock DMs, groups &amp; mentions</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    The lobby above is open to everyone. A free account adds reactions, typing indicators, @mentions and private chats.
                  </p>
                  <Button size="sm" className="mt-2.5 w-full gap-1.5" onClick={() => navigate('/profile')}>
                    <LogIn className="h-3.5 w-3.5" /> Sign in / Create account
                  </Button>
                </motion.div>
                <p className="mt-3 px-1 text-[11px] leading-relaxed text-muted-foreground">
                  Guest posting is rate-limited to a few messages a minute — keep it friendly.
                </p>
              </div>
            )}
          </div>
        </aside>

        {/* ------------------------------------------------ chat pane */}
        <section className={cn('relative min-h-0 min-w-0 flex-col md:flex', activeId ? 'flex' : 'hidden')}>
          {!activeId ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                <MessageSquare className="h-7 w-7 text-primary" />
              </div>
              <div>
                <p className="font-medium">Your conversations</p>
                <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
                  Pick a chat on the left, or start a new one — discuss doubts, share strategies, build a group.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* chat header */}
              <header className="flex items-center gap-3 border-b px-3 py-2.5 sm:px-4">
                <button
                  type="button"
                  onClick={() => setActiveId(null)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted md:hidden"
                  aria-label="Back to conversations"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <span
                  className={cn(
                    'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-xs font-bold text-white',
                    isLobbyChat ? 'from-emerald-400/90 to-teal-500/90' : gradientFor(activeId)
                  )}
                >
                  {isLobbyChat ? (
                    <Globe2 className="h-4 w-4" />
                  ) : meta?.type === 'group' ? (
                    <Hash className="h-4 w-4" />
                  ) : meta ? (
                    initialsOf(activeTitle)
                  ) : (
                    '…'
                  )}
                  {isLobbyChat ? (
                    <span
                      className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-card"
                      title="Live — open to everyone"
                    />
                  ) : (
                    meta?.type === 'dm' &&
                    (() => {
                      const other = meta.members.find((m) => m.id !== meId)
                      return isOnline(other?.lastSeenAt) ? (
                        <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-card" />
                      ) : null
                    })()
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{messagesLoading && !meta ? 'Loading…' : activeTitle}</p>
                  {typing.length > 0 ? (
                    <p className="flex items-center gap-1 truncate text-xs font-medium text-primary">
                      {meta?.type === 'group'
                        ? `${typing.map((t) => t.name.split(' ')[0]).slice(0, 2).join(', ')}${typing.length > 2 ? ` +${typing.length - 2}` : ''} typing`
                        : 'typing'}
                      <span className="inline-flex items-end gap-[2px] pb-[3px]" aria-hidden>
                        {[0, 1, 2].map((i) => (
                          <span
                            key={i}
                            className="h-1 w-1 animate-bounce rounded-full bg-primary"
                            style={{ animationDelay: `${i * 150}ms`, animationDuration: '900ms' }}
                          />
                        ))}
                      </span>
                    </p>
                  ) : (
                    <p className="truncate text-xs text-muted-foreground">
                      {isLobbyChat
                        ? `${LOBBY_TAGLINE}${loggedIn && meta ? ` · ${meta.members.length} member${meta.members.length === 1 ? '' : 's'}` : ''}`
                        : meta?.type === 'group'
                          ? `${meta.members.length} member${meta.members.length === 1 ? '' : 's'} · ${meta.members.slice(0, 3).map((m) => m.name.split(' ')[0]).join(', ')}${meta.members.length > 3 ? ` +${meta.members.length - 3}` : ''}`
                          : meta
                            ? (() => {
                                const other = meta.members.find((m) => m.id !== meId)
                                return isOnline(other?.lastSeenAt) ? 'online' : lastSeenLabel(other?.lastSeenAt)
                              })()
                            : ''}
                    </p>
                  )}
                </div>
                {meta?.type === 'group' && (
                  <Button variant="ghost" size="sm" onClick={() => setAddMembersOpen(true)} className="gap-1.5">
                    <UserPlus className="h-4 w-4" /> <span className="hidden sm:inline">Add</span>
                  </Button>
                )}
                {meta?.type === 'group' && meta.myRole === 'admin' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setRenameValue(meta.name ?? '')
                      setRenameOpen(true)
                    }}
                    aria-label="Rename group"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
                {meta && meta.type !== 'lobby' && (
                  <Button variant="ghost" size="sm" onClick={() => setConfirmLeave(true)} className="text-muted-foreground hover:text-destructive">
                    {meta?.type === 'dm' ? <X className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}
                    <span className="hidden sm:inline">{meta?.type === 'dm' ? 'Delete' : 'Leave'}</span>
                  </Button>
                )}
              </header>

              {/* messages */}
              <div ref={listRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5">
                {messagesError ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{messagesError}</div>
                ) : messagesLoading ? (
                  <div className="space-y-3">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className={cn('flex', i % 2 === 0 ? 'justify-start' : 'justify-end')}>
                        <Skeleton className={cn('h-12 rounded-2xl', i % 2 === 0 ? 'w-2/5' : 'w-1/3')} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    {hasMore && (
                      <div className="mb-3 flex justify-center">
                        <Button variant="outline" size="sm" onClick={() => void loadEarlier()} disabled={loadingEarlier} className="gap-1.5 text-xs">
                          {loadingEarlier ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowDownToLine className="h-3.5 w-3.5 rotate-180" />}
                          Load earlier messages
                        </Button>
                      </div>
                    )}
                    {messages.length === 0 && (
                      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                          <MessageSquare className="h-6 w-6 text-primary" />
                        </div>
                        <p className="text-sm font-medium">No messages yet</p>
                        <p className="text-xs text-muted-foreground">Be the first to say hello.</p>
                      </div>
                    )}
                    {messages.map((m, i) => {
                      const prev = messages[i - 1]
                      // guests "own" messages matching their ephemeral name;
                      // signed-in users own by account id
                      const own = loggedIn ? m.senderId === meId : Boolean(m.isGuest && m.senderName === guestName)
                      const deleted = Boolean(m.deleted)
                      const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString()
                      const senderChanged = !prev || prev.senderId !== m.senderId || prev.senderName !== m.senderName || newDay
                      const showName = !own && groupLike && senderChanged
                      const senderSeed = m.senderId ?? m.senderName // guests have no id
                      // "Seen" receipt: my last message in a DM, once the other
                      // member's lastReadAt reaches its createdAt
                      const dmOther = meta?.type === 'dm' ? meta.members.find((mem) => mem.id !== meId) : null
                      const isMyLast = own && i === messages.length - 1
                      const seen = Boolean(
                        isMyLast &&
                          !deleted &&
                          dmOther?.lastReadAt &&
                          new Date(dmOther.lastReadAt).getTime() >= new Date(m.createdAt).getTime()
                      )
                      return (
                        <div key={m.id} data-mid={m.id} className={cn('rounded-xl transition-colors', highlightId === m.id && 'bg-primary/10 ring-1 ring-primary/40')}>
                          {newDay && (
                            <div className="my-4 flex items-center gap-3">
                              <span className="h-px flex-1 bg-border" />
                              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{dayLabel(m.createdAt)}</span>
                              <span className="h-px flex-1 bg-border" />
                            </div>
                          )}
                          <motion.div
                            initial={initialLoadDone.current ? { opacity: 0, y: 6 } : false}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.15 }}
                            className={cn('group/msg flex items-end gap-2', own ? 'justify-end' : 'justify-start', showName ? 'mt-2.5' : 'mt-0.5')}
                          >
                            {!own && (
                              <span
                                className={cn(
                                  'hidden h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[10px] font-bold text-white sm:flex',
                                  gradientFor(senderSeed),
                                  senderChanged ? 'opacity-100' : 'opacity-0'
                                )}
                                aria-hidden={!senderChanged}
                              >
                                {initialsOf(m.senderName)}
                              </span>
                            )}
                            <div className={cn('relative max-w-[78%] sm:max-w-[68%]', own ? 'items-end' : 'items-start')}>
                              {showName && (
                                <p className="mb-0.5 flex items-center gap-1.5 pl-1">
                                  <span className="text-[11px] font-semibold" style={{ color: `var(--chart-${(senderSeed.charCodeAt(0) % 5) + 1})` }}>
                                    {m.senderName}
                                  </span>
                                  {m.isGuest && (
                                    <span
                                      className="rounded bg-muted-foreground/15 px-1 py-px text-[9px] font-bold uppercase tracking-wider text-muted-foreground"
                                      title="Posted without an account"
                                    >
                                      Guest
                                    </span>
                                  )}
                                </p>
                              )}
                              {deleted ? (
                                /* ---------- tombstone ---------- */
                                <div
                                  className={cn(
                                    'flex items-center gap-1.5 whitespace-pre-wrap break-words rounded-2xl border border-dashed px-3.5 py-2 text-sm italic leading-relaxed text-muted-foreground',
                                    own ? 'rounded-br-md' : 'rounded-bl-md'
                                  )}
                                  title={new Date(m.createdAt).toLocaleString()}
                                >
                                  <Ban className="h-3.5 w-3.5 shrink-0" />
                                  This message was deleted
                                </div>
                              ) : (
                                <div
                                  className={cn(
                                    'whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
                                    own
                                      ? 'rounded-br-md bg-primary text-primary-foreground'
                                      : 'rounded-bl-md bg-muted text-foreground'
                                  )}
                                  title={new Date(m.createdAt).toLocaleString()}
                                >
                                  {m.replyTo && (
                                    <button
                                      type="button"
                                      onClick={() => scrollToMessage(m.replyTo!.id)}
                                      className={cn(
                                        'mb-1.5 flex w-full items-stretch gap-1.5 overflow-hidden rounded-lg text-left',
                                        own ? 'bg-black/15' : 'bg-background/70'
                                      )}
                                      aria-label={`Jump to the message from ${m.replyTo.senderName}`}
                                    >
                                      <span className={cn('w-0.5 shrink-0', own ? 'bg-primary-foreground/60' : 'bg-primary/60')} />
                                      <span className="min-w-0 py-1 pr-2">
                                        <span className={cn('block truncate text-[11px] font-semibold', own ? 'text-primary-foreground/90' : 'text-primary')}>
                                          {m.replyTo.senderName}
                                        </span>
                                        <span className={cn('block truncate text-xs', own ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                                          {m.replyTo.deleted ? (
                                            'Message deleted'
                                          ) : (
                                            renderMentionText(m.replyTo.body || '(no text)', own, true)
                                          )}
                                        </span>
                                      </span>
                                    </button>
                                  )}
                                  {renderMentionText(m.body, own, false)}
                                </div>
                              )}
                              {pickerFor === m.id && (
                                <div
                                  className={cn(
                                    'absolute z-20 flex -translate-y-full items-center gap-0.5 rounded-xl border bg-popover p-1 shadow-lg',
                                    own ? 'right-0' : 'left-0 sm:left-8'
                                  )}
                                  style={{ top: '-0.4rem' }}
                                  role="menu"
                                  aria-label="Pick a reaction"
                                >
                                  {REACTION_EMOJIS.map((e) => (
                                    <button
                                      key={e}
                                      type="button"
                                      onClick={() => void toggleReaction(m.id, e)}
                                      className="rounded-lg p-1 text-base leading-none transition-transform hover:scale-125 hover:bg-muted"
                                      aria-label={`React ${e}`}
                                    >
                                      {e}
                                    </button>
                                  ))}
                                </div>
                              )}
                              {!deleted && reactions[m.id]?.length > 0 && (
                                <div className={cn('mt-1 flex flex-wrap gap-1', own ? 'justify-end' : 'justify-start')}>
                                  {reactions[m.id].map((chip) =>
                                    guestView ? (
                                      /* guests see reactions read-only — reacting needs an account */
                                      <span
                                        key={chip.emoji}
                                        className="flex items-center gap-0.5 rounded-full border border-border bg-background px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground"
                                        aria-label={`${chip.emoji} ${chip.count} reactions`}
                                        title="Sign in to react"
                                      >
                                        <span className="text-xs leading-none">{chip.emoji}</span>
                                        <span className="font-medium">{chip.count}</span>
                                      </span>
                                    ) : (
                                      <button
                                        key={chip.emoji}
                                        type="button"
                                        onClick={() => void toggleReaction(m.id, chip.emoji)}
                                        className={cn(
                                          'flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[11px] leading-none transition-colors',
                                          chip.mine
                                            ? 'border-primary/60 bg-primary/10 text-foreground'
                                            : 'border-border bg-background text-muted-foreground hover:border-primary/40'
                                        )}
                                        aria-label={`${chip.emoji} ${chip.count} — ${chip.mine ? 'remove your reaction' : 'react too'}`}
                                      >
                                        <span className="text-xs leading-none">{chip.emoji}</span>
                                        <span className={cn('font-medium', chip.mine && 'text-primary')}>{chip.count}</span>
                                      </button>
                                    )
                                  )}
                                </div>
                              )}
                              {!deleted && (
                                <div className={cn('mt-0.5 flex items-center gap-1.5 px-1', own ? 'justify-end' : 'justify-start')}>
                                  {!guestView && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setReplyTo(m)
                                        setEmojiOpen(false)
                                        composerRef.current?.focus()
                                      }}
                                      className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/msg:opacity-100"
                                      aria-label={`Reply to ${m.senderName}`}
                                    >
                                      <CornerUpLeft className="h-3 w-3" />
                                    </button>
                                  )}
                                  {!guestView && (
                                    <button
                                      type="button"
                                      onClick={() => setPickerFor((p) => (p === m.id ? null : m.id))}
                                      className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/msg:opacity-100"
                                      aria-label="Add reaction"
                                    >
                                      <Smile className="h-3 w-3" />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void navigator.clipboard.writeText(m.body)
                                      toast({ title: 'Message copied' })
                                    }}
                                    className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/msg:opacity-100"
                                    aria-label="Copy message"
                                  >
                                    <Copy className="h-3 w-3" />
                                  </button>
                                  {/* guest messages cannot be deleted after send
                                      (DELETE requires an account) — hide the affordance */}
                                  {own && loggedIn && (
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDelete(m.id)}
                                      className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover/msg:opacity-100"
                                      aria-label="Delete message"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  )}
                                  <p className="text-[11px] text-muted-foreground">{clockLabel(m.createdAt)}</p>
                                  {seen && (
                                    <span className="flex items-center gap-0.5 text-[10px] font-medium text-primary">
                                      <CheckCheck className="h-3 w-3" /> Seen
                                    </span>
                                  )}
                                </div>
                              )}
                              {deleted && (
                                <p className={cn('mt-0.5 px-1 text-[11px] text-muted-foreground/60', own ? 'text-right' : 'text-left')}>
                                  {clockLabel(m.createdAt)}
                                </p>
                              )}
                            </div>
                          </motion.div>
                        </div>
                      )
                    })}
                    {typing.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mt-1.5 flex items-end gap-2"
                      >
                        <span
                          className={cn(
                            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[10px] font-bold text-white',
                            gradientFor(typing[0].userId)
                          )}
                        >
                          {initialsOf(typing[0].name)}
                        </span>
                        <div className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-muted px-4 py-3" aria-label={`${typing[0].name} is typing`}>
                          {[0, 1, 2].map((i) => (
                            <span
                              key={i}
                              className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/70"
                              style={{ animationDelay: `${i * 150}ms`, animationDuration: '900ms' }}
                            />
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </>
                )}
              </div>

              {/* jump to latest */}
              {showJump && (
                <button
                  type="button"
                  onClick={() => {
                    stickToBottom.current = true
                    setShowJump(false)
                    const el = listRef.current
                    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
                  }}
                  className="absolute bottom-24 right-6 flex h-9 w-9 items-center justify-center rounded-full border bg-card text-foreground shadow-lg transition-transform hover:scale-105"
                  aria-label="Jump to latest messages"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
              )}

              {/* composer */}
              <div className="border-t p-2.5 sm:p-3">
                {guestView && guestEditing && (
                  /* ---------------- guest name editor ---------------- */
                  <div className="mb-2 flex items-center gap-2">
                    <Input
                      value={guestDraft}
                      onChange={(e) => setGuestDraft(e.target.value)}
                      maxLength={24}
                      placeholder="Your display name (2-24 characters)"
                      aria-label="Your guest display name"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          saveGuestName()
                        }
                        if (e.key === 'Escape') setGuestEditing(false)
                      }}
                      className="h-10 min-h-[44px] flex-1"
                    />
                    <span className="shrink-0 text-[10px] text-muted-foreground">{guestDraft.trim().length}/24</span>
                    <Button type="button" variant="outline" size="icon" onClick={() => setGuestEditing(false)} aria-label="Cancel name edit" className="h-10 w-10 shrink-0">
                      <X className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      onClick={saveGuestName}
                      disabled={guestDraft.trim().length < 2}
                      aria-label="Save guest name"
                      className="h-10 w-10 shrink-0"
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                {replyTo && (
                  <div className="mb-2 flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-2.5 py-1.5">
                    <CornerUpLeft className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <button
                      type="button"
                      onClick={() => scrollToMessage(replyTo.id)}
                      className="min-w-0 flex-1 text-left"
                      aria-label="Jump to the message you are replying to"
                    >
                      <span className="block text-[11px] font-semibold text-primary">
                        Replying to {replyTo.senderId === meId ? 'yourself' : replyTo.senderName}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {replyTo.deleted ? 'Message deleted' : replyTo.body}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setReplyTo(null)}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="Cancel reply"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                {guestView ? (
                  /* --------- guest composer: name chip + textarea + send --------- */
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      void sendMessage()
                    }}
                    className="flex items-end gap-2"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setGuestDraft(guestName)
                        setGuestEditing(true)
                      }}
                      className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:border-primary/50"
                      title="Edit your guest name"
                      aria-label="Edit your guest name"
                    >
                      <span
                        className={cn(
                          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[9px] font-bold text-white',
                          gradientFor(guestName || 'Guest')
                        )}
                      >
                        {initialsOf(guestName || 'Guest')}
                      </span>
                      <span className="max-w-[88px] truncate sm:max-w-[140px]">{guestName || 'Guest'}</span>
                      <Pencil className="h-3 w-3 shrink-0 text-muted-foreground" />
                    </button>
                    <textarea
                      ref={composerRef}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onInput={(e) => {
                        const el = e.target as HTMLTextAreaElement
                        el.style.height = 'auto'
                        el.style.height = `${Math.min(el.scrollHeight, 132)}px`
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          void sendMessage()
                        }
                      }}
                      rows={1}
                      maxLength={2000}
                      placeholder={`Say hi as ${guestName || 'Guest'}…`}
                      aria-label="Message the lobby as a guest"
                      className="max-h-[132px] min-h-[44px] w-full resize-none rounded-xl border-input bg-background px-3.5 py-2.5 text-sm outline-none ring-ring transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 disabled:opacity-50"
                    />
                    <Button
                      type="submit"
                      disabled={!draft.trim() || sending}
                      className="h-11 min-h-[44px] w-11 shrink-0 rounded-xl"
                      aria-label="Send message"
                    >
                      {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                  </form>
                ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    void sendMessage()
                  }}
                  className="flex items-end gap-2"
                >
                  <div className="relative flex items-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setEmojiOpen((v) => !v)}
                      aria-label="Insert emoji"
                      aria-expanded={emojiOpen}
                      className="h-10 w-9 shrink-0 rounded-xl text-muted-foreground hover:text-foreground"
                    >
                      <Smile className="h-5 w-5" />
                    </Button>
                    {emojiOpen && (
                      <div
                        className="absolute bottom-12 left-0 z-30 w-64 rounded-xl border bg-popover p-2 shadow-lg"
                        role="menu"
                        aria-label="Pick an emoji"
                      >
                        <div className="grid grid-cols-8 gap-0.5">
                          {COMPOSER_EMOJIS.map((e) => (
                            <button
                              key={e}
                              type="button"
                              onClick={() => {
                                setDraft((d) => (d.length + e.length > 2000 ? d : d + e))
                                composerRef.current?.focus()
                              }}
                              className="rounded-lg p-1 text-lg leading-none transition-transform hover:scale-125 hover:bg-muted"
                              aria-label={`Insert ${e}`}
                            >
                              {e}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => setEmojiOpen(false)}
                          className="mt-1.5 w-full rounded-lg py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          Close
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="relative min-w-0 flex-1">
                    {mention && mentionCandidates.length > 0 && (
                      <div
                        className="absolute bottom-full left-0 z-30 mb-1 w-64 overflow-hidden rounded-xl border bg-popover shadow-lg"
                        role="listbox"
                        aria-label="Mention a member"
                      >
                        {mentionCandidates.map((m, i) => (
                          <button
                            key={m.id}
                            type="button"
                            role="option"
                            aria-selected={i === mentionIdx}
                            onMouseDown={(e) => {
                              e.preventDefault() // keep textarea focus
                              acceptMention(m.name)
                            }}
                            onMouseEnter={() => setMentionIdx(i)}
                            className={cn(
                              'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                              i === mentionIdx ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
                            )}
                          >
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold uppercase text-primary">
                              {m.name.slice(0, 1)}
                            </span>
                            <span className="truncate">{m.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <textarea
                      ref={composerRef}
                      value={draft}
                      onChange={(e) => onDraftChange(e.target.value)}
                      onInput={(e) => {
                        const el = e.target as HTMLTextAreaElement
                        el.style.height = 'auto'
                        el.style.height = `${Math.min(el.scrollHeight, 132)}px`
                      }}
                      onKeyDown={(e) => {
                        if (mention && mentionCandidates.length > 0) {
                          if (e.key === 'ArrowDown') {
                            e.preventDefault()
                            setMentionIdx((i) => (i + 1) % mentionCandidates.length)
                            return
                          }
                          if (e.key === 'ArrowUp') {
                            e.preventDefault()
                            setMentionIdx((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length)
                            return
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault()
                            setMention(null)
                            return
                          }
                          if (e.key === 'Enter' || e.key === 'Tab') {
                            e.preventDefault()
                            acceptMention(mentionCandidates[Math.min(mentionIdx, mentionCandidates.length - 1)].name)
                            return
                          }
                        }
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          void sendMessage()
                        }
                      }}
                      rows={1}
                      maxLength={2000}
                      placeholder={canMention ? `Message ${activeTitle}… (@ to mention)` : 'Type a message…'}
                      className="max-h-[132px] min-h-[40px] w-full resize-none rounded-xl border-input bg-background px-3.5 py-2.5 text-sm outline-none ring-ring transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 disabled:opacity-50"
                    />
                  </div>
                  <Button type="submit" size="icon" disabled={!draft.trim() || sending} className="h-10 w-10 shrink-0 rounded-xl" aria-label="Send message">
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </form>
                )}
                {draft.length > 1800 && (
                  <p className="mt-1 text-right text-[10px] text-muted-foreground">{draft.length}/2000</p>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {/* ------------------------------------------------ modals */}
      <NewChatDialog
        open={newChatOpen}
        onOpenChange={setNewChatOpen}
        onOpened={(id) => {
          setNewChatOpen(false)
          void refreshConversations()
          void openConversation(id)
        }}
      />

      {meta && meta.type === 'group' && (
        <AddMembersDialog
          open={addMembersOpen}
          onOpenChange={setAddMembersOpen}
          conversation={meta}
          onAdded={(n) => {
            setAddMembersOpen(false)
            toast({ title: `${n} member${n === 1 ? '' : 's'} added` })
            void refreshConversations()
            void openConversation(meta.id)
          }}
        />
      )}

      <Dialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{meta?.type === 'dm' ? 'Delete this chat?' : 'Leave this group?'}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {meta?.type === 'dm'
              ? 'The conversation and its messages will be removed for both members. This cannot be undone.'
              : 'You will stop receiving messages from this group. Other members keep the chat.'}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmLeave(false)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={() => void leaveConversation()} disabled={leaving}>
              {leaving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              {meta?.type === 'dm' ? 'Delete chat' : 'Leave group'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete !== null} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this message?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            It will be removed for everyone in this chat. Others will see “This message was deleted”.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={() => void deleteMessage()} disabled={deleting}>
              {deleting && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Delete for everyone
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename group</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            maxLength={60}
            placeholder="Group name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void renameGroup()
              }
            }}
          />
          <p className="text-right text-[10px] text-muted-foreground">{renameValue.trim().length}/60</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setRenameOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={() => void renameGroup()} disabled={renaming || !renameValue.trim() || renameValue.trim() === meta?.name}>
              {renaming ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Pencil className="mr-2 h-3.5 w-3.5" />}
              Save name
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------- new chat dialog

function UserResultRow({
  user,
  selected,
  onClick,
  right,
}: {
  user: { id: string; name: string; email: string }
  selected?: boolean
  onClick: () => void
  right?: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors',
        selected ? 'bg-primary/12' : 'hover:bg-muted'
      )}
    >
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-xs font-bold text-white', gradientFor(user.id))}>
        {initialsOf(user.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{user.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
      </span>
      {right ?? (selected ? <Check className="h-4 w-4 text-primary" /> : null)}
    </button>
  )
}

function useUserSearch(query: string) {
  const [results, setResults] = useState<{ id: string; name: string; email: string }[]>([])
  const [searching, setSearching] = useState(false)
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const r = await api<{ users: { id: string; name: string; email: string }[] }>(
          `/api/chat/users?q=${encodeURIComponent(q)}`
        )
        setResults(r.users)
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [query])
  return { results, searching }
}

function NewChatDialog({
  open,
  onOpenChange,
  onOpened,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onOpened: (conversationId: string) => void
}) {
  const { toast } = useToast()
  const [mode, setMode] = useState<'dm' | 'group'>('dm')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<{ id: string; name: string; email: string }[]>([])
  const [groupName, setGroupName] = useState('')
  const [busy, setBusy] = useState(false)
  const { results, searching } = useUserSearch(query)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setSelected([])
      setGroupName('')
      setMode('dm')
    }
  }, [open])

  const startDm = async (userId: string) => {
    setBusy(true)
    try {
      const r = await api<{ conversationId: string }>('/api/chat/conversations', { type: 'dm', userId })
      onOpened(r.conversationId)
    } catch (e) {
      toast({ title: 'Could not start chat', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const createGroup = async () => {
    setBusy(true)
    try {
      const r = await api<{ conversationId: string }>('/api/chat/conversations', {
        type: 'group',
        name: groupName.trim(),
        memberIds: selected.map((u) => u.id),
      })
      onOpened(r.conversationId)
    } catch (e) {
      toast({ title: 'Could not create group', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New chat</DialogTitle>
        </DialogHeader>

        <div className="flex gap-1.5 rounded-xl bg-muted p-1">
          {(['dm', 'group'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                'flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                mode === m ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {m === 'dm' ? 'Direct message' : 'Study group'}
            </button>
          ))}
        </div>

        {mode === 'group' && (
          <Input
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            maxLength={60}
            placeholder="Group name (e.g. Mechanics Doubt Squad)"
          />
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search students by name or email…"
            className="pl-9"
            autoFocus
          />
        </div>

        {mode === 'group' && selected.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selected.map((u) => (
              <span key={u.id} className="flex items-center gap-1.5 rounded-full bg-primary/12 py-1 pl-1.5 pr-2.5 text-xs font-medium text-primary">
                <span className={cn('flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br text-[9px] font-bold text-white', gradientFor(u.id))}>
                  {initialsOf(u.name)}
                </span>
                {u.name.split(' ')[0]}
                <button type="button" onClick={() => setSelected((s) => s.filter((x) => x.id !== u.id))} aria-label={`Remove ${u.name}`}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {query.trim().length < 2 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Type at least 2 characters to search.</p>
          ) : searching ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : results.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No students found.</p>
          ) : (
            results.map((u) => (
              <UserResultRow
                key={u.id}
                user={u}
                selected={mode === 'group' ? selected.some((s) => s.id === u.id) : undefined}
                onClick={() => {
                  if (mode === 'dm') {
                    void startDm(u.id)
                  } else {
                    setSelected((s) => (s.some((x) => x.id === u.id) ? s : [...s, u]))
                  }
                }}
              />
            ))
          )}
        </div>

        {mode === 'group' && (
          <Button onClick={() => void createGroup()} disabled={busy || !groupName.trim() || selected.length === 0} className="gap-1.5">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
            Create group {selected.length > 0 && `(${selected.length + 1})`}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- add members dialog

function AddMembersDialog({
  open,
  onOpenChange,
  conversation,
  onAdded,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  conversation: ConvMeta
  onAdded: (count: number) => void
}) {
  const { toast } = useToast()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<{ id: string; name: string; email: string }[]>([])
  const [busy, setBusy] = useState(false)
  const { results, searching } = useUserSearch(query)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setSelected([])
    }
  }, [open])

  const memberIds = new Set(conversation.members.map((m) => m.id))
  const candidates = results.filter((u) => !memberIds.has(u.id))

  const add = async () => {
    setBusy(true)
    try {
      const r = await api<{ added: number }>('/api/chat/members', {
        conversationId: conversation.id,
        userIds: selected.map((u) => u.id),
      })
      onAdded(r.added)
    } catch (e) {
      toast({ title: 'Could not add members', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add members</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search students…" className="pl-9" autoFocus />
        </div>
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selected.map((u) => (
              <span key={u.id} className="flex items-center gap-1.5 rounded-full bg-primary/12 py-1 pl-1.5 pr-2.5 text-xs font-medium text-primary">
                {u.name.split(' ')[0]}
                <button type="button" onClick={() => setSelected((s) => s.filter((x) => x.id !== u.id))} aria-label={`Remove ${u.name}`}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {query.trim().length < 2 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Type at least 2 characters to search.</p>
          ) : searching ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : candidates.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {results.length === 0 ? 'No students found.' : 'Everyone found is already in this group.'}
            </p>
          ) : (
            candidates.map((u) => (
              <UserResultRow
                key={u.id}
                user={u}
                selected={selected.some((s) => s.id === u.id)}
                onClick={() => setSelected((s) => (s.some((x) => x.id === u.id) ? s : [...s, u]))}
              />
            ))
          )}
        </div>
        <Button onClick={() => void add()} disabled={busy || selected.length === 0} className="gap-1.5">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
          Add {selected.length > 0 && `${selected.length} `}
          {selected.length === 1 ? 'member' : 'members'}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
