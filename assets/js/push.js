/* ============================================================
   PUSH — Web Push subscription manager
   Requests permission via user-gesture banner (required on iOS
   PWA), saves subscription to Supabase, handles re-subscription
   across devices/browsers.
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

  // Detect iOS standalone (home-screen) mode
  function _isIOSStandalone() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) && window.navigator.standalone === true
  }

  async function init(user) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    if (Notification.permission === 'denied') return

    try {
      // Ensure SW is registered (may not be registered yet on first load)
      let reg
      try {
        reg = await navigator.serviceWorker.ready
      } catch (swErr) {
        console.warn('[Push] Service worker not ready, attempting registration:', swErr)
        reg = await navigator.serviceWorker.register('/sw.js')
        await navigator.serviceWorker.ready
      }

      const existing = await reg.pushManager.getSubscription()
      if (existing) {
        // Re-sync subscription on every login (handles key rotation + new devices)
        await _save(existing, user.id)
        return
      }

      if (Notification.permission !== 'default') return

      // iOS PWA requires the permission request to be triggered by a
      // user gesture — a setTimeout fires without gesture context and is
      // silently ignored. Show a banner instead; clicking it triggers the
      // real requestPermission() call.
      if (_isIOSStandalone()) {
        _showPermissionBanner(reg, user.id)
      } else {
        // Desktop and Android: auto-prompt after brief delay (user gesture
        // not required on these platforms)
        setTimeout(() => _requestAndSubscribe(reg, user.id), 4000)
      }
    } catch (err) {
      console.warn('[Push] init error:', err)
    }
  }

  function _showPermissionBanner(reg, employeeId) {
    // Don't show if already dismissed this session
    if (sessionStorage.getItem('push-banner-dismissed')) return
    // Don't show if already on the page
    if (document.getElementById('push-permission-banner')) return

    const banner = document.createElement('div')
    banner.id = 'push-permission-banner'
    banner.setAttribute('role', 'alert')
    banner.innerHTML = `
      <div style="
        position:fixed;bottom:72px;left:12px;right:12px;z-index:9999;
        background:#0F4799;color:#fff;
        border-radius:14px;padding:14px 16px;
        display:flex;align-items:center;gap:12px;
        box-shadow:0 4px 20px rgba(0,0,0,0.25);
        font-family:inherit;font-size:14px;line-height:1.4;
      ">
        <span style="font-size:20px;flex-shrink:0;">🔔</span>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;margin-bottom:2px;">Stay in the loop</div>
          <div style="opacity:0.85;font-size:12.5px;">Enable notifications for approvals, announcements & updates.</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">
          <button id="push-banner-allow" style="
            background:#fff;color:#0F4799;border:none;border-radius:8px;
            padding:6px 14px;font-size:13px;font-weight:600;cursor:pointer;
          ">Allow</button>
          <button id="push-banner-dismiss" style="
            background:transparent;color:rgba(255,255,255,0.7);border:none;
            padding:4px 0;font-size:12px;cursor:pointer;text-align:center;
          ">Not now</button>
        </div>
      </div>`

    document.body.appendChild(banner)

    document.getElementById('push-banner-allow').addEventListener('click', async () => {
      banner.remove()
      await _requestAndSubscribe(reg, employeeId)
    })
    document.getElementById('push-banner-dismiss').addEventListener('click', () => {
      banner.remove()
      sessionStorage.setItem('push-banner-dismissed', '1')
    })
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
