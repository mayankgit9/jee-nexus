'use client'

// JEE NEXUS — Community view: direct messages + study group chats.
//
// Polling architecture (no websockets on Workers/OpenNext):
//   sidebar      GET /api/chat/conversations   every 10s
//   active chat  GET /api/chat/messages?after= every 3s (dedup by id)
// Both pause when the tab is hidden. All sends/reads are explicit REST calls.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowLeft, Check, Hash, Loader2, MessageSquare, MessageSquarePlus,
  Search, Send, Users, X, LogIn, UserPlus, ArrowDownToLine,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import type { SessionUser } from '@/lib/types'
import { api } from '@/lib/client'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------- types

interface ChatUser {
  id: string
  name: string
  email: string
  role?: string
}

interface Conversation {
  id: string
  type: 'dm' | 'group'
  name: string | null
  updatedAt: string
  myRole: string
  members: ChatUser[]
  lastMessage: { body: string; createdAt: string; senderId: string; senderName: string } | null
  unread: number
}

interface ChatMessage {
  id: string
  body: string
  createdAt: string
  senderId: string
  senderName: string
}

interface ConvMeta {
  id: string
  type: 'dm' | 'group'
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
  conversation: { id: string; type: 'dm' | 'group'; name: string | null; otherName: string | null }
}

