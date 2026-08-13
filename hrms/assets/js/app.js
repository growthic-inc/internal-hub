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

  /* ── Access matrix — deliberately stricter than Growthic One's App.hasAccess.
     Only super_admin bypasses. Everyone else — including role='admin' — is
     checked against their department's actual access_matrix row every time.
     Getting into /hrms via Portal Access only opens the front door; each
     module still enforces its own rule independently. ── */
  const ACCESS_LEVELS = {
    no_access:   0,
    view_only:   1,
    can_upload:  2,
    can_edit:    3,
    can_manage:  4,
    can_approve: 5,
  }

  let _matrix = null // null = super_admin bypass; otherwise { [module]: { [feature]: level } }

  async function _loadAccessMatrix() {
    if (_currentUser.role === 'super_admin') {
      _matrix = null
      return
    }
    if (!_currentUser.department_id) {
      _matrix = {}
      return
    }
    const knownFeatures = {}
    ModuleRegistry.getAll().forEach(m => {
      knownFeatures[m.key] = new Set(Object.keys(m.features || {}))
    })
    const { data } = await API.getAccessMatrix(_currentUser.department_id)
    _matrix = {}
    ;(data || []).forEach(row => {
      if (!knownFeatures[row.module])                   return
      if (!knownFeatures[row.module].has(row.feature))  return
      if (!_matrix[row.module]) _matrix[row.module] = {}
      _matrix[row.module][row.feature] = row.access_level
    })
  }

  function hasAccess(module, feature, minLevel = 'view_only') {
    if (_matrix === null) return true // super_admin only
    const level = _matrix[module]?.[feature]
    if (!level) return false
    return (ACCESS_LEVELS[level] || 0) >= (ACCESS_LEVELS[minLevel] || 0)
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

      // 4b. Load this user's real per-module access — Portal Access only
      //     got them through the front door; each module still checks its
      //     own rule from here on.
      await _loadAccessMatrix()

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
