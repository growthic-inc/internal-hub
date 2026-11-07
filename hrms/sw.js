/* ============================================================
   Growthic HRMS — Service Worker
   Scope: /hrms/
   Strategy:
   - Navigation (HTML): network-first, cache fallback
   - JS/CSS: network-first, cache fallback (offline only)
   - Other static assets: cache-first, populate on miss
   - Supabase API + external: always network (no caching)
   ============================================================ */

const CACHE = 'growthic-hrms-v28'

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(['/hrms']))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  const req = e.request
  const url = new URL(req.url)

  if (req.method !== 'GET') return
  if (url.hostname !== self.location.hostname) return

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone()
          caches.open(CACHE).then(c => c.put(req, copy))
          return res
        })
        .catch(() =>
          caches.match(req)
            .then(r => r || caches.match('/hrms'))
        )
    )
    return
  }

  // Code files (JS / CSS): network-first, so a deploy is picked up on the very next load.
  // The saved copy is only an offline fallback. (Cache-first here is what made every
  // release need two reloads: the first visit ran the old saved files.)
  if (req.destination === 'script' || req.destination === 'style' || /\.(js|css)$/.test(url.pathname)) {
    // cache:'no-cache' makes the browser re-check with the server even when the host
    // sends a long Cache-Control max-age (the shared host sends 7 days). Unchanged
    // files come back as a tiny 304, changed files come back fresh.
    e.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then(res => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then(c => c.put(req, copy))
          }
          return res
        })
        .catch(() => caches.match(req))
    )
    return
  }

  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached
      return fetch(req).then(res => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(CACHE).then(c => c.put(req, copy))
        }
        return res
      })
    })
  )
})
