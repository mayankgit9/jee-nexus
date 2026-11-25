'use client'

// JEE NEXUS — command palette (Ctrl/Cmd+K): fast keyboard navigation across
// the app. Pure client-side: static actions + live taxonomy shortcuts.

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BarChart3, BookMarked, ClipboardList, CornerDownLeft, Dice5, Library, MessageSquare,
  Moon, Search, ShieldCheck, Sun, Trophy, User, Home,
} from 'lucide-react'
import type { SessionUser, SubjectKey } from '@/lib/types'
import { navigate } from '@/lib/client'
import { cn } from '@/lib/utils'

export interface TaxonomySubjectLite {
  key: SubjectKey
  name: string
  questionCount: number
}

interface Action {
  id: string
  label: string
  hint?: string
  group: string
  icon: React.ComponentType<{ className?: string }>
  run: () => void
  keywords?: string
}

export function CommandPalette(props: {
  open: boolean
  onOpenChange: (v: boolean) => void
  user: SessionUser | null
  taxonomy: TaxonomySubjectLite[] | null
  theme: 'dark' | 'light'
  onToggleTheme: () => void
}) {
  // keyed inner component: every open starts from fresh state (no reset effects)
  return (
    <AnimatePresence>
      {props.open && <PaletteInner key="cmdk" {...props} />}
    </AnimatePresence>
  )
}

function PaletteInner({
  onOpenChange,
  user,
  taxonomy,
  theme,
  onToggleTheme,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  user: SessionUser | null
  taxonomy: TaxonomySubjectLite[] | null
  theme: 'dark' | 'light'
  onToggleTheme: () => void
}) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const actions = useMemo<Action[]>(() => {
    const go = (to: string) => () => {
      navigate(to)
      onOpenChange(false)
    }
    const nav: Action[] = [
      { id: 'home', label: 'Home', group: 'Navigate', icon: Home, run: go('/home'), keywords: 'dashboard start' },
      { id: 'practice', label: 'Practice — surprise me', group: 'Navigate', icon: Dice5, run: go('/practice'), keywords: 'random questions quiz' },
      { id: 'pyq', label: 'PYQ Library', group: 'Navigate', icon: Library, run: go('/pyq'), keywords: 'previous year papers' },
      { id: 'mock', label: 'Mock Tests (CBT)', group: 'Navigate', icon: ClipboardList, run: go('/mock'), keywords: 'exam nta simulation' },
      { id: 'community', label: 'Community — chats & groups', group: 'Navigate', icon: MessageSquare, run: go('/community'), keywords: 'dm message group chat' },
      { id: 'leaderboard', label: 'Leaderboard', group: 'Navigate', icon: Trophy, run: go('/leaderboard'), keywords: 'rank ranking top students compete streak' },
      { id: 'performance', label: 'Performance', group: 'Navigate', icon: BarChart3, run: go('/performance'), keywords: 'analytics stats' },
      { id: 'bookmarks', label: 'Bookmarks', group: 'Navigate', icon: BookMarked, run: go('/bookmarks'), keywords: 'saved' },
      { id: 'profile', label: user ? 'Profile' : 'Sign in / Create account', group: 'Navigate', icon: User, run: go(user ? '/profile' : '/login'), keywords: 'account login signup' },
    ]
    if (user?.role === 'admin') {
      nav.push({ id: 'admin', label: 'Admin dashboard', group: 'Navigate', icon: ShieldCheck, run: go('/admin'), keywords: 'import questions' })
    }
    const subjects: Action[] = (taxonomy ?? []).map((s) => ({
      id: `pyq-${s.key}`,
      label: `PYQ · ${s.name}`,
      hint: s.questionCount > 0 ? `${s.questionCount.toLocaleString('en-IN')} questions` : undefined,
      group: 'Jump into PYQ',
      icon: Library,
      run: go(`/pyq/2025/${s.key}`),
      keywords: 'previous year subject',
    }))
    const prefs: Action[] = [
      {
        id: 'theme',
        label: theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
        group: 'Preferences',
        icon: theme === 'dark' ? Sun : Moon,
        run: () => {
          onToggleTheme()
          onOpenChange(false)
        },
        keywords: 'appearance theme dark light',
      },
    ]
    return [...nav, ...subjects, ...prefs]
  }, [user, taxonomy, theme, onOpenChange, onToggleTheme])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return actions
    // token-AND: every word must match somewhere ("physics pyq" → PYQ · Physics)
    const tokens = needle.split(/\s+/)
    return actions.filter((a) => {
      const hay = `${a.label} ${a.hint ?? ''} ${a.keywords ?? ''}`.toLowerCase()
      return tokens.every((t) => hay.includes(t))
    })
  }, [actions, q])

  // reset on open → handled by remount (keyed); focus on mount via rAF
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  // keep the highlighted row in view (read-only effect)
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      filtered[active]?.run()
    } else if (e.key === 'Escape') {
      onOpenChange(false)
    }
  }

  let lastGroup = ''

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/50 p-4 pt-[12vh] backdrop-blur-sm"
      onClick={() => onOpenChange(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="w-full max-w-lg overflow-hidden rounded-2xl border bg-popover shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 border-b px-4">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setActive(0)
                }}
                onKeyDown={onKey}
                placeholder="Search pages and actions…"
                className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                aria-label="Search commands"
              />
              <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">esc</kbd>
            </div>
            <div ref={listRef} className="max-h-[46vh] overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Nothing matches “{q.trim()}”.</p>
              ) : (
                filtered.map((a, i) => {
                  const header = a.group !== lastGroup ? a.group : null
                  lastGroup = a.group
                  const Icon = a.icon
                  return (
                    <div key={a.id}>
                      {header && (
                        <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {header}
                        </p>
                      )}
                      <button
                        type="button"
                        data-idx={i}
                        onMouseMove={() => setActive(i)}
                        onClick={() => a.run()}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                          i === active ? 'bg-primary/15 text-foreground' : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        <Icon className={cn('h-4 w-4 shrink-0', i === active && 'text-primary')} />
                        <span className="min-w-0 flex-1 truncate">
                          {a.label}
                          {a.hint && <span className="ml-2 text-[11px] text-muted-foreground">{a.hint}</span>}
                        </span>
                        {i === active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                      </button>
                    </div>
                  )
                })
              )}
            </div>
            <div className="flex items-center justify-between border-t px-4 py-2 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <kbd className="rounded border bg-muted px-1">↑</kbd>
                <kbd className="rounded border bg-muted px-1">↓</kbd> to move
                <kbd className="ml-1.5 rounded border bg-muted px-1">↵</kbd> to open
              </span>
              <span>{filtered.length} result{filtered.length === 1 ? '' : 's'}</span>
            </div>
          </motion.div>
        </motion.div>
  )
}
