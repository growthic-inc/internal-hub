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
      _renderHeader()
      _setupUserMenu()
      _setupLogout()
      _initTheme()
      _initMobileNav()

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

  /* ── Header ─────────────────────────────────────────────── */
  function _renderHeader() {
    const avatar = document.getElementById('user-avatar')
    if (avatar && _currentUser) {
      avatar.textContent = Utils.getInitials(_currentUser.name || '?')
      if (_currentUser.profile_image_url) {
        avatar.innerHTML = `<img src="${Utils.escapeHtml(_currentUser.profile_image_url)}"
          alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
      }
    }
    const info = document.getElementById('user-dropdown-info')
    if (info && _currentUser) {
      info.innerHTML = `
        <div style="font-weight:600;font-size:13px;">${Utils.escapeHtml(_currentUser.name || '—')}</div>
        <div style="font-size:11px;color:var(--text-muted);">${Utils.escapeHtml(_currentUser.role || '')} · HRMS Admin</div>
      `
    }
  }

  /* ── User menu ───────────────────────────────────────────── */
  function _setupUserMenu() {
    const btn      = document.getElementById('user-avatar-btn')
    const dropdown = document.getElementById('user-dropdown')
    if (!btn || !dropdown) return

    btn.addEventListener('click', e => {
      e.stopPropagation()
      dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none'
    })
    document.addEventListener('click', () => { dropdown.style.display = 'none' })
  }

  function _setupLogout() {
    document.getElementById('logout-btn')?.addEventListener('click', async () => {
      await Auth.signOut()
      window.location.href = '/'
    })
  }

  /* ── Theme ───────────────────────────────────────────────── */
  function _initTheme() {
    const btn  = document.getElementById('theme-toggle-btn')
    const sun  = document.getElementById('theme-icon-sun')
    const moon = document.getElementById('theme-icon-moon')
    if (!btn) return

    function _apply(isDark) {
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
      localStorage.setItem('theme', isDark ? 'dark' : 'light')
      if (sun)  sun.style.display  = isDark ? 'block' : 'none'
      if (moon) moon.style.display = isDark ? 'none'  : 'block'
    }

    _apply(document.documentElement.getAttribute('data-theme') === 'dark')
    btn.addEventListener('click', () => {
      _apply(document.documentElement.getAttribute('data-theme') !== 'dark')
    })
  }

  /* ── Mobile nav ─────────────────────────────────────────── */
  function _initMobileNav() {
    const hamburger = document.getElementById('hamburger-btn')
    const sidebar   = document.getElementById('sidebar')
    const overlay   = document.getElementById('sidebar-overlay')
    if (!hamburger || !sidebar) return

    const open  = () => { sidebar.classList.add('sidebar--open'); overlay?.classList.add('sidebar-overlay--visible') }
    const close = () => { sidebar.classList.remove('sidebar--open'); overlay?.classList.remove('sidebar-overlay--visible') }

    hamburger.addEventListener('click', () => sidebar.classList.contains('sidebar--open') ? close() : open())
    overlay?.addEventListener('click', close)

    // Close on nav click (mobile)
    document.querySelectorAll('.hrms-nav-item').forEach(el => {
      el.addEventListener('click', () => { if (window.innerWidth <= 768) close() })
    })
  }

  // Boot when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }

})()
