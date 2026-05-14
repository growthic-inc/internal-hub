/* ============================================================
   Growthic One — Service Worker
   Strategy:
   - Navigation (HTML): network-first, cache fallback
   - Static assets (JS/CSS/images): cache-first, then network
   - Supabase API + external: always network (no caching)
   ============================================================ */

const CACHE = 'growthic-v1'

// ── Install: precache the two shell pages ─────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(['/', '/home']))
      .then(() => self.skipWaiting())
  )
})

// ── Activate: drop any old cache versions ────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  )
})

// ── Fetch ─────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const req = e.request
  const url = new URL(req.url)

  // Pass through: non-GET, Supabase API, any other external origin
  if (req.method !== 'GET') return
  if (url.hostname !== self.location.hostname) return

  // Navigation requests (HTML pages): network-first
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => {
          caches.open(CACHE).then(c => c.put(req, res.clone()))
          return res
        })
        .catch(() =>
          caches.match(req)
            .then(r => r || caches.match('/'))
        )
    )
    return
  }

  // Static assets: cache-first, populate on miss
  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached
      return fetch(req).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()))
        return res
      })
    })
  )
})
