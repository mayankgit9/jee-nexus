'use client'

// JEE NEXUS — application shell (hash-routed SPA)
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Home, Dice5, Library, BarChart3, BookMarked, User, LogIn, Moon, Sun, Menu, X, ClipboardList, ShieldCheck, MessageSquare, MoreHorizontal, Search, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { useHashRoute, useApi, navigate } from '@/lib/client'
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

  // Global chat-unread badge: poll /api/chat/unread every 15s while signed
  // in (skips hidden tabs; resets on logout). Surfaces pending DMs and group
  // messages from ANY view — unread state used to live only inside Community.
  useEffect(() => {
    if (!user) {
      setChatUnread(0)
      return
    }
    let alive = true
    const tick = async () => {
      if (document.hidden || !alive) return
      try {
        const r = await fetch('/api/chat/unread')
        if (!r.ok) return
        const d = (await r.json()) as { total?: number }
        if (alive && typeof d.total === 'number') setChatUnread(d.total)
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

  const taxonomy = taxonomyApi.data?.subjects ?? null

  const view = route.view === 'login' ? 'login' : route.view

  const tabActive = (v: string) =>
    v === 'community' ? view === 'community' : view === v

  return (
    <div className="flex min-h-screen flex-col">
      {/* header */}
      <header className="sticky top-0 z-50 border-b border-border/70 bg-background/85 backdrop-blur-lg">
        {/* brand accent line */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, var(--primary), var(--chart-3), transparent)', opacity: 0.5 }}
        />
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
          <button type="button" onClick={() => navigate('/home')} className="group flex items-center gap-2.5" aria-label="JEE NEXUS home">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true" className="transition-transform duration-300 group-hover:scale-105">
              <rect x="1.5" y="1.5" width="29" height="29" rx="8" stroke="var(--primary)" strokeWidth="2" />
              <path d="M10 21V11h5.2a3.4 3.4 0 0 1 0 6.8H13" stroke="var(--primary)" strokeWidth="2.4" strokeLinecap="round" />
              <circle cx="22.5" cy="11" r="1.6" fill="var(--chart-2)" />
              <circle cx="22.5" cy="16" r="1.6" fill="var(--chart-2)" />
              <circle cx="22.5" cy="21" r="1.6" fill="var(--chart-2)" />
            </svg>
            <span className="hidden flex-col items-start leading-none sm:flex">
              <span className="whitespace-nowrap text-sm font-bold tracking-[0.18em]">JEE NEXUS</span>
              <span className="whitespace-nowrap text-[9px] font-medium uppercase tracking-[0.3em] text-primary">practice · pyq · cbt</span>
            </span>
          </button>

          {/* desktop nav — icon-only until lg, icon+label from lg */}
          <nav className="hidden items-center gap-0.5 md:flex" aria-label="Main navigation">
            {NAV.map((n) => (
              <button
                key={n.view}
                type="button"
                onClick={() => navigate(`/${n.view}`)}
                className={cn(
                  'relative flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm transition-colors lg:px-3',
                  view === n.view
                    ? 'font-semibold text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {view === n.view && (
                  <motion.span
                    layoutId="nav-active-pill"
                    className="absolute inset-0 rounded-lg bg-primary/12"
                    transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                  />
                )}
                <n.icon className="relative h-4 w-4" />
                <span className="relative hidden whitespace-nowrap lg:inline">{n.label}</span>
                {n.view === 'community' && unreadBadge('absolute right-0 top-0')}
              </button>
            ))}
            {user?.role === 'admin' && (
              <button
                type="button"
                onClick={() => navigate('/admin')}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors lg:px-3',
                  view === 'admin' ? 'bg-primary/12 font-semibold text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <ShieldCheck className="h-4 w-4" />
                {ADMIN_NAV.label}
              </button>
            )}
          </nav>

          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPaletteOpen(true)}
              className="hidden h-9 gap-2 text-muted-foreground md:flex"
              aria-label="Open command palette"
            >
              <Search className="h-4 w-4" />
              <span className="text-xs">Search</span>
              <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium">Ctrl K</kbd>
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label="Toggle theme" className="h-9 w-9">
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            {authChecked && (
              user ? (
                <Button variant="ghost" size="sm" onClick={() => navigate('/profile')} className="gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                    {(user.name ?? user.email)[0].toUpperCase()}
                  </span>
                  <span className="hidden sm:inline">{(user.name ?? 'You').split(' ')[0]}</span>
                </Button>
              ) : (
                <Button size="sm" onClick={() => navigate('/login')} className="gap-1.5">
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
                    'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm',
                    view === n.view ? 'bg-primary/12 font-semibold text-primary' : 'text-muted-foreground'
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
                    'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm',
                    view === 'admin' ? 'bg-primary/12 font-semibold text-primary' : 'text-muted-foreground'
                  )}
                >
                  <ShieldCheck className="h-4 w-4" /> {ADMIN_NAV.label}
                </button>
              )}
            </div>
          </motion.nav>
        )}
      </header>

      {/* main */}
      <main className="flex-1 px-4 py-8 pb-28 md:pb-8">
        <motion.div
          key={view + JSON.stringify(route.params)}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
        >
          {view === 'home' && <HomeView user={user} taxonomy={taxonomy} />}
          {view === 'practice' && (
            <PracticeView
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
      </main>

      {/* footer */}
      <footer className="mt-auto hidden border-t border-border/60 py-5 md:block">
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
        className="fixed inset-x-0 bottom-0 z-50 border-t border-border/70 bg-background/90 backdrop-blur-lg md:hidden"
        aria-label="Bottom navigation"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="grid h-16 grid-cols-5">
          {TAB_NAV.map((t) => (
            <button
              key={t.view}
              type="button"
              onClick={() => navigate(`/${t.view}`)}
              className={cn(
                'flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors',
                tabActive(t.view) ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              <span className="relative">
                <t.icon className={cn('h-5 w-5 transition-transform', tabActive(t.view) && 'scale-110')} />
                {t.view === 'community' && unreadBadge('absolute -right-2.5 -top-1.5')}
                {tabActive(t.view) && (
                  <motion.span
                    layoutId="tab-active-dot"
                    className="absolute -bottom-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary"
                  />
                )}
              </span>
              {t.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setMobileNav(true)}
            className="flex flex-col items-center justify-center gap-1 text-[10px] font-medium text-muted-foreground"
          >
            <MoreHorizontal className="h-5 w-5" />
            More
          </button>
        </div>
      </nav>
    </div>
  )
}
