/* ============================================================
   Growthic One — Service Worker
   Strategy:
   - Navigation (HTML): network-first, cache fallback
   - Static assets (JS/CSS/images): cache-first, then network
   - Supabase API + external: always network (no caching)
   - Push notifications: show + handle tap to open correct page
   ============================================================ */

const CACHE = 'growthic-v14'

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

  // Static assets: cache-first, populate on miss
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
