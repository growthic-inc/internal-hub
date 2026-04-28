/* ============================================================
   GROWTHIC ONE — App Shell
   Sidebar, header, and hash-based router.
   ============================================================ */

const App = (() => {

  const ICONS = {
    barChart:   `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>`,
    briefcase:  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>`,
    folder:     `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`,
    clock:      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
    creditCard: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>`,
    box:        `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"></line><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>`,
    tool:       `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>`,
    shield:     `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>`,
    settings:   `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`,
    sliders:    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="6" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="4" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="8" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="4" x2="15" y2="4"/><line x1="17" y1="16" x2="23" y2="16"/></svg>`,
  }

  const ALL_ROLES = ['super_admin', 'founders_office', 'team_lead', 'delivery', 'hr', 'bde', 'finance', 'employee']

  // Maps NAV route IDs → department_permissions module keys
  const PERM_MODULE = {
    'client-dashboard': 'client_dashboard',
    'client-directory': 'client_directory',
    'master-folders':   'client_repository',
    'timesheet':        'timesheet',
    'reimbursements':   'reimbursements',
    'assets':           'asset_management',
    'tools':            'tools_subscriptions',
    // access-control, permissions, settings: no perm check — role-gated only
  }

  const NAV = [
    { id: 'client-dashboard', label: 'Client Dashboard', icon: ICONS.barChart,   module: () => ClientDashboard, roles: ['super_admin', 'founders_office', 'team_lead', 'delivery'] },
    { id: 'client-directory', label: 'Client Directory', icon: ICONS.briefcase,  module: () => ClientDirectory, roles: ['super_admin', 'founders_office', 'team_lead', 'delivery', 'bde'] },
    { id: 'master-folders',   label: 'Client Repository', icon: ICONS.folder,     module: () => MasterFolders,   roles: ['super_admin', 'founders_office', 'team_lead', 'delivery'] },
    { id: 'timesheet',        label: 'Timesheet',         icon: ICONS.clock,      module: () => Timesheet,       roles: ['super_admin', 'founders_office', 'team_lead', 'delivery', 'hr', 'bde'] },
    { id: 'reimbursements',   label: 'Reimbursements',   icon: ICONS.creditCard, module: () => Reimbursements,  roles: ALL_ROLES },
    { id: 'assets',           label: 'Asset Management', icon: ICONS.box,        module: () => Assets,          roles: ALL_ROLES },
    { id: 'tools',            label: 'Tools & Subs',     icon: ICONS.tool,       module: () => Tools,           roles: ALL_ROLES },
    { id: 'access-control',   label: 'People',           icon: ICONS.shield,     module: () => AccessControl,   roles: ['super_admin', 'hr'] },
    { id: 'permissions',      label: 'Permissions',      icon: ICONS.sliders,    module: () => Permissions,     roles: ['super_admin'] },
    { id: 'settings',         label: 'Settings',          icon: ICONS.settings,   module: () => Settings,        roles: ALL_ROLES },
  ]

  let currentUser = null
  let _perms      = null  // null = super_admin bypass; {} = loaded dept perms

  /* ── Permissions ─────────────────────────────────────────── */
  async function _loadPermissions() {
    if (currentUser.role === 'super_admin') {
      _perms = null  // null = full access everywhere
      return
    }
    if (!currentUser.department) {
      _perms = {}    // no dept → deny by default (safety)
      return
    }
    const { data } = await API.getDepartmentPermissions(currentUser.department)
    _perms = {}
    ;(data || []).forEach(row => { _perms[row.module] = row })
  }

  function getPerms(moduleKey) {
    if (_perms === null) {
      // super_admin — full access
      return { can_view: true, can_create: true, can_edit: true, can_approve: true }
    }
    const p = _perms[moduleKey]
    if (!p) {
      // Module not in DB for this dept → open access (avoid accidental lockout)
      return { can_view: true, can_create: true, can_edit: true, can_approve: true }
    }
    return {
      can_view:    p.can_view    ?? false,
      can_create:  p.can_create  ?? false,
      can_edit:    p.can_edit    ?? false,
      can_approve: p.can_approve ?? false,
    }
  }

  function renderAccessDenied(label) {
    return `
      <div class="empty-state-full">
        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--border)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
        <h3 style="font-size:16px;font-weight:600;color:var(--text);margin:0 0 6px;">Access Restricted</h3>
        <p style="font-size:14px;color:var(--text-muted);margin:0;">
          Your department doesn't have permission to view ${label}.
        </p>
        <p style="font-size:13px;color:var(--text-muted);margin:6px 0 0;">
          Contact your Super Admin to request access.
        </p>
      </div>
    `
  }

  async function init() {
    const session = await Auth.requireAuth()
    if (!session) return

    currentUser = await Auth.getCurrentUser()
    if (!currentUser) {
      await Auth.signOut()
      window.location.href = '/'
      return
    }

    await _loadPermissions()

    _renderSidebar()
    _renderHeaderUser()
    _setupUserMenu()
    _setupLogout()
    _loadNotificationCount()

    router()
    window.addEventListener('hashchange', router)
  }

  function _renderSidebar() {
    const nav    = document.getElementById('sidebar-nav')
    const footer = document.getElementById('sidebar-footer')
    if (!nav || !footer) return

    const accessible = NAV.filter(item => {
      if (!item.roles.includes(currentUser.role)) return false
      if (currentUser.role === 'super_admin') return true
      const permKey = PERM_MODULE[item.id]
      if (!permKey) return true  // settings / permissions / people — role-gated only
      return getPerms(permKey).can_view
    })

    nav.innerHTML = accessible.map(item => `
      <a class="nav-item" data-route="${item.id}" href="#${item.id}">
        <span class="nav-icon">${item.icon}</span>
        <span class="nav-label">${item.label}</span>
      </a>
    `).join('')

    footer.innerHTML = `
      <div class="sidebar-user">
        <div class="sidebar-user-avatar">${Utils.getInitials(currentUser.name)}</div>
        <div class="sidebar-user-info">
          <div class="sidebar-user-name">${Utils.escapeHtml(currentUser.name)}</div>
          <div class="sidebar-user-role">${Utils.getRoleLabel(currentUser.role)}</div>
          ${currentUser.department
            ? `<div class="sidebar-user-dept">${Utils.getDeptLabel(currentUser.department)}</div>`
            : ''}
        </div>
      </div>
    `
  }

  function _renderHeaderUser() {
    const avatar = document.getElementById('user-avatar')
    const info   = document.getElementById('user-dropdown-info')
    if (avatar) avatar.textContent = Utils.getInitials(currentUser.name)
    if (info) info.innerHTML = `
      <div class="dropdown-user-name">${Utils.escapeHtml(currentUser.name)}</div>
      <div class="dropdown-user-role">${Utils.getRoleLabel(currentUser.role)}</div>
      ${currentUser.department
        ? `<div class="dropdown-user-dept">${Utils.getDeptLabel(currentUser.department)}</div>`
        : ''}
    `
  }

  function _setupUserMenu() {
    const btn      = document.getElementById('user-avatar-btn')
    const dropdown = document.getElementById('user-dropdown')
    if (!btn || !dropdown) return

    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none'
    })
    document.addEventListener('click', () => {
      if (dropdown) dropdown.style.display = 'none'
    })
  }

  function _setupLogout() {
    const btn = document.getElementById('logout-btn')
    if (!btn) return
    btn.addEventListener('click', async () => {
      btn.textContent = 'Signing out…'
      btn.disabled = true
      await Auth.signOut()
      window.location.href = '/'
    })
  }

  async function _loadNotificationCount() {
    const { data } = await API.getUnreadNotifications(currentUser.id)
    if (!data || data.length === 0) return
    const badge = document.getElementById('notif-badge')
    if (badge) {
      badge.textContent = data.length > 9 ? '9+' : data.length
      badge.style.display = 'flex'
    }
  }

  function router() {
    const hash  = window.location.hash.slice(1)
    const route = hash || _getDefaultRoute()
    if (!route) { _renderNoAccess(); return }
    _loadPage(route)
  }

  function _renderNoAccess() {
    const titleEl = document.getElementById('page-title')
    const content = document.getElementById('page-content')
    if (titleEl) titleEl.textContent = 'No Access'
    if (content) content.innerHTML = `
      <div class="empty-state-full">
        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--border)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
        <h3 style="font-size:16px;font-weight:600;color:var(--text);margin:0 0 6px;">No modules available</h3>
        <p style="font-size:14px;color:var(--text-muted);margin:0;">
          Your account doesn't have access to any modules yet.
        </p>
        <p style="font-size:13px;color:var(--text-muted);margin:6px 0 0;">
          Contact your Super Admin to get access configured.
        </p>
      </div>
    `
  }

  function _getDefaultRoute() {
    const accessible = NAV.filter(item => {
      if (!item.roles.includes(currentUser.role)) return false
      if (currentUser.role === 'super_admin') return true
      const permKey = PERM_MODULE[item.id]
      if (!permKey) return true
      return getPerms(permKey).can_view
    })
    return accessible.length ? accessible[0].id : null
  }

  function _loadPage(route) {
    const navItem = NAV.find(n => n.id === route)
    if (!navItem || !navItem.roles.includes(currentUser.role)) {
      const fallback = _getDefaultRoute()
      if (fallback) { window.location.hash = fallback } else { _renderNoAccess() }
      return
    }

    // Permission check: redirect if can_view is false for this route
    if (currentUser.role !== 'super_admin') {
      const permKey = PERM_MODULE[route]
      if (permKey && !getPerms(permKey).can_view) {
        const fallback = _getDefaultRoute()
        if (fallback) { window.location.hash = fallback } else { _renderNoAccess() }
        return
      }
    }

    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('nav-item--active', el.dataset.route === route)
    })

    const titleEl = document.getElementById('page-title')
    if (titleEl) titleEl.textContent = navItem.label

    const pageModule = navItem.module()
    const content    = document.getElementById('page-content')
    if (!content) return

    content.innerHTML = pageModule.render(currentUser)
    if (pageModule.init) pageModule.init(currentUser)
  }

  return { init, getPerms, renderAccessDenied }
})()

document.addEventListener('DOMContentLoaded', App.init)