type Filter = 'all' | 'dm' | 'group'

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
  onRequireAuth,
}: {
  user: SessionUser | null
  loggedIn: boolean
  onRequireAuth: () => void
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

  // composer
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const stickToBottom = useRef(true)
  const initialLoadDone = useRef(false)

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

  const markRead = useCallback(async (conversationId: string) => {
    await api('/api/chat/read', { conversationId }).catch(() => {})
    setConversations((prev) =>
      prev ? prev.map((c) => (c.id === conversationId ? { ...c, unread: 0 } : c)) : prev
    )
  }, [])

  /** open a conversation: load latest page + mark read */
  const openConversation = useCallback(
    async (id: string) => {
      setActiveId(id)
      setMessagesLoading(true)
      setMessagesError(null)
      setMessages([])
      setMeta(null)
      initialLoadDone.current = false
      try {
        const r = await api<{ conversation: ConvMeta; messages: ChatMessage[]; hasMore: boolean }>(
          `/api/chat/messages?conversationId=${encodeURIComponent(id)}`
        )
        setMeta(r.conversation)
        setMessages(r.messages)
        setHasMore(r.hasMore)
        stickToBottom.current = true
        void markRead(id)
      } catch (e) {
        setMessagesError((e as Error).message)
      } finally {
        setMessagesLoading(false)
      }
    },
    [markRead]
  )

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

  /** incremental poll for the open conversation */
  const pollNew = useCallback(async () => {
    if (!activeId || !messages.length) return
    const last = messages[messages.length - 1]
    try {
      const r = await api<{ messages: ChatMessage[] }>(
        `/api/chat/messages?conversationId=${encodeURIComponent(activeId)}&after=${encodeURIComponent(last.createdAt)}`
      )
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

  const sendMessage = useCallback(async () => {
    const body = draft.trim()
    if (!body || !activeId || sending) return
    setSending(true)
    try {
      const r = await api<{ message: ChatMessage }>('/api/chat/messages', {
        conversationId: activeId,
        body,
      })
      setDraft('')
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
  }, [draft, activeId, sending, meId, toast])

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
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140
  }, [])

  // ---------- derived ----------

  const filtered = useMemo(() => {
    if (!conversations) return null
    if (filter === 'all') return conversations
    return conversations.filter((c) => c.type === filter)
  }, [conversations, filter])

  const totalUnread = useMemo(
    () => (conversations ?? []).reduce((n, c) => n + c.unread, 0),
    [conversations]
  )

  const activeTitle = meta ? (meta.type === 'group' ? meta.name ?? 'Study group' : meta.members.find((m) => m.id !== meId)?.name ?? 'Direct message') : ''
  const rollingOut = (convError ?? messagesError ?? '').includes('not active on the live database')

  // ---------------------------------------------------------------- render

  if (!loggedIn) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-dashed border-border p-10 text-center">
        <MessageSquare className="mx-auto h-10 w-10 text-muted-foreground" />
        <h2 className="mt-4 text-lg font-semibold">Community needs an account</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in free to message other aspirants and join study groups — doubt solving is faster together.
        </p>
        <Button className="mt-5" onClick={onRequireAuth}>
          <LogIn className="mr-2 h-4 w-4" /> Sign in / Create account
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl">
      {/* page heading */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Community</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Direct messages and study groups {totalUnread > 0 && <span className="font-medium text-primary">· {totalUnread} unread</span>}
          </p>
        </div>
        <Button onClick={() => setNewChatOpen(true)} className="gap-1.5">
          <MessageSquarePlus className="h-4 w-4" /> New chat
        </Button>
      </div>

      {rollingOut && (
        <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-500 dark:text-amber-300">
          Community chat is rolling out to the live database — the tables are being migrated. Everything else keeps working; check back shortly.
        </div>
      )}

      <div className="grid h-[calc(100dvh-18rem)] overflow-hidden rounded-2xl border bg-card shadow-lg md:h-[calc(100dvh-12.5rem)] md:grid-cols-[300px_1fr]">
        {/* ------------------------------------------------ sidebar */}
        <aside className={cn('min-h-0 flex-col border-r md:flex', activeId ? 'hidden' : 'flex')}>
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

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {searchQ.trim().length >= 2 ? (
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
                    const label = r.conversation.type === 'group'
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
                            <span className="truncate text-xs font-semibold text-foreground">
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
                  <p className="mt-1 text-xs text-muted-foreground">Start a DM or create a study group.</p>
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
                            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground ring-2 ring-card">
                              {c.unread > 9 ? '9+' : c.unread}
                            </span>
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className={cn('truncate text-sm', c.unread > 0 ? 'font-semibold' : 'font-medium')}>
                              {title}
                            </span>
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {c.lastMessage ? timeLabel(c.lastMessage.createdAt) : ''}
                            </span>
                          </span>
                          <span className={cn('mt-0.5 block truncate text-xs', c.unread > 0 ? 'text-foreground/80' : 'text-muted-foreground')}>
                            {previewOf(c, meId)}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* ------------------------------------------------ chat pane */}
        <section className={cn('min-h-0 min-w-0 flex-col md:flex', activeId ? 'flex' : 'hidden')}>
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
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-xs font-bold text-white',
                    gradientFor(activeId)
                  )}
                >
                  {meta?.type === 'group' ? <Hash className="h-4 w-4" /> : meta ? initialsOf(activeTitle) : '…'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{messagesLoading && !meta ? 'Loading…' : activeTitle}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {meta?.type === 'group'
                      ? `${meta.members.length} member${meta.members.length === 1 ? '' : 's'} · ${meta.members.slice(0, 3).map((m) => m.name.split(' ')[0]).join(', ')}${meta.members.length > 3 ? ` +${meta.members.length - 3}` : ''}`
                      : meta
                        ? meta.members.find((m) => m.id !== meId)?.email ?? 'Direct message'
                        : ''}
                  </p>
                </div>
                {meta?.type === 'group' && (
                  <Button variant="ghost" size="sm" onClick={() => setAddMembersOpen(true)} className="gap-1.5">
                    <UserPlus className="h-4 w-4" /> <span className="hidden sm:inline">Add</span>
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setConfirmLeave(true)} className="text-muted-foreground hover:text-destructive">
                  {meta?.type === 'dm' ? <X className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}
                  <span className="hidden sm:inline">{meta?.type === 'dm' ? 'Delete' : 'Leave'}</span>
                </Button>
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
                ) : messages.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                      <MessageSquare className="h-6 w-6 text-primary" />
                    </div>
                    <p className="text-sm font-medium">No messages yet</p>
                    <p className="text-xs text-muted-foreground">Be the first to say hello.</p>
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
                    {messages.map((m, i) => {
                      const prev = messages[i - 1]
                      const own = m.senderId === meId
                      const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString()
                      const senderChanged = !prev || prev.senderId !== m.senderId || newDay
                      const showName = !own && meta?.type === 'group' && senderChanged
                      return (
                        <div key={m.id}>
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
                            className={cn('flex items-end gap-2', own ? 'justify-end' : 'justify-start', showName ? 'mt-2.5' : 'mt-0.5')}
                          >
                            {!own && (
                              <span
                                className={cn(
                                  'hidden h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[10px] font-bold text-white sm:flex',
                                  gradientFor(m.senderId),
                                  senderChanged ? 'opacity-100' : 'opacity-0'
                                )}
                                aria-hidden={!senderChanged}
                              >
                                {initialsOf(m.senderName)}
                              </span>
                            )}
                            <div className={cn('max-w-[78%] sm:max-w-[68%]', own ? 'items-end' : 'items-start')}>
                              {showName && (
                                <p className="mb-0.5 pl-1 text-[11px] font-semibold" style={{ color: `var(--chart-${(m.senderId.charCodeAt(0) % 5) + 1})` }}>
                                  {m.senderName}
                                </p>
                              )}
                              <div
                                className={cn(
                                  'whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
                                  own
                                    ? 'rounded-br-md bg-primary text-primary-foreground'
                                    : 'rounded-bl-md bg-muted text-foreground'
                                )}
                                title={new Date(m.createdAt).toLocaleString()}
                              >
                                {m.body}
                              </div>
                              <p className={cn('mt-0.5 px-1 text-[10px] text-muted-foreground', own ? 'text-right' : 'text-left')}>
                                {clockLabel(m.createdAt)}
                              </p>
                            </div>
                          </motion.div>
                        </div>
                      )
                    })}
                  </>
                )}
              </div>

              {/* composer */}
              <div className="border-t p-2.5 sm:p-3">
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    void sendMessage()
                  }}
                  className="flex items-end gap-2"
                >
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
                    placeholder={meta?.type === 'group' ? `Message ${activeTitle}…` : 'Type a message…'}
                    className="max-h-[132px] min-h-[40px] flex-1 resize-none rounded-xl border-input bg-background px-3.5 py-2.5 text-sm outline-none ring-ring transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 disabled:opacity-50"
                  />
                  <Button type="submit" size="icon" disabled={!draft.trim() || sending} className="h-10 w-10 shrink-0 rounded-xl" aria-label="Send message">
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </form>
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
