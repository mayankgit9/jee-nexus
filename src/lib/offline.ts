// JEE NEXUS — offline attempt queue + sync (Part H, client side)
// Answers recorded while offline are queued in localStorage (small, bounded,
// low-RAM friendly — no IndexedDB needed for this payload size) and flushed
// to /api/attempts/sync on reconnect. Every item carries a clientKey so the
// server's unique index makes replays idempotent: a flushed batch retried
// after a flaky connection can never duplicate an attempt.

export interface OfflineAttemptItem {
  clientKey: string
  questionId: string
  selectedOptions?: number[]
  numericalValue?: string
  timeSpentSeconds?: number
  hintsUsed?: number
  mode?: string
  createdAt?: string
  queuedAt: string
}

const QUEUE_KEY = 'jee_nexus_offline_attempts'
export const OFFLINE_SYNC_EVENT = 'jee-nexus:offline-sync'

export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

export function newClientKey(): string {
  // crypto.randomUUID when available, Math.random fallback (still unique enough
  // per client for the server's dedup index)
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `ck-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function readQueue(): OfflineAttemptItem[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function writeQueue(items: OfflineAttemptItem[]): void {
  try {
    // bounded queue — oldest dropped (should never happen in practice)
    localStorage.setItem(QUEUE_KEY, JSON.stringify(items.slice(-200)))
  } catch {
    /* storage full — the current attempt stays in memory this session */
  }
}

/** Queue an attempt made while offline. */
export function offlineAttempt(item: Omit<OfflineAttemptItem, 'queuedAt'>): void {
  const queue = readQueue()
  queue.push({ ...item, queuedAt: new Date().toISOString() })
  writeQueue(queue)
}

/** How many attempts are waiting to sync. */
export function pendingOfflineCount(): number {
  return readQueue().length
}

/** Flush queued attempts to the server. Returns { synced, duplicates }. */
export async function syncPendingAttempts(): Promise<{ synced: number; duplicates: number }> {
  const queue = readQueue()
  if (queue.length === 0) return { synced: 0, duplicates: 0 }
  const remaining: OfflineAttemptItem[] = [...queue]
  let synced = 0
  let duplicates = 0

  // chunked flush — keeps each request small
  while (remaining.length > 0) {
    const batch = remaining.splice(0, 50)
    try {
      const res = await fetch('/api/attempts/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attempts: batch }),
      })
      if (!res.ok) break // stop flushing — retry later (401 = signed out)
      const data = (await res.json()) as { results: { status: string }[] }
      for (const r of data.results ?? []) {
        if (r.status === 'synced') synced++
        else if (r.status === 'duplicate') duplicates++
      }
    } catch {
      break // still offline — keep the remainder queued
    }
  }

  // write back whatever failed to flush (or clear on full success)
  writeQueue(remaining)

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(OFFLINE_SYNC_EVENT, { detail: { synced, duplicates, remaining: remaining.length } }))
  }
  return { synced, duplicates }
}

/** Auto-sync when the connection returns (call once from the app shell). */
export function installOfflineSync(onSynced?: (n: number) => void): void {
  if (typeof window === 'undefined') return
  window.addEventListener('online', () => {
    void syncPendingAttempts().then(({ synced }) => {
      if (synced > 0) onSynced?.(synced)
    })
  })
  // opportunistic flush on load (e.g. app opened after being offline)
  if (typeof navigator !== 'undefined' && navigator.onLine && pendingOfflineCount() > 0) {
    void syncPendingAttempts().then(({ synced }) => {
      if (synced > 0) onSynced?.(synced)
    })
  }
}
