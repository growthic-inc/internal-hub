/* ============================================================
   Growthic One — Service Worker
   Strategy:
   - Navigation (HTML): network-first, cache fallback
   - JS/CSS: network-first, cache fallback (offline only)
   - Other static assets (images, fonts): cache-first, then network
   - Supabase API + external: always network (no caching)
   - Push notifications: show + handle tap to open correct page
   ============================================================ */

const CACHE = 'growthic-v132'

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
          const copy = res.clone()
          caches.open(CACHE).then(c => c.put(req, copy))
          return res
        })
        .catch(() =>
          caches.match(req)
            .then(r => r || caches.match('/'))
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

  // Other static assets (images, fonts): cache-first, populate on miss
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

// ── Push notifications ────────────────────────────────────────
self.addEventListener('push', e => {
  let data = { title: 'Growthic One', body: 'You have a new notification.', url: '/home' }
  try { if (e.data) data = { ...data, ...JSON.parse(e.data.text()) } } catch {}

  e.waitUntil(
    self.registration.showNotification(data.title, {
      body:    data.body,
      icon:    '/assets/img/favicon/android-chrome-192x192.png',
      badge:   '/assets/img/favicon/favicon-32x32.png',
      data:    { url: data.url },
      vibrate: [100, 50, 100],
    })
  )
})

// Open / focus the relevant page when a notification is tapped
self.addEventListener('notificationclick', e => {
  e.notification.close()
  const url = e.notification.data?.url || '/home'
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // Focus an existing window if open
      const match = list.find(c => c.url.includes(self.location.origin))
      if (match) return match.focus().then(w => w.navigate(url))
      return clients.openWindow(url)
    })
  )
})
