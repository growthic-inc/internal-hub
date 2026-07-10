/* ============================================================
   Growthic HRMS — App Shell
   Auth guard: super_admin or People & Culture only.
   Hash-based router: #payroll, #people, #leave (future)
   ============================================================ */

const HRMSApp = (() => {

  let _currentUser  = null
  let _activeRoute  = 'payroll'

  /* ── Sidebar nav items ──────────────────────────────────── */
  const NAV = [
    {
      id: 'payroll',
      label: 'Payroll',
      icon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`,
      module: () => Payroll,
    },
    // Future modules added here:
    // { id: 'people',       label: 'People Directory', ... }
    // { id: 'leave',        label: 'Leave Management', ... }
    // { id: 'compensation', label: 'Compensation',     ... }
  ]

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

      // 3. Access guard — HR or Super Admin only
      const isAllowed = _currentUser.role === 'super_admin' ||
        Utils.getDeptSystemKey(_currentUser.department) === 'people_culture'

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

      // 6. Route
      _router()
      window.addEventListener('hashchange', _router)

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

  /* ── Router ─────────────────────────────────────────────── */
  function _router() {
    const hash  = window.location.hash.slice(1) || 'payroll'
    const item  = NAV.find(n => n.id === hash) || NAV[0]
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

    nav.innerHTML = NAV.map(item => `
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

  // Boot when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }

})()
