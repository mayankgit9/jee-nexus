'use client'

// JEE NEXUS — application shell (hash-routed SPA)
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Home, Dice5, Library, BarChart3, BookMarked, User, LogIn, LogOut, Moon, Sun, Menu, X,
  ClipboardList, ShieldCheck, MessageSquare, MoreHorizontal, Search, Trophy, ChevronDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { HomeView } from '@/components/views/HomeView'
import { PracticeView } from '@/components/views/PracticeView'
import { PyqView } from '@/components/views/PyqView'
import { PerformanceView } from '@/components/views/PerformanceView'
import { BookmarksView } from '@/components/views/BookmarksView'
import { ProfileView } from '@/components/views/ProfileView'
import { MockView } from '@/components/views/MockView'
import { AdminView } from '@/components/views/AdminView'
import { CommunityView } from '@/components/views/CommunityView'
import { LeaderboardView } from '@/components/views/LeaderboardView'
import { CommandPalette } from '@/components/CommandPalette'
import type { SessionUser, SubjectKey } from '@/lib/types'
import { useHashRoute, useApi, navigate, api } from '@/lib/client'
import { toast } from '@/hooks/use-toast'
import { ToastAction } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

interface TaxonomySubject {
  key: SubjectKey
  name: string
  icon: string
  questionCount: number
  chapters: { key: string; name: string; unit: string | null; questionCount: number }[]
}

const NAV = [
  { view: 'home', label: 'Home', icon: Home },
  { view: 'practice', label: 'Practice', icon: Dice5 },
  { view: 'pyq', label: 'PYQ Library', icon: Library },
  { view: 'mock', label: 'Mock Tests', icon: ClipboardList },
  { view: 'community', label: 'Community', icon: MessageSquare },
  { view: 'leaderboard', label: 'Leaderboard', icon: Trophy },
  { view: 'performance', label: 'Performance', icon: BarChart3 },
  { view: 'bookmarks', label: 'Bookmarks', icon: BookMarked },
] as const

const ADMIN_NAV = { view: 'admin', label: 'Admin', icon: ShieldCheck }

// Mobile bottom tab bar: 4 primary destinations + "More" sheet.
const TAB_NAV = [
  { view: 'home', label: 'Home', icon: Home },
  { view: 'practice', label: 'Practice', icon: Dice5 },
  { view: 'pyq', label: 'PYQ', icon: Library },
  { view: 'community', label: 'Chats', icon: MessageSquare },
] as const

