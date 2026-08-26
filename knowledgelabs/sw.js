/* ============================================================
   Knowledge Labs — Service Worker
   Scope: /knowledgelabs/
   Strategy:
   - Navigation (HTML): network-first, cache fallback
   - Static assets (JS/CSS): cache-first, populate on miss
   - Supabase API + external: always network (no caching)
   ============================================================ */

const CACHE = 'growthic-knowledgelabs-v3'

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(['/knowledgelabs']))
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
            .then(r => r || caches.match('/knowledgelabs'))
        )
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
