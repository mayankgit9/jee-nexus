'use client'

// JEE NEXUS — profile + auth view (username + password auth, optional recovery email)
// Auth rework 2026-11-28: sign-in identity is a USERNAME (3-20 chars, [a-z0-9_.-],
// case-insensitive at the backend). Email is OPTIONAL and exists purely for
// self-recovery ("forgot username" / "forgot password") — no SMTP on this
// deployment, so tokens are verified by username+email match and shown inline.
import { useState } from 'react'
import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from 'framer-motion'
import {
  AtSign,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Eye,
  EyeOff,
  Flag,
  Info,
  KeyRound,
  LifeBuoy,
  Lock,
  LogOut,
  Mail,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { SessionUser } from '@/lib/types'
import { api } from '@/lib/client'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

type AuthMode = 'login' | 'signup' | 'recover' | 'reset'

// Brief elevation system (.surface) applied inline — globals.css is owned by
// another agent; these values mirror DESIGN_BRIEF.md verbatim.
const SURFACE =
  'border border-border bg-[linear-gradient(180deg,oklch(0.19_0.014_240_/_0.9),oklch(0.16_0.014_240_/_0.9))]'
const CTA_GLOW = 'hover:shadow-[0_0_24px_-6px_var(--primary)]'

// Mirrors the backend's signup rules so the live hint fires before submit.
const USERNAME_RE = /^[a-z0-9_.-]{3,20}$/
const RESERVED = new Set([
  'admin', 'administrator', 'lobby', 'general', 'support', 'root', 'system',
  'mod', 'moderator', 'official', 'jeenexus', 'jee-nexus',
])

const EASE: [number, number, number, number] = [0.2, 0.8, 0.2, 1]

interface MyReport {
  id: string
  reason: string
  status: string
  createdAt: string
  question: { publicId: string; year: number | null; snippet: string }
}

type UsernameState = 'empty' | 'invalid' | 'reserved' | 'ok'

function usernameState(raw: string): UsernameState {
  const v = raw.trim()
  if (!v) return 'empty'
  const lower = v.toLowerCase()
  if (!USERNAME_RE.test(lower)) return 'invalid'
  if (RESERVED.has(lower)) return 'reserved'
  return 'ok'
}

const USERNAME_HINTS: Record<UsernameState, { text: string; className: string; icon: boolean }> = {
  empty: { text: '3-20 characters · lowercase a-z, 0-9, dot, dash, underscore', className: 'text-muted-foreground', icon: false },
  invalid: { text: 'Use 3-20 lowercase characters: a-z, 0-9, dot, dash or underscore', className: 'text-destructive', icon: false },
  reserved: { text: 'That username is reserved — pick another', className: 'text-amber-400', icon: false },
  ok: { text: 'Valid format — checked against existing accounts on submit', className: 'text-primary', icon: true },
}

function pwStrength(pw: string): { score: 0 | 1 | 2 | 3; label: string; bar: string } {
  if (!pw) return { score: 0, label: 'At least 8 characters', bar: 'bg-border' }
  if (pw.length < 8) return { score: 1, label: 'Too short — use at least 8 characters', bar: 'bg-rose-400' }
  const varied = /[a-zA-Z]/.test(pw) && (/\d/.test(pw) || /[^a-zA-Z0-9]/.test(pw))
  if (pw.length >= 10 && varied) return { score: 3, label: 'Strong password', bar: 'bg-primary' }
  return { score: 2, label: 'Okay — add numbers or symbols to strengthen it', bar: 'bg-amber-400' }
}

/** Masks a recovery email for display: ab••••@domain.tld */
function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return email
  const local = email.slice(0, at)
  const head = local.slice(0, 2)
  const dots = Math.max(2, Math.min(5, local.length - head.length))
  return `${head}${'•'.repeat(dots)}${email.slice(at)}`
}

