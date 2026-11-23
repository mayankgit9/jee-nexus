'use client'

// JEE NEXUS — application shell (hash-routed SPA)
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Home, Dice5, Library, BarChart3, BookMarked, User, LogIn, Moon, Sun, Menu, X, ClipboardList } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { HomeView } from '@/components/views/HomeView'
import { PracticeView } from '@/components/views/PracticeView'
import { PyqView } from '@/components/views/PyqView'
import { PerformanceView } from '@/components/views/PerformanceView'
import { BookmarksView } from '@/components/views/BookmarksView'
import { ProfileView } from '@/components/views/ProfileView'
import { MockView } from '@/components/views/MockView'
import type { SessionUser, SubjectKey } from '@/lib/types'
import { useHashRoute, useApi, navigate } from '@/lib/client'
import { cn } from '@/lib/utils'

interface TaxonomySubject {
  key: SubjectKey
  name: string
  questionCount: number
  chapters: { key: string; name: string; unit: string | null; questionCount: number }[]
}

const NAV = [
  { view: 'home', label: 'Home', icon: Home },
  { view: 'practice', label: 'Practice', icon: Dice5 },
  { view: 'pyq', label: 'PYQ Library', icon: Library },
  { view: 'mock', label: 'Mock Tests', icon: ClipboardList },
  { view: 'performance', label: 'Performance', icon: BarChart3 },
  { view: 'bookmarks', label: 'Bookmarks', icon: BookMarked },
]

export default function App() {
  const route = useHashRoute()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [mobileNav, setMobileNav] = useState(false)
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

  const taxonomy = taxonomyApi.data?.subjects ?? null

  const view = route.view === 'login' ? 'login' : route.view

  return (
    <div className="flex min-h-screen flex-col">
      {/* header */}
      <header className="sticky top-0 z-50 border-b border-border/70 bg-background/85 backdrop-blur-lg">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
          <button type="button" onClick={() => navigate('/home')} className="flex items-center gap-2.5" aria-label="JEE NEXUS home">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <rect x="1.5" y="1.5" width="29" height="29" rx="8" stroke="var(--primary)" strokeWidth="2" />
              <path d="M10 21V11h5.2a3.4 3.4 0 0 1 0 6.8H13" stroke="var(--primary)" strokeWidth="2.4" strokeLinecap="round" />
              <circle cx="22.5" cy="11" r="1.6" fill="var(--chart-2)" />
              <circle cx="22.5" cy="16" r="1.6" fill="var(--chart-2)" />
              <circle cx="22.5" cy="21" r="1.6" fill="var(--chart-2)" />
            </svg>
            <span className="hidden flex-col items-start leading-none sm:flex">
              <span className="text-sm font-bold tracking-[0.18em]">JEE NEXUS</span>
              <span className="text-[9px] font-medium uppercase tracking-[0.3em] text-primary">practice · pyq · cbt</span>
            </span>
          </button>

          {/* desktop nav */}
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main navigation">
            {NAV.map((n) => (
              <button
                key={n.view}
                type="button"
                onClick={() => navigate(`/${n.view}`)}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors',
                  view === n.view ? 'bg-primary/12 font-semibold text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <n.icon className="h-4 w-4" />
                {n.label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-1.5">
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

        {/* mobile nav */}
        <AnimatePresence>
          {mobileNav && (
            <motion.nav
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
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
                  </button>
                ))}
              </div>
            </motion.nav>
          )}
        </AnimatePresence>
      </header>

      {/* main */}
      <main className="flex-1 px-4 py-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={view + (route.params.year ?? '') + (route.params.subject ?? '')}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
          >
            {view === 'home' && <HomeView user={user} taxonomy={taxonomy} />}
            {view === 'practice' && (
              <PracticeView taxonomy={taxonomy} loggedIn={!!user} onRequireAuth={() => navigate('/login')} />
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
          </motion.div>
        </AnimatePresence>
      </main>

      {/* footer */}
      <footer className="mt-auto border-t border-border/60 py-5">
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
    </div>
  )
}
