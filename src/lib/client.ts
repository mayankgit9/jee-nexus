'use client'

// JEE NEXUS — client-side helpers: hash router + API hooks
import { useCallback, useEffect, useState } from 'react'

// ---------- hash router ----------
export interface Route {
  view: string
  params: Record<string, string>
}

export function parseHash(hash: string): Route {
  const clean = hash.replace(/^#\/?/, '')
  const [path, query] = clean.split('?')
  const parts = path.split('/').filter(Boolean)
  const view = parts[0] || 'home'
  const params: Record<string, string> = {}
  parts.slice(1).forEach((p, i) => {
    params[['year', 'subject', 'chapter'][i] ?? `p${i}`] = decodeURIComponent(p)
  })
  if (query) {
    new URLSearchParams(query).forEach((v, k) => (params[k] = v))
  }
  return { view, params }
}

export function useHashRoute(): Route {
  // Always start with the SSR-safe default so server and client hydration agree;
  // the real hash is applied in an effect right after mount.
  const [route, setRoute] = useState<Route>(() => ({ view: 'home', params: {} }))
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash))
    onChange() // adopt the real hash post-hydration
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const navigate = useCallback((to: string) => {
    window.location.hash = to.startsWith('#') ? to : `#/${to.replace(/^\//, '')}`
    window.scrollTo({ top: 0 })
  }, [])
  return { ...route, navigate } as Route & { navigate: (to: string) => void }
}

export function navigate(to: string) {
  window.location.hash = to.startsWith('#') ? to : `#/${to.replace(/^\//, '')}`
  window.scrollTo({ top: 0 })
}

// ---------- API ----------
export async function api<T = unknown>(
  path: string,
  body?: unknown,
  method?: 'POST' | 'PATCH' | 'PUT' | 'DELETE'
): Promise<T> {
  const res = await fetch(path, {
    method: method ?? (body !== undefined ? 'POST' : 'GET'),
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`)
  return data as T
}

export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(() => !!path)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let alive = true
    const run = () => {
      if (!path) {
        setData(null)
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)
      api<T>(path)
        .then((d) => alive && setData(d))
        .catch((e) => alive && setError(e.message))
        .finally(() => alive && setLoading(false))
    }
    // defer to microtask: avoids synchronous setState inside the effect body
    Promise.resolve().then(run)
    return () => {
      alive = false
    }
  }, [path, nonce, ...deps])
  return { data, error, loading, reload: () => setNonce((n) => n + 1) }
}

// ---------- misc ----------
export function formatDuration(seconds: number): string {
  if (!seconds || seconds < 1) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  if (m >= 60) {
    const h = Math.floor(m / 60)
    return `${h}h ${m % 60}m`
  }
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export const SUBJECT_COLORS: Record<string, string> = {
  physics: 'var(--subj-physics)',
  chemistry: 'var(--subj-chemistry)',
  mathematics: 'var(--subj-mathematics)',
}
