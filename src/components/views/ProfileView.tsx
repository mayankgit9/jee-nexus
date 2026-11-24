'use client'

// JEE NEXUS — profile + auth view (login / signup / recovery)
import { useState } from 'react'
import { LogOut, UserCircle2, KeyRound, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import type { SessionUser } from '@/lib/types'
import { api } from '@/lib/client'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

type AuthMode = 'login' | 'signup' | 'recover' | 'reset'

export function ProfileView({ user, onUserChange }: { user: SessionUser | null; onUserChange: (u: SessionUser | null) => void }) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [busy, setBusy] = useState(false)

  if (user) {
    const logout = async () => {
      await api('/api/auth/logout').catch(() => {})
      onUserChange(null)
      toast({ title: 'Signed out' })
    }
    return (
      <div className="mx-auto max-w-md">
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <UserCircle2 className="h-9 w-9 text-primary" />
            </div>
            <CardTitle className="mt-2">{user.name ?? 'Student'}</CardTitle>
            <p className="text-sm text-muted-foreground">{user.email}</p>
            {user.role === 'admin' && <Badge className="mt-2 border-primary/40 bg-primary/10 text-primary">Administrator</Badge>}
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border border-border/60 px-4 py-3 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Account</span><span>Email + password</span></div>
              <div className="mt-1.5 flex justify-between"><span className="text-muted-foreground">Role</span><span className="capitalize">{user.role}</span></div>
            </div>
            <Button variant="outline" className="w-full" onClick={logout}>
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      if (mode === 'login') {
        const r = await api<{ user: SessionUser }>('/api/auth/login', { email, password })
        onUserChange(r.user)
        toast({ title: `Welcome back${r.user.name ? ', ' + r.user.name.split(' ')[0] : ''}!` })
      } else if (mode === 'signup') {
        const r = await api<{ user: SessionUser }>('/api/auth/signup', { email, password, name })
        onUserChange(r.user)
        toast({ title: 'Account created', description: 'Your attempts and progress will now be tracked.' })
      } else if (mode === 'recover') {
        const r = await api<{ resetToken?: string }>('/api/auth/recover', { email })
        if (r.resetToken) {
          setResetToken(r.resetToken)
          setMode('reset')
          toast({ title: 'Recovery token generated', description: 'Sandbox mode: enter a new password below.' })
        } else {
          toast({ title: 'If that account exists, a reset link has been sent' })
        }
      } else if (mode === 'reset') {
        await api('/api/auth/reset', { token: resetToken, password })
        const r = await api<{ user: SessionUser }>('/api/auth/me')
        onUserChange(r.user)
        toast({ title: 'Password updated', description: 'You are signed in.' })
      }
    } catch (err) {
      toast({ title: 'Failed', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const titles: Record<AuthMode, string> = {
    login: 'Welcome back', signup: 'Create your free account', recover: 'Recover your password', reset: 'Set a new password',
  }

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <KeyRound className="h-7 w-7 text-primary" />
          </div>
          <CardTitle className="mt-2 text-xl">{titles[mode]}</CardTitle>
          {mode === 'signup' && (
            <p className="text-sm text-muted-foreground">Track attempts, accuracy and bookmarks — free forever.</p>
          )}
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            {mode === 'signup' && (
              <div className="space-y-1.5">
                <Label htmlFor="auth-name">Name (optional)</Label>
                <Input id="auth-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Aspirant" autoComplete="name" />
              </div>
            )}
            {mode !== 'reset' && (
              <div className="space-y-1.5">
                <Label htmlFor="auth-email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input id="auth-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com" autoComplete="email" className="pl-9" />
                </div>
              </div>
            )}
            {mode === 'reset' && (
              <div className="space-y-1.5">
                <Label htmlFor="auth-token">Recovery token</Label>
                <Input id="auth-token" required value={resetToken} onChange={(e) => setResetToken(e.target.value)}
                  className="font-mono text-xs" />
              </div>
            )}
            {mode !== 'recover' && (
              <div className="space-y-1.5">
                <Label htmlFor="auth-password">Password {mode === 'login' ? '' : '(min 8 characters)'}</Label>
                <Input id="auth-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
              </div>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : mode === 'recover' ? 'Send recovery link' : 'Update password'}
            </Button>
          </form>

          <Separator className="my-5" />
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm">
            {mode !== 'login' && (
              <button className="text-primary hover:underline" onClick={() => setMode('login')}>Sign in</button>
            )}
            {mode !== 'signup' && (
              <button className="text-primary hover:underline" onClick={() => setMode('signup')}>Create account</button>
            )}
            {mode !== 'recover' && mode !== 'reset' && (
              <button className="text-muted-foreground hover:text-foreground hover:underline" onClick={() => setMode('recover')}>
                Forgot password?
              </button>
            )}
          </div>
        </CardContent>
      </Card>
      <p className={cn('mt-4 text-center text-xs text-muted-foreground/70',
        'px-4')}>
        By continuing you agree to honest practice — this platform never shares or sells your data.
      </p>
    </div>
  )
}
