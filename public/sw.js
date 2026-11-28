/* JEE NEXUS — service worker (Part H)
 * Offline-first PWA tuned for low-RAM Android devices:
 *  - preCACHED shell (/, /offline.html, icons) → app opens offline
 *  - cache-first for static assets (/_next/static, /pyq exam diagrams)
 *  - stale-while-revalidate for PUBLIC question data (taxonomy, PYQ,
 *    question detail, formula cards) — "previously downloaded questions and
 *    solutions" stay readable offline
 *  - NEVER caches POSTs (answers go through the localStorage sync queue),
 *    and never caches private/auth endpoints (chat, stats, admin, auth…)
 *  - bounded, trimmed caches so storage stays small
 */
const VERSION = 'jee-nexus-v1'
const SHELL_CACHE = `${VERSION}-shell`
const STATIC_CACHE = `${VERSION}-static`
const DATA_CACHE = `${VERSION}-data`

const SHELL_ASSETS = ['/', '/offline.html', '/manifest.json', '/logo.svg', '/icon-192.png', '/icon-512.png']

// Only these public, non-sensitive GET endpoints may be cached offline.
const CACHEABLE_API = [/^\/api\/taxonomy/, /^\/api\/questions\/detail/, /^\/api\/pyq/, /^\/api\/formulas/]

const CACHE_LIMITS = { [STATIC_CACHE]: 300, [DATA_CACHE]: 250 }

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

async function trimCache(name, limit) {
  const cache = await caches.open(name)
  const keys = await cache.keys()
  if (keys.length > limit) {
    // drop the oldest ~10% beyond the limit (FIFO — Map preserves insertion)
    const excess = keys.length - limit
    await Promise.all(keys.slice(0, excess).map((k) => cache.delete(k)))
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return // answers/posts never cached here
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // no third-party caching
  const path = url.pathname

  // navigations: network-first → cached shell → offline page
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(SHELL_CACHE).then((c) => c.put('/', copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match('/').then((r) => r || caches.match('/offline.html')))
    )
    return
  }

  // static build assets + exam diagrams: cache-first
  if (path.startsWith('/_next/static/') || path.startsWith('/pyq/') || /\.(png|jpg|jpeg|svg|webp|woff2?|css|js|ico)$/.test(path)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(STATIC_CACHE).then((c) => c.put(req, copy)).then(() => trimCache(STATIC_CACHE, CACHE_LIMITS[STATIC_CACHE]))
                .catch(() => {})
            }
            return res
          })
      )
    )
    return
  }

  // public question data: stale-while-revalidate
  if (CACHEABLE_API.some((re) => re.test(path))) {
    event.respondWith(
      caches.open(DATA_CACHE).then(async (cache) => {
        const cached = await cache.match(req)
        const network = fetch(req)
          .then((res) => {
            if (res.ok) {
              cache.put(req, res.clone())
              trimCache(DATA_CACHE, CACHE_LIMITS[DATA_CACHE])
            }
            return res
          })
          .catch(() => cached)
        return cached || network
      })
    )
  }
})
