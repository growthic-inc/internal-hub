/* ============================================================
   GROWTHIC ONE — App Shell
   Handles auth guard, sidebar, header, and hash-based routing.
   ============================================================ */

const App = (() => {

  /* ── Inline SVG icons for sidebar nav ─────────────────────── */
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
  }

  /* ── Nav config ────────────────────────────────────────────── */
  /* Each entry: id = hash route, module = page JS object, roles = who can see it */
  const NAV = [
    { id: 'client-dashboard', label: 'Client Dashboard', icon: ICONS.barChart,   module: () => ClientDashboard, roles: ['super_admin', 'founders_office', 'team_lead', 'delivery'] },
    { id: 'client-directory', label: 'Client Directory', icon: ICONS.briefcase,  module: () => ClientDirectory, roles: ['super_admin', 'founders_office', 'team_lead', 'delivery', 'bde'] },
    { id: 'master-folders',   label: 'Master Folders',   icon: ICONS.folder,     module: () => MasterFolders,   roles: ['super_admin', 'founders_office', 'team_lead', 'delivery'] },
    { id: 'timesheet',        label: 'Timesheet',         icon: ICONS.clock,      module: () => Timesheet,       roles: ['super_admin', 'founders_office', 'team_lead', 'delivery', 'hr', 'bde'] },
    { id: 'reimbursements',   label: 'Reimbursements',   icon: ICONS.creditCard, module: () => Reimbursements,  roles: ['super_admin', 'founders_office', 'team_lead', 'delivery', 'hr', 'bde'] },
    { id: 'assets',           label: 'Asset Management', icon: ICONS.box,        module: () => Assets,          roles: ['super_admin', 'founders_office', 'team_lead', 'delivery', 'hr', 'bde'] },
    { id: 'tools',            label: 'Tools & Subs',     icon: ICONS.tool,       module: () => Tools,           roles: ['super_admin', 'founders_office', 'team_lead', 'delivery', 'hr', 'bde'] },
    { id: 'access-control',   label: 'Access Control',   icon: ICONS.shield,     module: () => AccessControl,   roles: ['super_admin'] },
    { id: 'settings',         label: 'Settings',          icon: ICONS.settings,   module: () => Settings,        roles: ['super_admin', 'founders_office', 'team_lead', 'delivery', 'hr', 'bde'] },
  ]

  /* ── State ─────────────────────────────────────────────────── */
  let currentUser = null

  /* ── Boot ──────────────────────────────────────────────────── */
  async function init() {
    const session = await Auth.requireAuth()
    if (!session) return

    currentUser = await Auth.getCurrentUser()
    if (!currentUser) {
      await Auth.signOut()
      window.location.href = 'index.html'
      return
    }

    _renderSidebar()
    _renderHeaderUser()
    _setupUserMenu()
    _setupLogout()
    _loadNotificationCount()

    router()
    window.addEventListener('hashchange', router)
  }

  /* ── Sidebar ────────────────────────────────────────────────── */
  function _renderSidebar() {
    const nav    = document.getElementById('sidebar-nav')
    const footer = document.getElementById('sidebar-footer')
    if (!nav || !footer) return

    const accessible = NAV.filter(item => item.roles.includes(currentUser.role))

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
        </div>
      </div>
    `
  }

  /* ── Header user ────────────────────────────────────────────── */
  function _renderHeaderUser() {
    const avatar = document.getElementById('user-avatar')
    const info   = document.getElementById('user-dropdown-info')
    if (avatar) avatar.textContent = Utils.getInitials(currentUser.name)
    if (info) info.innerHTML = `
      <div class="dropdown-user-name">${Utils.escapeHtml(currentUser.name)}</div>
      <div class="dropdown-user-role">${Utils.getRoleLabel(currentUser.role)}</div>
    `
  }

  /* ── User dropdown ──────────────────────────────────────────── */
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

  /* ── Logout ─────────────────────────────────────────────────── */
  function _setupLogout() {
    const btn = document.getElementById('logout-btn')
    if (!btn) return
    btn.addEventListener('click', async () => {
      btn.textContent = 'Signing out…'
      btn.disabled = true
      await Auth.signOut()
      window.location.href = 'index.html'
    })
  }

  /* ── Notification count ─────────────────────────────────────── */
  async function _loadNotificationCount() {
    const { data } = await API.getUnreadNotifications(currentUser.id)
    if (!data || data.length === 0) return
    const badge = document.getElementById('notif-badge')
    if (badge) {
      badge.textContent = data.length > 9 ? '9+' : data.length
      badge.style.display = 'flex'
    }
  }

  /* ── Router ─────────────────────────────────────────────────── */
  function router() {
    const hash  = window.location.hash.slice(1)
    const route = hash || _getDefaultRoute()
    _loadPage(route)
  }

  function _getDefaultRoute() {
    const accessible = NAV.filter(item => item.roles.includes(currentUser.role))
    return accessible.length ? accessible[0].id : 'settings'
  }

  function _loadPage(route) {
    const navItem = NAV.find(n => n.id === route)

    /* Unknown route or no access → redirect to default */
    if (!navItem || !navItem.roles.includes(currentUser.role)) {
      window.location.hash = _getDefaultRoute()
      return
    }

    /* Update active nav link */
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('nav-item--active', el.dataset.route === route)
    })

    /* Update page title in header */
    const titleEl = document.getElementById('page-title')
    if (titleEl) titleEl.textContent = navItem.label

    /* Render page content */
    const pageModule = navItem.module()
    const content    = document.getElementById('page-content')
    if (!content) return

    content.innerHTML = pageModule.render(currentUser)
    if (pageModule.init) pageModule.init(currentUser)
  }

  return { init }
})()

/* ── Bootstrap ─────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', App.init)