// 44px-tall password show/hide toggle (brief: min touch target).
function PwToggle({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={show ? 'Hide password' : 'Show password'}
      title={show ? 'Hide password' : 'Show password'}
      className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
    >
      {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  )
}

export function ProfileView({ user, onUserChange }: { user: SessionUser | null; onUserChange: (u: SessionUser | null) => void }) {
  const reduce = useReducedMotion() ?? false
  const shake = useAnimationControls()

  const [mode, setMode] = useState<AuthMode>('login')
  const [authError, setAuthError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showPw, setShowPw] = useState(false)

  // login
  const [lgUsername, setLgUsername] = useState('')
  const [lgPassword, setLgPassword] = useState('')
  // signup
  const [suUsername, setSuUsername] = useState('')
  const [suPassword, setSuPassword] = useState('')
  const [suEmail, setSuEmail] = useState('')
  const [suName, setSuName] = useState('')
  // recovery — forgot username
  const [fuEmail, setFuEmail] = useState('')
  const [fuResult, setFuResult] = useState<string[] | null>(null)
  // recovery — forgot password
  const [fpUsername, setFpUsername] = useState('')
  const [fpEmail, setFpEmail] = useState('')
  const [fpNote, setFpNote] = useState<string | null>(null)
  // reset (token held in state, never displayed)
  const [resetToken, setResetToken] = useState('')
  const [rsPassword, setRsPassword] = useState('')
  // reports
  const [myReports, setMyReports] = useState<MyReport[] | null>(null)
  const [reportsOpen, setReportsOpen] = useState(false)

  const dur = reduce ? 0 : 0.25
  const stagger = reduce ? 0 : 0.045
  const reveal = (i: number) => ({
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: dur, ease: EASE, delay: i * stagger },
  })

  const goTo = (m: AuthMode) => {
    setAuthError(null)
    if (m === 'login' || m === 'signup') {
      setFuResult(null)
      setFpNote(null)
    }
    setMode(m)
  }

  const fail = (msg: string, doShake = false) => {
    setAuthError(msg)
    if (doShake && !reduce) {
      void shake.start({ x: [0, -10, 10, -7, 7, -3, 3, 0], transition: { duration: 0.4, ease: EASE } })
    }
  }

  const loadReports = async () => {
    try {
      const r = await api<{ reports: MyReport[] }>('/api/reports')
      setMyReports(r.reports)
    } catch {
      setMyReports([])
    }
  }

  // ---------- signed in: profile ----------
  if (user) {
    const logout = async () => {
      await api('/api/auth/logout').catch(() => {})
      onUserChange(null)
      setReportsOpen(false)
      setMyReports(null)
      toast({ title: 'Signed out' })
    }
    const initial = (user.name || user.username || '?').trim()[0]?.toUpperCase() ?? '?'
    return (
      <div className="mx-auto max-w-md">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: dur, ease: EASE }}>
          <Card className={cn('overflow-hidden', SURFACE)}>
            <CardHeader className="text-center">
              <motion.div
                initial={{ scale: 0.92, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: dur, ease: EASE }}
                className="nexus-glow mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-primary/25 to-chart-2/10 ring-1 ring-primary/40"
              >
                <span className="text-2xl font-bold text-primary">{initial}</span>
              </motion.div>
              <CardTitle className="mt-2 break-words text-xl">{user.name ?? 'Student'}</CardTitle>
              <div className="mt-1.5 flex min-w-0 flex-wrap items-center justify-center gap-2">
                <Badge className="gap-1 border-primary/40 bg-primary/15 font-mono text-primary">
                  <AtSign className="h-3 w-3" />
                  {user.username}
                </Badge>
                {user.role === 'admin' && (
                  <Badge className="gap-1 border-primary/40 bg-primary/10 text-primary">
                    <ShieldCheck className="h-3 w-3" /> Administrator
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <motion.div {...reveal(0)} className="space-y-1.5 rounded-lg border border-border/60 px-4 py-3 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Account</span>
                  <span>Username + password</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Role</span>
                  <span className="capitalize">{user.role}</span>
                </div>
              </motion.div>

              {/* Recovery email — read-only: there is no profile-update endpoint,
                  emails can only be set during signup (honest UX, no fake forms). */}
              <motion.div {...reveal(1)} className="rounded-lg border border-border/60 px-4 py-3 text-sm">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                    <Mail className="h-4 w-4 text-primary" /> Recovery email
                  </span>
                  <span className="truncate font-mono text-xs" title={user.email ?? 'No recovery email on file'}>
                    {user.email ? maskEmail(user.email) : 'Not set'}
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  {user.email
                    ? 'Used only to recover your account — never shown publicly. Read-only: recovery emails are set during signup.'
                    : 'Read-only here — a recovery email can only be set during signup. Without one, username/password self-recovery is unavailable.'}
                </p>
              </motion.div>

              <motion.div {...reveal(2)}>
                <button
                  type="button"
                  className="flex min-h-[44px] w-full items-center justify-between rounded-lg border border-border/60 px-4 py-2.5 text-sm transition-colors hover:border-primary/40"
                  onClick={() => {
                    const next = !reportsOpen
                    setReportsOpen(next)
                    if (next && myReports === null) loadReports()
                  }}
                >
                  <span className="flex items-center gap-2">
                    <Flag className="h-4 w-4 text-primary" /> My question reports
                  </span>
                  {reportsOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </button>
              </motion.div>
              {reportsOpen && (
                <motion.div {...reveal(3)} className="rounded-lg border border-border/60 px-4 py-3">
                  {myReports === null && <p className="text-xs text-muted-foreground">Loading…</p>}
                  {myReports !== null && myReports.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No reports yet. Spot a wrong answer or missing diagram? Use “Report an issue” on any question — you can track its status here.
                    </p>
                  )}
                  {myReports !== null && myReports.length > 0 && (
                    <ul className="space-y-2.5">
                      {myReports.map((r) => (
                        <li key={r.id} className="text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{r.reason.replace(/_/g, ' ')}</span>
                            <Badge variant={r.status === 'resolved' ? 'secondary' : 'outline'}
                              className={cn('text-[10px]', r.status === 'open' && 'border-amber-500/40 text-amber-400', r.status === 'resolved' && 'text-emerald-400')}>
                              {r.status}
                            </Badge>
                          </div>
                          <p className="mt-1 line-clamp-2 text-muted-foreground">
                            {r.question.year != null && `JEE ${r.question.year} · `}{r.question.snippet}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </motion.div>
              )}
              <motion.div {...reveal(4)} whileTap={{ scale: 0.97 }} whileHover={reduce ? undefined : { y: -1 }}>
                <Button variant="outline" className="h-11 w-full" onClick={logout}>
                  <LogOut className="mr-2 h-4 w-4" /> Sign out
                </Button>
              </motion.div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    )
  }

  // ---------- signed out: auth ----------
  const submitLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!lgUsername.trim() || !lgPassword) return
    setBusy(true)
    setAuthError(null)
    try {
      const r = await api<{ user: SessionUser }>('/api/auth/login', { username: lgUsername.trim(), password: lgPassword })
      onUserChange(r.user)
      const display = r.user.name?.split(' ')[0] || r.user.username
      toast({ title: `Welcome back, ${display}!` })
      setLgPassword('')
      setShowPw(false)
    } catch (err) {
      fail((err as Error).message || 'Invalid username or password', true) // 401 → shake
    } finally {
      setBusy(false)
    }
  }

  const submitSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    const uState = usernameState(suUsername)
    if (uState === 'empty') return fail('Pick a username first')
    if (uState === 'invalid') return fail('Username must be 3-20 characters: a-z, 0-9, dot, dash or underscore')
    if (uState === 'reserved') return fail('That username is reserved — pick another')
    if (suPassword.length < 8) return fail('Password must be at least 8 characters')
    setBusy(true)
    setAuthError(null)
    try {
      const payload: { username: string; password: string; email?: string; name?: string } = {
        username: suUsername.trim(),
        password: suPassword,
      }
      if (suEmail.trim()) payload.email = suEmail.trim()
      if (suName.trim()) payload.name = suName.trim() // backend defaults to the username
      const r = await api<{ user: SessionUser }>('/api/auth/signup', payload)
      onUserChange(r.user)
      toast({ title: 'Account created', description: `Signed in as @${r.user.username} — your attempts and progress are now tracked.` })
      setSuPassword('')
      setShowPw(false)
    } catch (err) {
      fail((err as Error).message || 'Could not create the account')
    } finally {
      setBusy(false)
    }
  }

  const submitForgotUsername = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setAuthError(null)
    setFuResult(null)
    try {
      const r = await api<{ ok: boolean; usernames: string[] }>('/api/auth/recover', { mode: 'username', email: fuEmail.trim() })
      setFuResult(r.usernames ?? [])
    } catch (err) {
      fail((err as Error).message || 'Could not look up that email')
    } finally {
      setBusy(false)
    }
  }

  const submitForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setAuthError(null)
    setFpNote(null)
    try {
      const r = await api<{ ok: boolean; resetToken?: string; note?: string }>('/api/auth/recover', {
        mode: 'password',
        username: fpUsername.trim(),
        email: fpEmail.trim(),
      })
      if (r.resetToken) {
        setResetToken(r.resetToken) // kept in state, never rendered
        setFpNote(r.note ?? null)
        setMode('reset') // inline transition within AnimatePresence
      } else {
        setFpNote(r.note ?? 'If that username and email match an account, a reset token was generated.')
      }
    } catch (err) {
      fail((err as Error).message || 'Could not verify that username and email')
    } finally {
      setBusy(false)
    }
  }

  const submitReset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (rsPassword.length < 8) return fail('Password must be at least 8 characters')
    setBusy(true)
    setAuthError(null)
    try {
      await api('/api/auth/reset', { token: resetToken, password: rsPassword })
      // Reset signs the user in server-side — refresh session state, then hand it up.
      const me = await api<{ user: SessionUser | null }>('/api/auth/me')
      onUserChange(me.user)
      toast({ title: 'Password updated', description: 'You are signed in.' })
      setRsPassword('')
      setShowPw(false)
    } catch (err) {
      fail((err as Error).message || 'Could not update the password')
    } finally {
      setBusy(false)
    }
  }

  const titles: Record<AuthMode, string> = {
    login: 'Welcome back',
    signup: 'Create your free account',
    recover: 'Account recovery',
    reset: 'Set a new password',
  }
  const subtitles: Record<AuthMode, string> = {
    login: 'Sign in with your username to resume your streak.',
    signup: 'Track attempts, accuracy and bookmarks — free forever.',
    recover: 'Forgot your username or password? Verify with your recovery email.',
    reset: fpNote ?? 'Choose a new password for your account.',
  }
  const headerIcons: Record<AuthMode, typeof KeyRound> = {
    login: KeyRound,
    signup: Sparkles,
    recover: LifeBuoy,
    reset: KeyRound,
  }
  const HeaderIcon = headerIcons[mode]

  const suState = usernameState(suUsername)
  const suHint = USERNAME_HINTS[suState]
  const strength = pwStrength(mode === 'reset' ? rsPassword : suPassword)

  const submitLabel =
    busy
      ? mode === 'login' ? 'Signing in…' : mode === 'signup' ? 'Creating account…' : 'Please wait…'
      : mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Update password'

  return (
    <div className="mx-auto max-w-md">
      <AnimatePresence mode="wait">
        <motion.div
          key={mode}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: dur, ease: EASE }}
        >
          {/* shake wrapper — 401-style auth failures rattle the card */}
          <motion.div animate={shake}>
            <Card className={cn('overflow-hidden', SURFACE)}>
              <CardHeader className="text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                  <HeaderIcon className="h-7 w-7 text-primary" />
                </div>
                <CardTitle className="mt-2 text-xl">{titles[mode]}</CardTitle>
                <p className="text-sm text-muted-foreground">{subtitles[mode]}</p>
              </CardHeader>
              <CardContent>
                {/* ---------- LOGIN ---------- */}
                {mode === 'login' && (
                  <form onSubmit={submitLogin} className="space-y-4">
                    <motion.div {...reveal(0)} className="space-y-1.5">
                      <Label htmlFor="auth-username">Username</Label>
                      <div className="relative">
                        <AtSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="auth-username"
                          value={lgUsername}
                          onChange={(e) => setLgUsername(e.target.value)}
                          placeholder="your_username"
                          autoComplete="username"
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          required
                          className="h-11 pl-10"
                        />
                      </div>
                    </motion.div>
                    <motion.div {...reveal(1)} className="space-y-1.5">
                      <Label htmlFor="auth-password">Password</Label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="auth-password"
                          type={showPw ? 'text' : 'password'}
                          value={lgPassword}
                          onChange={(e) => setLgPassword(e.target.value)}
                          placeholder="••••••••"
                          autoComplete="current-password"
                          required
                          className="h-11 pl-10 pr-11"
                        />
                        <PwToggle show={showPw} onToggle={() => setShowPw((v) => !v)} />
                      </div>
                    </motion.div>
                    <AnimatePresence initial={false}>
                      {authError && (
                        <motion.div
                          key="login-error"
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                            <span className="min-w-0 break-words">{authError}</span>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <motion.div {...reveal(2)} whileTap={{ scale: 0.97 }} whileHover={reduce ? undefined : { y: -1 }}>
                      <Button type="submit" className={cn('h-11 w-full', CTA_GLOW)} disabled={busy}>
                        {submitLabel}
                      </Button>
                    </motion.div>
                    <motion.div {...reveal(3)} className="pt-1 text-center">
                      <button
                        type="button"
                        className="text-sm text-muted-foreground transition-colors hover:text-primary"
                        onClick={() => goTo('recover')}
                      >
                        Forgot username or password?
                      </button>
                    </motion.div>
                  </form>
                )}

                {/* ---------- SIGNUP ---------- */}
                {mode === 'signup' && (
                  <form onSubmit={submitSignup} className="space-y-4">
                    <motion.div {...reveal(0)} className="space-y-1.5">
                      <Label htmlFor="su-username">Username</Label>
                      <div className="relative">
                        <AtSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="su-username"
                          value={suUsername}
                          onChange={(e) => setSuUsername(e.target.value)}
                          placeholder="e.g. physics_wizard"
                          autoComplete="username"
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          required
                          aria-invalid={suState === 'invalid' || suState === 'reserved'}
                          className={cn('h-11 pl-10', suState === 'ok' && 'border-primary/60')}
                        />
                      </div>
                      <p className={cn('flex items-center gap-1 text-xs', suHint.className)}>
                        {suHint.icon && <Check className="h-3.5 w-3.5 shrink-0" />}
                        {suHint.text}
                      </p>
                    </motion.div>

                    <motion.div {...reveal(1)} className="space-y-1.5">
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="su-password"
                          type={showPw ? 'text' : 'password'}
                          value={suPassword}
                          onChange={(e) => setSuPassword(e.target.value)}
                          placeholder="Password (min 8 characters)"
                          autoComplete="new-password"
                          required
                          className="h-11 pl-10 pr-11"
                        />
                        <PwToggle show={showPw} onToggle={() => setShowPw((v) => !v)} />
                      </div>
                      {suPassword && (
                        <div className="space-y-1">
                          <div className="flex gap-1">
                            {[1, 2, 3].map((seg) => (
                              <span
                                key={seg}
                                className={cn(
                                  'h-1 flex-1 rounded-full transition-colors',
                                  strength.score >= seg ? strength.bar : 'bg-border'
                                )}
                              />
                            ))}
                          </div>
                          <p className="text-xs text-muted-foreground">{strength.label}</p>
                        </div>
                      )}
                    </motion.div>

                    <motion.div {...reveal(2)} className="space-y-1.5">
                      <Label htmlFor="su-email">
                        Email <span className="font-normal text-muted-foreground">(optional)</span>
                      </Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="su-email"
                          type="email"
                          value={suEmail}
                          onChange={(e) => setSuEmail(e.target.value)}
                          placeholder="Optional — only used to recover your account if you forget your username or password"
                          autoComplete="email"
                          className="h-11 pl-10"
                        />
                      </div>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Info className="h-3.5 w-3.5 shrink-0 text-primary" />
                        Your account works fully without it — it is never shown publicly.
                      </p>
                    </motion.div>

                    <motion.div {...reveal(3)} className="space-y-1.5">
                      <Label htmlFor="su-name">Display name <span className="font-normal text-muted-foreground">(optional)</span></Label>
                      <Input
                        id="su-name"
                        value={suName}
                        onChange={(e) => setSuName(e.target.value)}
                        placeholder={suUsername.trim() ? `Defaults to "${suUsername.trim()}"` : 'Defaults to your username'}
                        autoComplete="name"
                        className="h-11"
                      />
                    </motion.div>

                    <AnimatePresence initial={false}>
                      {authError && (
                        <motion.div
                          key="signup-error"
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                            <span className="min-w-0 break-words">{authError}</span>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <motion.div {...reveal(4)} whileTap={{ scale: 0.97 }} whileHover={reduce ? undefined : { y: -1 }}>
                      <Button type="submit" className={cn('h-11 w-full', CTA_GLOW)} disabled={busy}>
                        {submitLabel}
                      </Button>
                    </motion.div>
                  </form>
                )}

                {/* ---------- RECOVER (unified: forgot username | forgot password) ---------- */}
                {mode === 'recover' && (
                  <div className="space-y-4">
                    <motion.div {...reveal(0)}>
                      <Tabs defaultValue="username" className="gap-4">
                        <TabsList className="grid h-11 w-full grid-cols-2">
                          <TabsTrigger value="username" className="gap-1.5">
                            <AtSign className="h-3.5 w-3.5" /> Forgot username
                          </TabsTrigger>
                          <TabsTrigger value="password" className="gap-1.5">
                            <Lock className="h-3.5 w-3.5" /> Forgot password
                          </TabsTrigger>
                        </TabsList>

                        {/* forgot username — identity proof = email match, usernames shown directly */}
                        <TabsContent value="username" className="space-y-4">
                          <form onSubmit={submitForgotUsername} className="space-y-4">
                            <div className="space-y-1.5">
                              <Label htmlFor="fu-email">Your recovery email</Label>
                              <div className="relative">
                                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                  id="fu-email"
                                  type="email"
                                  value={fuEmail}
                                  onChange={(e) => setFuEmail(e.target.value)}
                                  placeholder="The email you registered with"
                                  autoComplete="email"
                                  required
                                  className="h-11 pl-10"
                                />
                              </div>
                            </div>
                            <motion.div whileTap={{ scale: 0.97 }} whileHover={reduce ? undefined : { y: -1 }}>
                              <Button type="submit" className={cn('h-11 w-full', CTA_GLOW)} disabled={busy}>
                                {busy ? 'Looking…' : 'Find my username'}
                              </Button>
                            </motion.div>
                          </form>
                          <AnimatePresence initial={false}>
                            {fuResult !== null && (
                              <motion.div
                                key="fu-result"
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                className="overflow-hidden"
                              >
                                <div className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-3">
                                  {fuResult.length > 0 ? (
                                    <>
                                      <p className="text-sm font-medium">
                                        Account{fuResult.length > 1 ? 's' : ''} linked to this email:
                                      </p>
                                      <div className="mt-2 flex flex-wrap gap-2">
                                        {fuResult.map((u) => (
                                          <Badge key={u} className="border-primary/40 bg-primary/15 font-mono text-primary">
                                            @{u}
                                          </Badge>
                                        ))}
                                      </div>
                                      <p className="mt-2 text-xs text-muted-foreground">Use it to sign in on the previous screen.</p>
                                    </>
                                  ) : (
                                    <p className="text-sm text-muted-foreground">
                                      No accounts found for that email. Double-check the address, or create a new account.
                                    </p>
                                  )}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </TabsContent>

                        {/* forgot password — username+email match returns the token inline */}
                        <TabsContent value="password" className="space-y-4">
                          <form onSubmit={submitForgotPassword} className="space-y-4">
                            <div className="space-y-1.5">
                              <Label htmlFor="fp-username">Username</Label>
                              <div className="relative">
                                <AtSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                  id="fp-username"
                                  value={fpUsername}
                                  onChange={(e) => setFpUsername(e.target.value)}
                                  placeholder="your_username"
                                  autoComplete="username"
                                  autoCapitalize="none"
                                  autoCorrect="off"
                                  spellCheck={false}
                                  required
                                  className="h-11 pl-10"
                                />
                              </div>
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="fp-email">Recovery email</Label>
                              <div className="relative">
                                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                  id="fp-email"
                                  type="email"
                                  value={fpEmail}
                                  onChange={(e) => setFpEmail(e.target.value)}
                                  placeholder="The email you registered with"
                                  autoComplete="email"
                                  required
                                  className="h-11 pl-10"
                                />
                              </div>
                            </div>
                            <motion.div whileTap={{ scale: 0.97 }} whileHover={reduce ? undefined : { y: -1 }}>
                              <Button type="submit" className={cn('h-11 w-full', CTA_GLOW)} disabled={busy}>
                                {busy ? 'Verifying…' : 'Verify and continue'}
                              </Button>
                            </motion.div>
                          </form>
                          <AnimatePresence initial={false}>
                            {fpNote && (
                              <motion.div
                                key="fp-note"
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                className="overflow-hidden"
                              >
                                <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
                                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                                  <span className="min-w-0 break-words">{fpNote}</span>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </TabsContent>
                      </Tabs>
                    </motion.div>
                    <motion.div {...reveal(1)} className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="min-w-0">
                        No email delivery — tokens are verified by username+email match and shown here directly.
                      </span>
                    </motion.div>
                  </div>
                )}

                {/* ---------- RESET (reached inline from "forgot password") ---------- */}
                {mode === 'reset' && (
                  <div className="space-y-4">
                    {resetToken ? (
                      <form onSubmit={submitReset} className="space-y-4">
                        {/* token travels in state only — never rendered */}
                        <input type="hidden" name="token" value={resetToken} />
                        <motion.div {...reveal(0)} className="space-y-1.5">
                          <Label htmlFor="rs-password">New password</Label>
                          <div className="relative">
                            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              id="rs-password"
                              type={showPw ? 'text' : 'password'}
                              value={rsPassword}
                              onChange={(e) => setRsPassword(e.target.value)}
                              placeholder="••••••••"
                              autoComplete="new-password"
                              required
                              className="h-11 pl-10 pr-11"
                            />
                            <PwToggle show={showPw} onToggle={() => setShowPw((v) => !v)} />
                          </div>
                          {rsPassword && (
                            <div className="space-y-1">
                              <div className="flex gap-1">
                                {[1, 2, 3].map((seg) => (
                                  <span
                                    key={seg}
                                    className={cn(
                                      'h-1 flex-1 rounded-full transition-colors',
                                      strength.score >= seg ? strength.bar : 'bg-border'
                                    )}
                                  />
                                ))}
                              </div>
                              <p className="text-xs text-muted-foreground">{strength.label}</p>
                            </div>
                          )}
                        </motion.div>
                        <AnimatePresence initial={false}>
                          {authError && (
                            <motion.div
                              key="reset-error"
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                                <span className="min-w-0 break-words">{authError}</span>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                        <motion.div {...reveal(1)} whileTap={{ scale: 0.97 }} whileHover={reduce ? undefined : { y: -1 }}>
                          <Button type="submit" className={cn('h-11 w-full', CTA_GLOW)} disabled={busy}>
                            {busy ? 'Updating…' : 'Update password'}
                          </Button>
                        </motion.div>
                        <motion.p {...reveal(2)} className="text-center text-xs text-muted-foreground">
                          After updating you are signed in automatically — your sessions elsewhere are revoked.
                        </motion.p>
                      </form>
                    ) : (
                      <motion.div {...reveal(0)} className="space-y-3 text-center">
                        <p className="text-sm text-muted-foreground">
                          No recovery token yet. Verify your username and email first.
                        </p>
                        <Button variant="outline" className="h-11 w-full" onClick={() => goTo('recover')}>
                          Back to recovery
                        </Button>
                      </motion.div>
                    )}
                  </div>
                )}

                <Separator className="my-4" />
                <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1 text-sm">
                  {mode === 'login' && (
                    <button
                      type="button"
                      className="flex min-h-[44px] items-center px-3 text-primary hover:underline"
                      onClick={() => goTo('signup')}
                    >
                      Create account
                    </button>
                  )}
                  {(mode === 'signup' || mode === 'recover' || mode === 'reset') && (
                    <button
                      type="button"
                      className="flex min-h-[44px] items-center px-3 text-primary hover:underline"
                      onClick={() => goTo('login')}
                    >
                      Sign in
                    </button>
                  )}
                  {mode === 'recover' && (
                    <button
                      type="button"
                      className="flex min-h-[44px] items-center px-3 text-muted-foreground hover:text-foreground hover:underline"
                      onClick={() => goTo('signup')}
                    >
                      Create account
                    </button>
                  )}
                  {mode === 'reset' && (
                    <button
                      type="button"
                      className="flex min-h-[44px] items-center px-3 text-muted-foreground hover:text-foreground hover:underline"
                      onClick={() => goTo('recover')}
                    >
                      Back to recovery
                    </button>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      </AnimatePresence>
      <p className="mt-4 px-4 text-center text-xs text-muted-foreground/70">
        By continuing you agree to honest practice — this platform never shares or sells your data.
      </p>
    </div>
  )
}
