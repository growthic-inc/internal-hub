/* ============================================================
   PUSH — Web Push subscription manager
   Requests permission after login, saves subscription to
   Supabase, handles re-subscription across devices/browsers.
   ============================================================ */

const Push = (() => {

  // VAPID public key — safe to be in client-side code
  const VAPID_PUBLIC_KEY = 'BK7vlTayESXa8K2_9lE5yjnmXKlLRq9BMmyqSs8JMBv7s3mcHnGNMJs1Na0zYcpBjwUsG2nU5KkwwsJXpaLMwi4'

  function _urlBase64ToUint8Array(b64) {
    const padding = '='.repeat((4 - (b64.length % 4)) % 4)
    const base64  = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/')
    const raw     = atob(base64)
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
  }

  async function init(user) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    if (Notification.permission === 'denied') return

    try {
      const reg      = await navigator.serviceWorker.ready
      const existing = await reg.pushManager.getSubscription()

      if (existing) {
        // Sync subscription to server on every login (handles key rotation)
        await _save(existing, user.id)
        return
      }

      // Don't ask immediately — wait a few seconds so the UI is fully loaded
      if (Notification.permission === 'default') {
        setTimeout(() => _requestAndSubscribe(reg, user.id), 4000)
      }
    } catch (err) {
      console.warn('[Push] init error:', err)
    }
  }

  async function _requestAndSubscribe(reg, employeeId) {
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') return

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: _urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })
      await _save(sub, employeeId)
    } catch (err) {
      console.warn('[Push] subscribe error:', err)
    }
  }

  async function _save(sub, employeeId) {
    const json = sub.toJSON()
    await API.savePushSubscription({
      employee_id: employeeId,
      endpoint:    json.endpoint,
      p256dh:      json.keys.p256dh,
      auth:        json.keys.auth,
    })
  }

  return { init }
})()
