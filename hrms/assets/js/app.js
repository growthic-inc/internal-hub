/* ============================================================
   Growthic HRMS — App Shell
   Auth guard: delegates to PlatformConfig (Portal Access) —
   see app/assets/js/platform-config.js for the actual rule.
   Hash-based router: #payroll, #people, #leave (future)
   ============================================================ */

const HRMSApp = (() => {

  let _currentUser  = null

  /* ── NAV driven by ModuleRegistry — add a page file to add a route ──
     Each module may declare an optional `access: (user) => boolean` in its
     ModuleRegistry.register() call. If present, it controls whether the
     module appears in the sidebar and whether the router will land on it.
     Modules with no `access` field are visible to anyone who already
     passed the Portal Access gate (e.g. nothing sensitive to hide). ── */
  const NAV = ModuleRegistry.getAll().map(m => ({
    id:     m.routeId,
    label:  m.label,
    icon:   m.icon,
    module: m.getModule,
    access: m.access || null,
  }))

  let _activeRoute = NAV[0]?.id || 'payroll'

  /* ── Access — Portal Access is the permission ─────────────────────────
     Anyone who got through the Portal Access gate in init() (a super_admin,
     or an employee granted HRMS) can use every HRMS module; there is no
     second per-department matrix to configure. Rules that belong to a
     specific role stay inside their own modules (e.g. Payroll is People &
     Culture / Super Admin, marking a reimbursement paid is Finance / Super
     Admin, Knowledge Labs is Admin / Super Admin). hasAccess() is kept so
     the existing call sites in the page files keep working. ── */
  function hasAccess() {
    return true
  }

  /* ── Boot ───────────────────────────────────────────────── */
  async function init() {
    try {
      // 1. Auth check — redirect to login if no session
      const session = await Auth.requireAuth('/home/hrms')
      if (!session) return

      // 2. Load current user
      _currentUser = await Auth.getCurrentUser()
      if (!_currentUser) {
        await Auth.signOut()
        window.location.href = '/'
        return
      }

      // 3. Access guard — single source of truth is PlatformConfig
      //    (super_admin bypass, or an explicit Portal Access grant)
      const isAllowed = PlatformConfig.getById('growthic-hrms').access(_currentUser)

      if (!isAllowed) {
        window.location.href = '/home'
        return
      }

      // 4. Load dept cache for label resolution
      try {
        const { data } = await API.getDepartments()
        if (data) Utils.setDeptCache(data)
      } catch (_) {}

      // 5. Render chrome
      _renderSidebar()
      Shell.renderHeaderUser(_currentUser)
      Shell.initUserMenu()
      Shell.initLogout()
      Shell.initTheme()
      Shell.initMobileNav()
      Shell.initAppSwitcher('growthic-hrms', _currentUser)

      // 6. Route
      _router()
      window.addEventListener('hashchange', _router)

      // 7. Watch for Portal Access revocation while this session is open
      _watchPortalAccess()

    } catch (err) {
      console.error('[HRMS] init() failed:', err)
      const content = document.getElementById('page-content')
      if (content) content.innerHTML = `
        <div style="padding:32px;color:var(--danger,#EF4444);">
          <strong>HRMS failed to load.</strong><br>
          <code style="font-size:12px;">${err?.message || String(err)}</code>
        </div>`
    }
  }

  // A module with no `access` field is open to anyone past the front door.
  // One with an `access` function must pass it — checked fresh every time,
  // never cached from a previous route.
  function _visibleNav() {
    return NAV.filter(item => !item.access || item.access(_currentUser))
  }

  /* ── Router ─────────────────────────────────────────────── */
  function _router() {
    const visible = _visibleNav()
    const hash    = window.location.hash.slice(1) || visible[0]?.id
    let   item    = visible.find(n => n.id === hash)

    // Either no hash, or the requested module isn't one this user can
    // access — fall back to the first module they're actually allowed to
    // see, rather than silently rendering something they shouldn't reach.
    if (!item) item = visible[0]
    if (!item) {
      const content = document.getElementById('page-content')
      if (content) content.innerHTML = `<div style="padding:32px;color:var(--text-muted);">No HRMS modules are available for your account.</div>`
      return
    }

    _activeRoute = item.id

    // Update active nav link
    document.querySelectorAll('.hrms-nav-item').forEach(el => {
      el.classList.toggle('nav-item--active', el.dataset.route === _activeRoute)
    })

    // Update page title
    const titleEl = document.getElementById('page-title')
    if (titleEl) titleEl.textContent = item.label

    // Render module
    const mod = item.module()
    const content = document.getElementById('page-content')
    if (!content) return

    if (typeof mod.render === 'function') {
      content.innerHTML = mod.render(_currentUser)
    }
    if (typeof mod.init === 'function') {
      mod.init(_currentUser)
    }
  }

  /* ── Sidebar ─────────────────────────────────────────────── */
  function _renderSidebar() {
    const nav = document.getElementById('sidebar-nav')
    if (!nav) return

    nav.innerHTML = _visibleNav().map(item => `
      <a class="nav-item hrms-nav-item${_activeRoute === item.id ? ' nav-item--active' : ''}"
        data-route="${item.id}" href="#${item.id}">
        <span class="nav-icon">${item.icon}</span>
        <span class="nav-label">${item.label}</span>
      </a>
    `).join('')

    nav.querySelectorAll('.hrms-nav-item').forEach(el => {
      el.addEventListener('click', () => {
        nav.querySelectorAll('.hrms-nav-item').forEach(i => i.classList.remove('nav-item--active'))
        el.classList.add('nav-item--active')
      })
    })
  }

  /* ── Portal Access revoke watcher ───────────────────────── */
  // Super admins bypass the grant system entirely, so there's nothing to
  // watch for them. Everyone else: if their 'growthic-hrms' grant row is
  // deleted while they're active in this session, warn them and redirect
  // to /home after a short grace period.
  function _watchPortalAccess() {
    if (_currentUser.role === 'super_admin') return

    Config.supabase
      .channel('portal-access-watch')
      .on('postgres_changes', {
        event:  'DELETE',
        schema: 'public',
        table:  'portal_access',
        filter: `employee_id=eq.${_currentUser.id}`,
      }, (payload) => {
        if (payload.old?.portal_id !== 'growthic-hrms') return
        _showAccessRevokedBanner()
        setTimeout(() => { window.location.href = '/home' }, 4000)
      })
      .subscribe()
  }

  function _showAccessRevokedBanner() {
    const banner = document.createElement('div')
    banner.style.cssText = `
      position:fixed;top:0;left:0;right:0;z-index:9999;
      background:#FEE2E2;color:#B91C1C;border-bottom:1px solid #FCA5A5;
      padding:12px 20px;text-align:center;font-size:13px;font-weight:600;
    `
    banner.textContent = 'Your HRMS access has been removed — redirecting to Growthic One…'
    document.body.prepend(banner)
  }

  // Boot when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }

  return { hasAccess }

})()
