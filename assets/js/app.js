/* ============================================================
   GROWTHIC ONE — App Shell
   Sidebar, header, and hash-based router.
   ============================================================ */

const App = (() => {

  // Icons only needed for special nav entries (Home, Access Control, Settings)
  // All other module icons live in their page files via ModuleRegistry.register()
  const ICONS = {
    sliders:  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="6" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="4" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="8" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="4" x2="15" y2="4"/><line x1="17" y1="16" x2="23" y2="16"/></svg>`,
    settings: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`,
  }

  const ALL_ROLES = ['super_admin', 'employee']

  const ICONS_EXTRA = {
    home: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>`,
  }

  // Derived from ModuleRegistry — populated by each page file's registration call.
  // Adding a new module only requires a ModuleRegistry.register() in its page file.
  const ROUTE_MODULE = Object.fromEntries(
    ModuleRegistry.getAll().map(m => [m.routeId, m.key])
  )

  const NAV = [
    // Home dashboard — always first, not access-gated
    { id: 'home', label: 'Home', icon: ICONS_EXTRA.home, module: () => HomeModule, roles: ALL_ROLES },
    // Registered modules — order controlled by the `order` field in each registration
    ...ModuleRegistry.getAll().map(m => ({
      id:     m.routeId,
      label:  m.label,
      icon:   m.icon,
      module: m.getModule,
      roles:  ALL_ROLES,
    })),
    // Access Control: special visibility gate (manage_access >= can_manage)
    { id: 'access-control', label: 'Access Control', icon: ICONS.sliders, module: () => Access, roles: ALL_ROLES,
      visibilityFeature: { module: 'people_hrms', feature: 'manage_access', minLevel: 'can_manage' } },
    { id: 'settings', label: 'Settings', icon: ICONS.settings, module: () => Settings, roles: ALL_ROLES },
  ]

  /* ── Access Level Hierarchy ─────────────────────────────── */
  const ACCESS_LEVELS = {
    no_access:   0,
    view_only:   1,
    can_upload:  2,
    can_edit:    3,
    can_manage:  4,
    can_approve: 5,
  }

  let currentUser = null

  // _matrix: null = super_admin (bypass all checks)
  // _matrix: { [module]: { [feature]: access_level_string } }
  let _matrix = null

  /* ── Load access matrix at login ───────────────────────── */
  async function _loadAccessMatrix() {
    if (currentUser.role === 'super_admin') {
      _matrix = null  // null = full access everywhere
      return
    }
    if (!currentUser.department) {
      _matrix = {}    // no dept → deny all
      return
    }
    const { data } = await API.getAccessMatrix(currentUser.department)
    _matrix = {}
    ;(data || []).forEach(row => {
      if (!_matrix[row.module]) _matrix[row.module] = {}
      _matrix[row.module][row.feature] = row.access_level
    })
  }

  /* ── hasAccess(module, feature, minLevel) ───────────────── */
  // Returns true if the user's access level for this feature >= minLevel
  // Super admin always returns true.
  // If a module/feature is not in the matrix, returns false (secure default).
  function hasAccess(module, feature, minLevel = 'view_only') {
    if (_matrix === null) return true  // super_admin bypass

    const moduleData = _matrix[module]
    if (!moduleData) return false

    const level = moduleData[feature]
    if (!level) return false

    return (ACCESS_LEVELS[level] || 0) >= (ACCESS_LEVELS[minLevel] || 0)
  }

  /* ── _canViewModule(navItem) ────────────────────────────── */
  // Returns true if this NAV item should be visible for the current user.
  // Uses visibilityFeature override when present; otherwise checks if
  // ANY feature in the route's module has access > no_access.
  function _canViewModule(navItem) {
    if (_matrix === null) return true  // super_admin sees everything

    // Route-specific feature override (e.g. access-control panel)
    if (navItem.visibilityFeature) {
      const { module, feature, minLevel } = navItem.visibilityFeature
      return hasAccess(module, feature, minLevel)
    }

    const moduleKey = ROUTE_MODULE[navItem.id]
    if (!moduleKey) return true  // settings etc — no access gate
    const moduleData = _matrix[moduleKey]
    if (!moduleData) return false
    return Object.values(moduleData).some(level => (ACCESS_LEVELS[level] || 0) > 0)
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
          Contact your Admin to request access.
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

    // Phase 8: Block the entire app until the employee completes their profile
    if (currentUser.profile_completed === false) {
      _showProfileCompletionWizard(currentUser)
      return
    }

    await _loadAccessMatrix()

    _renderSidebar()
    _renderHeaderUser()
    _setupUserMenu()
    _setupLogout()
    _loadNotificationCount()
    _initNotificationPanel()

    router()
    window.addEventListener('hashchange', router)
  }

  function _renderSidebar() {
    const nav    = document.getElementById('sidebar-nav')
    const footer = document.getElementById('sidebar-footer')
    if (!nav || !footer) return

    const accessible = NAV.filter(item => {
      if (!item.roles.includes(currentUser.role)) return false
      if (_matrix === null) return true  // super_admin sees all
      return _canViewModule(item)
    })

    nav.innerHTML = accessible.map(item => `
      <a class="nav-item" data-route="${item.id}" href="#${item.id}">
        <span class="nav-icon">${item.icon}</span>
        <span class="nav-label">${item.label}</span>
      </a>
    `).join('')

    footer.innerHTML = `
      <div class="sidebar-user">
        <div class="sidebar-user-avatar">${currentUser.profile_image_url ? `<img src="${Utils.escapeHtml(currentUser.profile_image_url)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">` : Utils.getInitials(currentUser.name)}</div>
        <div class="sidebar-user-info">
          <div class="sidebar-user-name">${Utils.escapeHtml(currentUser.name)}</div>
          <div class="sidebar-user-role">${currentUser.department ? Utils.getDeptLabel(currentUser.department) : Utils.getRoleLabel(currentUser.role)}</div>
        </div>
      </div>
    `
  }

  function _renderHeaderUser() {
    const avatar = document.getElementById('user-avatar')
    const info   = document.getElementById('user-dropdown-info')
    if (avatar) {
      if (currentUser.profile_image_url) {
        avatar.innerHTML = `<img src="${Utils.escapeHtml(currentUser.profile_image_url)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
      } else {
        avatar.textContent = Utils.getInitials(currentUser.name)
      }
    }
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
    _updateNotifBadge(data ? data.length : 0)
  }

  function _updateNotifBadge(count) {
    const badge = document.getElementById('notif-badge')
    if (!badge) return
    if (count > 0) {
      badge.textContent = count > 9 ? '9+' : count
      badge.style.display = 'flex'
    } else {
      badge.style.display = 'none'
    }
  }

  function _timeAgo(dateStr) {
    const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
    if (diff < 60)   return 'Just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return `${Math.floor(diff / 86400)}d ago`
  }

  function _notifIcon(type) {
    if (type === 'approval')  return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`
    if (type === 'rejection') return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
    return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
  }

  async function _openNotifPanel() {
    const panel = document.getElementById('notif-panel')
    const btn   = document.getElementById('notif-btn')
    if (!panel || !btn) return

    const isOpen = panel.style.display !== 'none'
    if (isOpen) { panel.style.display = 'none'; return }

    // Position relative to button (panel is in body, position:fixed)
    const rect = btn.getBoundingClientRect()
    panel.style.top   = `${rect.bottom + 8}px`
    panel.style.right = `${window.innerWidth - rect.right}px`

    panel.style.display = 'flex'
    panel.innerHTML = `<div class="notif-panel-loading">Loading…</div>`

    const { data: notifications } = await API.getRecentNotifications(currentUser.id)
    const items = notifications || []

    const unreadCount = items.filter(n => !n.read).length

    panel.innerHTML = `
      <div class="notif-panel-header">
        <span class="notif-panel-title">Notifications</span>
        ${unreadCount > 0 ? `<button class="notif-mark-all" id="notif-mark-all">Mark all read</button>` : ''}
      </div>
      <div class="notif-panel-body" id="notif-panel-body">
        ${items.length === 0
          ? `<div class="notif-empty">You're all caught up!</div>`
          : items.map(n => `
            <div class="notif-item${n.read ? '' : ' notif-item--unread'}" data-id="${n.id}">
              <div class="notif-item-icon">${_notifIcon(n.type)}</div>
              <div class="notif-item-body">
                <div class="notif-item-msg">${Utils.escapeHtml(n.message)}</div>
                <div class="notif-item-time">${_timeAgo(n.created_at)}</div>
              </div>
              ${!n.read ? `<div class="notif-item-dot"></div>` : ''}
            </div>
          `).join('')}
      </div>
    `

    document.getElementById('notif-mark-all')?.addEventListener('click', async () => {
      await API.markAllNotificationsRead(currentUser.id)
      _updateNotifBadge(0)
      panel.querySelectorAll('.notif-item--unread').forEach(el => {
        el.classList.remove('notif-item--unread')
        el.querySelector('.notif-item-dot')?.remove()
      })
      document.getElementById('notif-mark-all')?.remove()
    })

    panel.querySelectorAll('.notif-item--unread').forEach(el => {
      el.addEventListener('click', async () => {
        const id = el.dataset.id
        await API.markNotificationRead(id)
        el.classList.remove('notif-item--unread')
        el.querySelector('.notif-item-dot')?.remove()
        const remaining = panel.querySelectorAll('.notif-item--unread').length
        _updateNotifBadge(remaining)
        if (remaining === 0) document.getElementById('notif-mark-all')?.remove()
      })
    })
  }

  function _initNotificationPanel() {
    const btn = document.getElementById('notif-btn')
    if (!btn) return

    // Inject panel into body so overflow:hidden on parents doesn't clip it
    const existing = document.getElementById('notif-panel')
    if (!existing) {
      const panel = document.createElement('div')
      panel.id = 'notif-panel'
      panel.className = 'notif-panel'
      panel.style.display = 'none'
      document.body.appendChild(panel)
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      _openNotifPanel()
    })

    document.addEventListener('click', (e) => {
      const panel = document.getElementById('notif-panel')
      if (!panel) return
      if (!panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
        panel.style.display = 'none'
      }
    })

    // Realtime subscription for live badge updates
    Config.supabase
      .channel('notifications_live')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `recipient_employee_id=eq.${currentUser.id}`,
      }, () => {
        API.getUnreadNotifications(currentUser.id).then(({ data }) => {
          _updateNotifBadge(data ? data.length : 0)
        })
      })
      .subscribe()
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
          Contact your Admin to get access configured.
        </p>
      </div>
    `
  }

  function _getDefaultRoute() {
    const accessible = NAV.filter(item => {
      if (!item.roles.includes(currentUser.role)) return false
      if (_matrix === null) return true
      return _canViewModule(item)
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

    // Access gate: redirect if module is not visible
    if (_matrix !== null && !_canViewModule(navItem)) {
      const fallback = _getDefaultRoute()
      if (fallback) { window.location.hash = fallback } else { _renderNoAccess() }
      return
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

  /* ── Profile Completion Wizard ──────────────────────────────
     Shown full-screen to new employees on first login.
     Blocks all app access until the employee saves their profile.
  ─────────────────────────────────────────────────────────── */
  function _showProfileCompletionWizard(user) {
    // Render the full-page overlay into #page-content (sidebar hidden)
    const sidebar = document.querySelector('.sidebar')
    const header  = document.querySelector('.app-header')
    if (sidebar) sidebar.style.display = 'none'
    if (header)  header.style.display  = 'none'

    const content = document.getElementById('page-content')
    if (!content) return

    content.innerHTML = `
      <div class="profile-wizard-overlay">
        <div class="profile-wizard-card">
          <div class="profile-wizard-header">
            <div class="profile-wizard-logo">
              <img src="../assets/img/logo.jpg" alt="Growthic One" style="height:36px;">
            </div>
            <h2 class="profile-wizard-title">Welcome to Growthic One!</h2>
            <p class="profile-wizard-sub">Please complete your profile before continuing. This only takes a minute.</p>
          </div>

          <div id="pw-error"   class="form-error"   style="display:none;margin-bottom:12px;"></div>
          <div id="pw-success" class="form-success"  style="display:none;margin-bottom:12px;"></div>

          <form id="profile-wizard-form" autocomplete="off">

            <!-- Avatar -->
            <div class="pw-section-label">Profile Picture</div>
            <div class="pw-avatar-row">
              <div class="pw-avatar-preview" id="pw-avatar-preview">
                ${user.profile_image_url ? `<img src="${Utils.escapeHtml(user.profile_image_url)}" alt="">` : `<span>${Utils.getInitials(user.name)}</span>`}
              </div>
              <label class="btn btn--secondary btn--sm" style="cursor:pointer;">
                Upload Photo
                <input type="file" id="pw-avatar-file" accept="image/*" style="display:none;">
              </label>
            </div>

            <!-- Personal -->
            <div class="pw-section-label">Personal Details</div>
            <div class="people-field-grid">
              <div class="form-group">
                <label class="form-label">Date of Birth</label>
                <input type="date" id="pw-dob" class="form-input">
              </div>
              <div class="form-group">
                <label class="form-label">Personal Email</label>
                <input type="email" id="pw-personal-email" class="form-input" placeholder="personal@example.com">
              </div>
              <div class="form-group">
                <label class="form-label">Phone Number</label>
                <input type="tel" id="pw-phone" class="form-input" placeholder="+91 98765 43210">
              </div>
              <div class="form-group">
                <label class="form-label">Blood Group</label>
                <select id="pw-blood-group" class="form-input">
                  <option value="">Select</option>
                  ${['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(bg =>
                    `<option value="${bg}">${bg}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Residential Address</label>
              <textarea id="pw-address" class="form-input" rows="2" placeholder="House no., Street, City, State, PIN"></textarea>
            </div>
            <div class="form-group">
              <label class="form-label">LinkedIn URL</label>
              <input type="url" id="pw-linkedin" class="form-input" placeholder="https://linkedin.com/in/yourprofile">
            </div>

            <!-- Bank -->
            <div class="pw-section-label">Bank Details</div>
            <div class="people-field-grid">
              <div class="form-group">
                <label class="form-label">Bank Account Number</label>
                <input type="text" id="pw-bank-account" class="form-input" placeholder="Account number">
              </div>
              <div class="form-group">
                <label class="form-label">IFSC Code</label>
                <input type="text" id="pw-bank-ifsc" class="form-input" placeholder="e.g. HDFC0001234">
              </div>
            </div>

            <!-- Emergency Contact -->
            <div class="pw-section-label">Emergency Contact</div>
            <div class="people-field-grid">
              <div class="form-group">
                <label class="form-label">Contact Name <span class="required-star">*</span></label>
                <input type="text" id="pw-ec-name" class="form-input" placeholder="Full name" required>
              </div>
              <div class="form-group">
                <label class="form-label">Phone Number <span class="required-star">*</span></label>
                <input type="tel" id="pw-ec-phone" class="form-input" placeholder="+91 98765 43210" required>
              </div>
              <div class="form-group">
                <label class="form-label">Relationship <span class="required-star">*</span></label>
                <select id="pw-ec-relationship" class="form-input" required>
                  <option value="">Select</option>
                  <option value="Parent">Parent</option>
                  <option value="Spouse">Spouse</option>
                  <option value="Sibling">Sibling</option>
                  <option value="Child">Child</option>
                  <option value="Friend">Friend</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>

            <button type="submit" class="btn btn--primary" id="pw-submit-btn" style="width:100%;margin-top:8px;">
              Save Profile &amp; Continue
            </button>
          </form>
        </div>
      </div>
    `

    // Avatar preview
    const avatarFile = document.getElementById('pw-avatar-file')
    const avatarPreview = document.getElementById('pw-avatar-preview')
    if (avatarFile) {
      avatarFile.addEventListener('change', () => {
        const file = avatarFile.files[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = e => {
          avatarPreview.innerHTML = `<img src="${e.target.result}" alt="Preview">`
        }
        reader.readAsDataURL(file)
      })
    }

    // Form submit
    const form = document.getElementById('profile-wizard-form')
    if (!form) return
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      const errEl = document.getElementById('pw-error')
      const sucEl = document.getElementById('pw-success')
      const btn   = document.getElementById('pw-submit-btn')
      errEl.style.display = 'none'
      sucEl.style.display = 'none'

      const ecName         = document.getElementById('pw-ec-name')?.value.trim()
      const ecPhone        = document.getElementById('pw-ec-phone')?.value.trim()
      const ecRelationship = document.getElementById('pw-ec-relationship')?.value

      if (!ecName || !ecPhone || !ecRelationship) {
        errEl.textContent = 'Emergency contact name, phone, and relationship are required.'
        errEl.style.display = 'block'
        return
      }

      btn.disabled = true
      btn.textContent = 'Saving…'

      // Upload avatar if chosen
      let profile_image_url = null
      const file = document.getElementById('pw-avatar-file')?.files[0]
      if (file) {
        const { url, error: uploadErr } = await API.uploadAvatar(user.id, file)
        if (uploadErr) {
          errEl.textContent = 'Avatar upload failed: ' + uploadErr.message
          errEl.style.display = 'block'
          btn.disabled = false
          btn.textContent = 'Save Profile & Continue'
          return
        }
        profile_image_url = url
      }

      const profileData = {
        date_of_birth:     document.getElementById('pw-dob')?.value         || null,
        personal_email:    document.getElementById('pw-personal-email')?.value.trim() || null,
        phone:             document.getElementById('pw-phone')?.value.trim() || null,
        blood_group:       document.getElementById('pw-blood-group')?.value  || null,
        address:           document.getElementById('pw-address')?.value.trim() || null,
        linkedin_url:      document.getElementById('pw-linkedin')?.value.trim() || null,
        bank_account_number: document.getElementById('pw-bank-account')?.value.trim() || null,
        bank_ifsc:         document.getElementById('pw-bank-ifsc')?.value.trim() || null,
        emergency_contact_name:         ecName,
        emergency_contact_phone:        ecPhone,
        emergency_contact_relationship: ecRelationship,
        profile_completed: true,
      }
      if (profile_image_url) profileData.profile_image_url = profile_image_url

      const { error } = await API.updateOwnProfile(user.id, profileData)
      if (error) {
        errEl.textContent = 'Could not save profile: ' + error.message
        errEl.style.display = 'block'
        btn.disabled = false
        btn.textContent = 'Save Profile & Continue'
        return
      }

      sucEl.textContent = 'Profile saved! Loading your dashboard…'
      sucEl.style.display = 'block'
      setTimeout(() => window.location.reload(), 1200)
    })
  }

  return { init, hasAccess, renderAccessDenied }
})()

document.addEventListener('DOMContentLoaded', App.init)