export default function App() {
  const route = useHashRoute()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [mobileNav, setMobileNav] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [chatUnread, setChatUnread] = useState(0)
  const taxonomyApi = useApi<{ subjects: TaxonomySubject[] }>('/api/taxonomy')

  useEffect(() => {
    api_me()
    async function api_me() {
      try {
        const r = await (await fetch('/api/auth/me')).json()
        setUser(r.user ?? null)
      } catch {
        setUser(null)
      } finally {
        setAuthChecked(true)
      }
    }
  }, [])

  useEffect(() => {
    document.documentElement.className = theme
  }, [theme])

  useEffect(() => {
    setMobileNav(false)
  }, [route.view])

  // Global chat-unread badge + notification toasts: poll /api/chat/unread
  // every 15s while signed in (skips hidden tabs; resets on logout). The
  // badge surfaces pending DMs/group messages from ANY view; when the count
  // GROWS between polls we also raise a toast with the newest message so
  // users notice conversations without watching the badge. First fetch is a
  // baseline (no toast on load); while on the community view the in-app
  // sidebar already shows unread state, so toasts stay suppressed there.
  const lastUnreadRef = useRef<number | null>(null)
  useEffect(() => {
    if (!user) {
      setChatUnread(0)
      lastUnreadRef.current = null
      return
    }
    let alive = true
    const tick = async () => {
      if (document.hidden || !alive) return
      try {
        const r = await fetch('/api/chat/unread')
        if (!r.ok) return
        const d = (await r.json()) as {
          total?: number
          latest?: {
            body?: string
            type?: string
            name?: string | null
            senderName?: string
            conversationId?: string
            mentioned?: boolean
          } | null
        }
        if (!alive || typeof d.total !== 'number') return
        const prev = lastUnreadRef.current
        lastUnreadRef.current = d.total
        const onCommunity = window.location.hash.startsWith('#/community')
        if (prev !== null && d.total > prev && !onCommunity && d.latest) {
          const fresh = d.total - prev
          const l = d.latest
          const sender = l.senderName || 'Student'
          // a mention always leads the toast title — being @named outranks
          // generic new-message noise; Open deep-links straight to the convo
          const title = l.mentioned
            ? l.type === 'group'
              ? `${sender} mentioned you in ${l.name || 'a group'}`
              : `${sender} mentioned you`
            : fresh > 1
              ? `${fresh} new messages · ${l.type === 'group' ? l.name || sender : sender} +${fresh - 1} more`
              : `New message from ${l.type === 'group' ? l.name || sender : sender}`
          const target = l.conversationId
            ? `/community?c=${encodeURIComponent(l.conversationId)}`
            : '/community'
          toast({
            title,
            description: l.body || 'Message',
            action: (
              <ToastAction altText="Open chat" onClick={() => navigate(target)}>
                Open
              </ToastAction>
            ),
          })
        }
        setChatUnread(d.total)
      } catch {
        // transient network errors are fine — next tick retries
      }
    }
    void tick()
    const t = setInterval(() => void tick(), 15_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [user])

  const unreadBadge = (extra: string) =>
    chatUnread > 0 ? (
      <span
        className={cn(
          'flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold leading-none text-white shadow-sm',
          extra
        )}
        title={`${chatUnread} unread message${chatUnread === 1 ? '' : 's'}`}
      >
        {chatUnread > 99 ? '99+' : chatUnread}
      </span>
    ) : null

  // Ctrl/Cmd+K toggles the command palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleSignOut = async () => {
    await api('/api/auth/logout').catch(() => {})
    setUser(null)
    setMobileNav(false)
    toast({ title: 'Signed out' })
    navigate('/home')
  }

  const taxonomy = taxonomyApi.data?.subjects ?? null

  const view = route.view === 'login' ? 'login' : route.view
  // param changes must still remount views that initialize state from params
  // (PracticeView daily/subject/chapters, PyqView year/subject/chapter) even
  // though the animated page wrapper is keyed on route.view only
  const paramsKey = JSON.stringify(route.params)

  const tabActive = (v: string) =>
    v === 'community' ? view === 'community' : view === v

  return (
    <div className="flex min-h-screen flex-col">
      {/* header */}
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/65 backdrop-blur-xl supports-[backdrop-filter]:bg-background/55">
        {/* brand accent line */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, var(--primary), var(--chart-3), transparent)', opacity: 0.6 }}
        />
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-4">
          <button type="button" onClick={() => navigate('/home')} className="group flex items-center gap-2.5" aria-label="JEE NEXUS home">
            <span className="relative">
              <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true" className="transition-transform duration-300 group-hover:scale-105">
                <rect x="1.5" y="1.5" width="29" height="29" rx="8" stroke="var(--primary)" strokeWidth="2" />
                <path d="M10 21V11h5.2a3.4 3.4 0 0 1 0 6.8H13" stroke="var(--primary)" strokeWidth="2.4" strokeLinecap="round" />
                <circle cx="22.5" cy="11" r="1.6" fill="var(--chart-2)" />
                <circle cx="22.5" cy="16" r="1.6" fill="var(--chart-2)" />
                <circle cx="22.5" cy="21" r="1.6" fill="var(--chart-2)" />
              </svg>
              {/* mint glow dot — live heartbeat of the arena */}
              <span
                className="nexus-pulse absolute -right-1 -top-1 h-2 w-2 rounded-full bg-primary shadow-[0_0_10px_2px_var(--primary)]"
                aria-hidden="true"
              />
            </span>
            <span className="hidden flex-col items-start leading-none sm:flex">
              <span className="whitespace-nowrap text-sm font-bold tracking-[0.18em]">JEE NEXUS</span>
              <span className="whitespace-nowrap text-[9px] font-medium uppercase tracking-[0.3em] text-primary">practice · pyq · cbt</span>
            </span>
          </button>

          {/* desktop nav — icon-only until 2xl, icon+label from 2xl (labels at
              lg collided with the search/user cluster on 1024-1280px screens) */}
          <nav className="hidden min-w-0 items-center gap-0.5 md:flex" aria-label="Main navigation">
            {NAV.map((n) => (
              <motion.button
                key={n.view}
                type="button"
                onClick={() => navigate(`/${n.view}`)}
                whileTap={{ scale: 0.96 }}
                className={cn(
                  'relative flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm transition-colors lg:px-3',
                  view === n.view
                    ? 'font-semibold text-primary'
                    : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                )}
              >
                {view === n.view && (
                  <motion.span
                    layoutId="nav-active-pill"
                    className="absolute inset-0 rounded-lg border border-primary/25 bg-primary/12"
                    transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                  />
                )}
                <n.icon className="relative h-4 w-4" />
                <span className="relative hidden whitespace-nowrap 2xl:inline">{n.label}</span>
                {n.view === 'community' && unreadBadge('absolute right-0 top-0')}
              </motion.button>
            ))}
            {user?.role === 'admin' && (
              <motion.button
                type="button"
                onClick={() => navigate('/admin')}
                whileTap={{ scale: 0.96 }}
                className={cn(
                  'relative flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm transition-colors lg:px-3',
                  view === 'admin' ? 'font-semibold text-primary' : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                )}
              >
                {view === 'admin' && (
                  <motion.span
                    layoutId="nav-active-pill"
                    className="absolute inset-0 rounded-lg border border-primary/25 bg-primary/12"
                    transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                  />
                )}
                <ShieldCheck className="relative h-4 w-4" />
                <span className="relative hidden whitespace-nowrap 2xl:inline">{ADMIN_NAV.label}</span>
              </motion.button>
            )}
          </nav>

          <div className="flex items-center gap-1.5">
            {/* command-palette chip — doubles as the Ctrl-K hint */}
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="hidden h-9 items-center gap-2 rounded-lg border border-border/70 bg-muted/40 px-3 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground md:flex"
              aria-label="Open command palette (Ctrl+K)"
            >
              <Search className="h-3.5 w-3.5" />
              <span>Search</span>
              <kbd className="ml-1 hidden items-center gap-0.5 rounded border border-border/70 bg-background/60 px-1.5 py-0.5 font-mono text-[10px] font-medium xl:inline-flex">Ctrl K</kbd>
            </button>
            <Button variant="ghost" size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label="Toggle theme" className="h-9 w-9">
              <motion.span
                key={theme}
                initial={{ rotate: -60, opacity: 0, scale: 0.7 }}
                animate={{ rotate: 0, opacity: 1, scale: 1 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="flex"
              >
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </motion.span>
            </Button>
            {authChecked && (
              user ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-2 pl-1.5 pr-2" aria-label="Account menu">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-primary/30 to-primary/10 text-xs font-bold text-primary ring-1 ring-primary/40">
                        {(user.name ?? user.username)[0].toUpperCase()}
                      </span>
                      <span className="hidden max-w-[110px] truncate sm:inline">{(user.name ?? 'You').split(' ')[0]}</span>
                      <ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground sm:inline" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>
                      <div className="truncate text-sm font-semibold">{user.name || user.username}</div>
                      <div className="truncate text-xs font-normal text-muted-foreground">@{user.username}</div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => navigate('/profile')}>
                      <User className="h-4 w-4" /> Profile &amp; stats
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate('/bookmarks')}>
                      <BookMarked className="h-4 w-4" /> Bookmarks
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate('/leaderboard')}>
                      <Trophy className="h-4 w-4" /> Leaderboard
                    </DropdownMenuItem>
                    {user.role === 'admin' && (
                      <DropdownMenuItem onClick={() => navigate('/admin')}>
                        <ShieldCheck className="h-4 w-4" /> Admin console
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
                      <LogOut className="h-4 w-4" /> Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button size="sm" onClick={() => navigate('/login')} className="gap-1.5 transition-shadow hover:shadow-[0_0_24px_-6px_var(--primary)]">
                  <LogIn className="h-4 w-4" /> Sign in
                </Button>
              )
            )}
            <Button variant="ghost" size="icon" className="h-9 w-9 md:hidden" onClick={() => setMobileNav(!mobileNav)}
              aria-label="Toggle menu">
              {mobileNav ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {/* mobile sheet nav (secondary destinations) */}
        {mobileNav && (
          <motion.nav
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            className="overflow-hidden border-t border-border/60 md:hidden"
            aria-label="Mobile navigation"
          >
            <div className="space-y-1 px-4 py-3">
              {NAV.map((n) => (
                <button
                  key={n.view}
                  type="button"
                  onClick={() => navigate(`/${n.view}`)}
                  className={cn(
                    'flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
                    view === n.view
                      ? 'border-primary/25 bg-primary/10 font-semibold text-primary'
                      : 'border-transparent text-muted-foreground hover:bg-muted/60'
                  )}
                >
                  <n.icon className="h-4 w-4" /> {n.label}
                  {n.view === 'community' && unreadBadge('ml-auto')}
                </button>
              ))}
              {user?.role === 'admin' && (
                <button
                  type="button"
                  onClick={() => navigate('/admin')}
                  className={cn(
                    'flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
                    view === 'admin'
                      ? 'border-primary/25 bg-primary/10 font-semibold text-primary'
                      : 'border-transparent text-muted-foreground hover:bg-muted/60'
                  )}
                >
                  <ShieldCheck className="h-4 w-4" /> {ADMIN_NAV.label}
                </button>
              )}
              {user && (
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10"
                >
                  <LogOut className="h-4 w-4" /> Sign out
                </button>
              )}
            </div>
          </motion.nav>
        )}
      </header>

      {/* main */}
      <main className="relative flex-1 px-4 py-8 pb-28 md:pb-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
          >
            {/* inner keys: param-only changes remount param-driven views
                instantly (no exit dance) while view switches animate */}
            {view === 'home' && <HomeView key={`home-${paramsKey}`} user={user} taxonomy={taxonomy} />}
            {view === 'practice' && (
              <PracticeView
                key={`practice-${paramsKey}`}
                taxonomy={taxonomy}
                loggedIn={!!user}
                onRequireAuth={() => navigate('/login')}
                initialSubject={route.params.subject}
                initialChapters={
                  route.params.chapters ? route.params.chapters.split(',').filter(Boolean) : undefined
                }
                dailyParam={route.params.daily}
              />
            )}
            {view === 'pyq' && (
              <PyqView
                key={`pyq-${paramsKey}`}
                yearParam={route.params.year}
                subjectParam={route.params.subject}
                chapterParam={route.params.chapter}
                loggedIn={!!user}
                onRequireAuth={() => navigate('/login')}
              />
            )}
            {view === 'performance' && <PerformanceView onRequireAuth={() => navigate('/login')} />}
            {view === 'bookmarks' && <BookmarksView loggedIn={!!user} onRequireAuth={() => navigate('/login')} />}
            {(view === 'login' || view === 'profile') && <ProfileView user={user} onUserChange={setUser} />}
            {view === 'mock' && <MockView loggedIn={!!user} onRequireAuth={() => navigate('/login')} />}
            {view === 'community' && <CommunityView user={user} loggedIn={!!user} onRequireAuth={() => navigate('/login')} />}
            {view === 'leaderboard' && <LeaderboardView user={user} onRequireAuth={() => navigate('/login')} />}
            {view === 'admin' && <AdminView isAdmin={user?.role === 'admin'} />}
            {view !== 'home' && view !== 'practice' && view !== 'pyq' && view !== 'mock' && view !== 'performance' && view !== 'bookmarks' && view !== 'login' && view !== 'profile' && view !== 'admin' && view !== 'community' && view !== 'leaderboard' && (
              <div className="mx-auto max-w-lg rounded-2xl border border-dashed border-border p-10 text-center">
                <h2 className="text-lg font-semibold">Page not found</h2>
                <Button variant="outline" className="mt-4" onClick={() => navigate('/home')}>Go home</Button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* footer (sticky via mt-auto inside the min-h-screen flex column) */}
      <footer className="relative mt-auto hidden border-t border-border/60 py-5 md:block">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, var(--primary), transparent)', opacity: 0.35 }}
        />
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 text-xs text-muted-foreground">
          <div>
            <span className="font-bold text-foreground">JEE NEXUS</span> · free JEE Main practice ·{' '}
            <a href="https://github.com/mayankgit9/jee-nexus" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              GitHub
            </a>
          </div>
          <div>Not affiliated with NTA · solutions are original and marked AI-generated until expert-verified</div>
        </div>
      </footer>

      {/* command palette (Ctrl/Cmd+K) */}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        user={user}
        taxonomy={taxonomy?.map((s) => ({ key: s.key, name: s.name, questionCount: s.questionCount })) ?? null}
        theme={theme}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      />

      {/* mobile bottom tab bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-50 border-t border-border/70 bg-background/80 backdrop-blur-xl md:hidden"
        aria-label="Bottom navigation"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="grid h-16 grid-cols-5">
          {TAB_NAV.map((t) => (
            <motion.button
              key={t.view}
              type="button"
              onClick={() => navigate(`/${t.view}`)}
              whileTap={{ scale: 0.92 }}
              className={cn(
                'relative flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors',
                tabActive(t.view) ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              {tabActive(t.view) && (
                <motion.span
                  layoutId="tab-active-indicator"
                  className="absolute inset-x-0 top-0 flex justify-center"
                  transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                >
                  <span className="h-0.5 w-10 rounded-full bg-primary shadow-[0_0_8px_1px_var(--primary)]" />
                </motion.span>
              )}
              <span className="relative">
                <t.icon className={cn('h-5 w-5 transition-transform', tabActive(t.view) && 'scale-110')} />
                {t.view === 'community' && unreadBadge('absolute -right-2.5 -top-1.5')}
              </span>
              {t.label}
            </motion.button>
          ))}
          <motion.button
            type="button"
            onClick={() => setMobileNav(true)}
            whileTap={{ scale: 0.92 }}
            className="flex flex-col items-center justify-center gap-1 text-[10px] font-medium text-muted-foreground"
          >
            <MoreHorizontal className="h-5 w-5" />
            More
          </motion.button>
        </div>
      </nav>
    </div>
  )
}
