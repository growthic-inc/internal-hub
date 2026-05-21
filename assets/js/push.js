/* ============================================================
   PUSH — Web Push subscription manager
   Requests permission via user-gesture banner (required on iOS
   and Android), saves subscription to Supabase, handles
   re-subscription after VAPID key rotation.
   ============================================================ */

const Push = (() => {

  // VAPID public key — safe to be in client-side code.
  // If this key ever changes, existing subscriptions will be detected
  // as stale and automatically re-subscribed with the new key.
  const VAPID_PUBLIC_KEY = 'BKGOJMcLo--_s-BSyRWn0CzHqMk_M8-MvlC-ljun7sdG6exM-XSnqxzP2iiZEUE80ht5M65-RSAuLi5CthtzNjk'

  function _urlBase64ToUint8Array(b64) {
    const padding = '='.repeat((4 - (b64.length % 4)) % 4)
    const base64  = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/')
    const raw     = atob(base64)
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
  }

  // Returns true if the existing PushSubscription was made with the current VAPID key.
  // If keys don't match the push service will 401-reject every message — we must
  // unsubscribe and re-subscribe with the new key.
  function _subscriptionKeyMatches(sub) {
    const storedKey = sub.options?.applicationServerKey
    if (!storedKey) return false
    const stored  = new Uint8Array(storedKey)
    const current = _urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    return stored.length === current.length && stored.every((b, i) => b === current[i])
  }

  // Detect iOS standalone (home-screen) mode
  function _isIOSStandalone() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) && window.navigator.standalone === true
  }

  async function init(user) {
    if (!('serviceWorker' in navigator)) { console.warn('[Push] service workers not supported'); return }
    if (!('PushManager' in window))      { console.warn('[Push] PushManager not available (iOS < 16.4 or non-standalone?)'); return }
    if (Notification.permission === 'denied') { console.warn('[Push] permission denied'); return }

    console.log('[Push] init, permission:', Notification.permission, '| iOS standalone:', _isIOSStandalone())

    try {
      let reg
      try {
        reg = await navigator.serviceWorker.ready
      } catch {
        reg = await navigator.serviceWorker.register('/sw.js')
        await navigator.serviceWorker.ready
      }

      const existing = await reg.pushManager.getSubscription()
      console.log('[Push] existing subscription:', existing ? existing.endpoint.slice(0, 60) + '…' : 'none')

      if (existing) {
        if (_subscriptionKeyMatches(existing)) {
          console.log('[Push] key matches — syncing subscription to DB')
          await _save(existing, user.id)
          return
        }
        console.warn('[Push] VAPID key mismatch — unsubscribing stale subscription and re-subscribing')
        await existing.unsubscribe()
      }

      if (Notification.permission === 'granted') {
        if (_isIOSStandalone()) {
          // iOS requires a user gesture even when permission is already granted;
          // show the banner so the tap provides the gesture context for subscribe().
          console.log('[Push] iOS standalone + permission granted — showing banner for user-gesture re-subscribe')
          _showPermissionBanner(reg, user.id)
        } else {
          console.log('[Push] permission already granted — subscribing silently')
          await _subscribe(reg, user.id)
        }
        return
      }

      // Always show the banner — Chrome on Android blocks requestPermission()
      // without a user gesture, so the auto-timeout approach silently fails.
      console.log('[Push] showing permission banner')
      _showPermissionBanner(reg, user.id)
    } catch (err) {
      console.warn('[Push] init error:', err)
    }
  }

  function _showPermissionBanner(reg, employeeId) {
    if (sessionStorage.getItem('push-banner-dismissed')) return
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

  // Called when permission hasn't been requested yet — asks first, then subscribes.
  async function _requestAndSubscribe(reg, employeeId) {
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') return
      await _subscribe(reg, employeeId)
    } catch (err) {
      console.warn('[Push] requestAndSubscribe error:', err)
    }
  }

  // Called when permission is already granted — subscribes directly.
  async function _subscribe(reg, employeeId) {
    try {
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: _urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })
      console.log('[Push] subscribed:', sub.endpoint.slice(0, 60) + '…')
      await _save(sub, employeeId)
    } catch (err) {
      console.warn('[Push] subscribe error:', err)
      _showError('Notification setup failed: ' + (err.message || String(err)))
    }
  }

  async function _save(sub, employeeId) {
    const json    = sub.toJSON()
    const { error } = await API.savePushSubscription({
      employee_id: employeeId,
      endpoint:    json.endpoint,
      p256dh:      json.keys.p256dh,
      auth:        json.keys.auth,
    })
    if (error) {
      console.warn('[Push] failed to save subscription to DB:', error)
      _showError('Notification registration failed: ' + (error.message || 'unknown error'))
    } else {
      console.log('[Push] subscription saved to DB ✓')
    }
  }

  function _showError(msg) {
    if (typeof Utils !== 'undefined' && Utils.showToast) {
      Utils.showToast(msg, 'error')
    } else {
      alert('[Push Error] ' + msg)
    }
  }

  // Manually trigger the push subscription flow (called from Settings).
  // Clears any "dismissed" flag so the banner can show again.
  async function enable(user) {
    sessionStorage.removeItem('push-banner-dismissed')
    await init(user)
  }

  // Returns a plain-text status string for display in Settings.
  async function status() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'not-supported'
    if (Notification.permission === 'denied')  return 'denied'
    if (Notification.permission === 'default') return 'not-asked'
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      return sub ? 'subscribed' : 'granted-no-sub'
    } catch { return 'error' }
  }

  return { init, enable, status }
})()
