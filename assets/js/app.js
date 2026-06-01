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
      id:        m.routeId,
      label:     m.label,
      icon:      m.icon,
      module:    m.getModule,
      roles:     ALL_ROLES,
      universal: m.universal || false,
    })),
    // Access Control: super_admin + founders_office only
    { id: 'access-control', label: 'Access Control', icon: ICONS.sliders, module: () => Access, roles: ALL_ROLES, superAdminOnly: true },
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

  // Modules always accessible regardless of policy acknowledgement status
  const POLICY_UNLOCKED = new Set(['home', 'timesheet', 'people', 'policies', 'settings'])

  // True once the employee has accepted the company policies disclaimer.
  // Super admins are always treated as acknowledged.
  let _policyAcknowledged = false

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

    // Build a lookup of known features per module from the live registry.
    // Any row in the DB whose module/feature is no longer registered is
    // silently ignored — this prevents stale rows (renamed or removed features)
    // from granting phantom access.
    const knownFeatures = {}
    ModuleRegistry.getAll().forEach(m => {
      knownFeatures[m.key] = new Set(Object.keys(m.features || {}))
    })

    const { data } = await API.getAccessMatrix(currentUser.department)
    _matrix = {}
    ;(data || []).forEach(row => {
      if (!knownFeatures[row.module])                      return  // unknown module
      if (!knownFeatures[row.module].has(row.feature))    return  // stale feature
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
    if (navItem.superAdminOnly) return _matrix === null
    if (navItem.universal)      return true              // visible to everyone
    if (_matrix === null) return true  // super_admin sees everything

    // Route-specific feature override
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

    // Block the app until the employee completes their onboarding profile.
    // Use falsy check (not === false) so NULL also triggers the wizard —
    // the create-employee Edge Function may not set profile_completed explicitly,
    // leaving it NULL in the DB rather than the boolean false.
    if (!currentUser.profile_completed) {
      _showProfileCompletionWizard(currentUser)
      return
    }

    await _loadAccessMatrix()

    // Super admins are always unlocked. Everyone else needs to acknowledge policies.
    _policyAcknowledged = currentUser.role === 'super_admin' || !!currentUser.policy_acknowledged_at

    _renderSidebar()
    _renderHeaderUser()
    _setupUserMenu()
    _setupLogout()
    _loadNotificationCount()
    _checkAnnouncementDot()
    _initNotificationPanel()
    _initMobileNav()
    _initThemeToggle()
    _initAccessMatrixLiveSync()

    // Initialise push notifications (asks for permission after 4s if not yet granted)
    if (typeof Push !== 'undefined') Push.init(currentUser)

    router()
    window.addEventListener('hashchange', router)
  }

  // ── Dark mode toggle ─────────────────────────────────────────
  function _initThemeToggle() {
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

    // Sync icon with whatever the flash-prevention script already set
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
    _apply(isDark)

    btn.addEventListener('click', () => {
      const nowDark = document.documentElement.getAttribute('data-theme') === 'dark'
      _apply(!nowDark)
    })
  }

  // ── Access matrix live sync (Supabase Realtime) ──────────────
  function _initAccessMatrixLiveSync() {
    if (!currentUser || currentUser.role === 'super_admin') return
    let _refreshTimer = null
    Config.supabase
      .channel('access_matrix_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'access_matrix' }, (payload) => {
        const dept = payload.new?.department || payload.old?.department
        // Only react to changes that affect this user's department
        if (dept && dept !== currentUser.department) return
        clearTimeout(_refreshTimer)
        // Debounce 800 ms — delete-then-insert fires many events in rapid succession
        _refreshTimer = setTimeout(async () => {
          await _loadAccessMatrix()
          _renderSidebar()
          router()
          Utils.showToast('Your permissions have been updated.', 'info')
        }, 800)
      })
      .subscribe()
  }

  /* ── Policy acknowledgement modal ──────────────────────── */
  function _showPolicyAcknowledgementModal(pendingRoute) {
    if (document.getElementById('policy-ack-overlay')) return  // already open

    const overlay = document.createElement('div')
    overlay.id        = 'policy-ack-overlay'
    overlay.className = 'modal-overlay'
    overlay.innerHTML = `
      <div class="modal" style="max-width:480px;">
        <div class="modal-header" style="border-bottom:1px solid var(--border);padding-bottom:16px;margin-bottom:0;">
          <h3 class="modal-title" style="font-size:16px;font-weight:700;">Review Required</h3>
        </div>
        <div class="modal-body" style="padding:20px 0 4px;">
          <p style="margin:0 0 16px;font-size:14px;line-height:1.65;color:var(--text);">
            Before proceeding, please review the company policies and guidelines available in Growthic One.
          </p>
          <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:14px;background:var(--bg-secondary,#F8FAFC);border:1px solid var(--border);border-radius:8px;">
            <input type="checkbox" id="policy-ack-check" style="margin-top:2px;cursor:pointer;flex-shrink:0;width:15px;height:15px;">
            <span style="font-size:13px;line-height:1.55;color:var(--text);">
              I confirm that I have reviewed, understood, and agree to comply with the company's policies and guidelines.
            </span>
          </label>
        </div>
        <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:10px;padding-top:20px;">
          <button class="btn btn--ghost" id="policy-ack-cancel">Not now</button>
          <button class="btn btn--primary" id="policy-ack-confirm" disabled>I Agree &amp; Continue</button>
        </div>
      </div>
    `
    document.body.appendChild(overlay)

    const check   = overlay.querySelector('#policy-ack-check')
    const confirm = overlay.querySelector('#policy-ack-confirm')
    const cancel  = overlay.querySelector('#policy-ack-cancel')

    check.addEventListener('change', () => { confirm.disabled = !check.checked })

    cancel.addEventListener('click', () => overlay.remove())

    confirm.addEventListener('click', async () => {
      if (!check.checked) return
      confirm.disabled    = true
      confirm.textContent = 'Saving…'
      const { error } = await API.acknowledgePolicy(currentUser.id)
      if (error) {
        Utils.showToast('Could not save acknowledgement. Please try again.', 'error')
        confirm.disabled    = false
        confirm.textContent = 'I Agree & Continue'
        return
      }
      _policyAcknowledged = true
      currentUser.policy_acknowledged_at = new Date().toISOString()
      overlay.remove()
      _renderSidebar()
      if (pendingRoute) window.location.hash = pendingRoute
    })
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

    const LOCK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left:auto;flex-shrink:0;opacity:0.5;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`

    nav.innerHTML = accessible.map(item => {
      const isLocked = !_policyAcknowledged && !POLICY_UNLOCKED.has(item.id) && !item.superAdminOnly
      if (isLocked) {
        return `
          <div class="nav-item nav-item--policy-locked" data-route="${item.id}" style="opacity:0.55;cursor:pointer;">
            <span class="nav-icon">${item.icon}</span>
            <span class="nav-label">${item.label}</span>
            ${LOCK_ICON}
          </div>`
      }
      return `
        <a class="nav-item" data-route="${item.id}" href="#${item.id}">
          <span class="nav-icon">${item.icon}</span>
          <span class="nav-label">${item.label}</span>
          ${item.id === 'announcements' ? `<span class="nav-ann-dot" id="ann-nav-dot" style="display:none;"></span>` : ''}
        </a>`
    }).join('')

    if (!_policyAcknowledged) {
      nav.querySelectorAll('.nav-item--policy-locked').forEach(el => {
        el.addEventListener('click', () => _showPolicyAcknowledgementModal(el.dataset.route))
      })
    }

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

  /* ── Announcement dot ───────────────────────────────────── */

  async function _checkAnnouncementDot() {
    try {
      const { data } = await API.getRecentAnnouncements(1)
      if (!data?.length) return
      const latestAt  = new Date(data[0].created_at).getTime()
      const lastSeen  = Number(localStorage.getItem('ann_last_seen') || 0)
      if (latestAt > lastSeen) {
        const dot = document.getElementById('ann-nav-dot')
        if (dot) dot.style.display = 'block'
      }
    } catch (_) {}
  }

  function _markAnnouncementsSeen() {
    localStorage.setItem('ann_last_seen', Date.now())
    const dot = document.getElementById('ann-nav-dot')
    if (dot) dot.style.display = 'none'
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

  function _notifMeta(n) {
    // Returns { emoji, cls, label } based on type + module
    if (n.module === 'badge' || n.type === 'badge')
      return { emoji: '🏅', cls: 'badge',      label: 'Badge'          }
    if (n.type === 'approval')
      return { emoji: '✅', cls: 'approval',   label: _notifModuleLabel(n.module) }
    if (n.type === 'rejection')
      return { emoji: '❌', cls: 'rejection',  label: _notifModuleLabel(n.module) }
    if (n.module === 'timesheet')
      return { emoji: '⏱️', cls: 'timesheet',  label: 'Timesheet'      }
    if (n.module === 'leave')
      return { emoji: '🌿', cls: 'leave',      label: 'Leave'          }
    if (n.module === 'wfh')
      return { emoji: '🏠', cls: 'wfh',        label: 'WFH'            }
    if (n.module === 'reimbursements')
      return { emoji: '💳', cls: 'reimburse',  label: 'Reimbursement'  }
    if (n.module === 'assets')
      return { emoji: '📦', cls: 'asset',      label: 'Assets'         }
    if (n.module === 'tools')
      return { emoji: '🔧', cls: 'tools',      label: 'Tools'          }
    if (n.module === 'people')
      return { emoji: '👤', cls: 'people',     label: 'People'         }
    return   { emoji: '💬', cls: 'default',    label: 'Update'         }
  }

  function _notifModuleLabel(module) {
    const map = {
      timesheet: 'Timesheet', leave: 'Leave', wfh: 'WFH',
      badge: 'Badge', reimbursements: 'Reimbursement',
      assets: 'Assets', tools: 'Tools', people: 'People',
    }
    return map[module] || 'Update'
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
          ? `<div class="notif-empty">You're all caught up! 🎉</div>`
          : items.map(n => {
              const meta = _notifMeta(n)
              return `
                <div class="notif-item${n.read ? '' : ' notif-item--unread'}" data-id="${n.id}" data-module="${n.module || ''}" style="cursor:pointer;">
                  <div class="notif-item-icon notif-item-icon--${meta.cls}">${meta.emoji}</div>
                  <div class="notif-item-body">
                    <div class="notif-item-meta">
                      <span class="notif-item-tag notif-item-tag--${meta.cls}">${meta.label}</span>
                      <span class="notif-item-time">${_timeAgo(n.created_at)}</span>
                    </div>
                    <div class="notif-item-msg">${Utils.escapeHtml(n.message)}</div>
                  </div>
                  ${!n.read ? `<div class="notif-item-dot"></div>` : ''}
                </div>`
            }).join('')}
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

    // All items are clickable: mark as read + navigate to the relevant module
    panel.querySelectorAll('.notif-item').forEach(el => {
      el.addEventListener('click', async () => {
        const id     = el.dataset.id
        const mod    = el.dataset.module
        const isUnread = el.classList.contains('notif-item--unread')

        // Mark as read
        if (isUnread) {
          await API.markNotificationRead(id)
          el.classList.remove('notif-item--unread')
          el.querySelector('.notif-item-dot')?.remove()
          const remaining = panel.querySelectorAll('.notif-item--unread').length
          _updateNotifBadge(remaining)
          if (remaining === 0) document.getElementById('notif-mark-all')?.remove()
        }

        // Navigate and close panel
        panel.style.display = 'none'
        const route = ({
          leave_tracker:  'leave-tracker',
          announcements:  'announcements',
          assets:         'assets',
          tools:          'tools',
          people:         'people',
          reimbursements: 'reimbursements',
          timesheet:      'timesheet',
          badges:         'people',
        })[mod] || mod
        if (route) window.location.hash = route
      })
    })
  }

  /* ── Mobile nav: hamburger + sidebar overlay ────────────────── */
  function _initMobileNav() {
    const hamburger = document.getElementById('hamburger-btn')
    const sidebar   = document.getElementById('sidebar')
    const overlay   = document.getElementById('sidebar-overlay')
    if (!hamburger || !sidebar) return

    function openSidebar() {
      sidebar.classList.add('sidebar--open')
      if (overlay) overlay.classList.add('sidebar-overlay--visible')
      document.body.classList.add('sidebar-is-open')
    }

    function closeSidebar() {
      sidebar.classList.remove('sidebar--open')
      if (overlay) overlay.classList.remove('sidebar-overlay--visible')
      document.body.classList.remove('sidebar-is-open')
    }

    hamburger.addEventListener('click', () => {
      sidebar.classList.contains('sidebar--open') ? closeSidebar() : openSidebar()
    })

    // Tap overlay to close
    if (overlay) overlay.addEventListener('click', closeSidebar)

    // Close when a nav link is tapped (route changes on mobile)
    document.getElementById('sidebar-nav')?.addEventListener('click', e => {
      if (e.target.closest('.nav-item') && window.innerWidth <= 768) closeSidebar()
    })

    // Close on browser back/forward (hash changes)
    window.addEventListener('hashchange', () => {
      if (window.innerWidth <= 768) closeSidebar()
    })

    // ESC key closes sidebar
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeSidebar()
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

    // Policy acknowledgement gate: redirect to home if module is still locked
    if (!_policyAcknowledged && !POLICY_UNLOCKED.has(route) && !navItem.superAdminOnly) {
      window.location.hash = 'home'
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

    // Clear the announcement nudge as soon as the user lands on that page
    if (route === 'announcements') _markAnnouncementsSeen()

    content.innerHTML = pageModule.render(currentUser)
    if (pageModule.init) pageModule.init(currentUser)
  }

  /* ── Profile Completion Wizard ──────────────────────────────
     7-step guided onboarding. Shown on first login.
     Blocks app access until completed.
  ─────────────────────────────────────────────────────────── */
  function _showProfileCompletionWizard(user) {
    const sidebar = document.querySelector('.sidebar')
    const header  = document.querySelector('.app-header')
    if (sidebar) sidebar.style.display = 'none'
    if (header)  header.style.display  = 'none'

    const content = document.getElementById('page-content')
    if (!content) return

    // ── State ──────────────────────────────────────────────────
    let _step = 0
    const TOTAL = 7
    let _avatarFile = null
    const _kycFiles = { aadhar: null, pan: null }
    const _d = {
      dob: '', personal_email: '', phone: '', blood_group: '',
      current_address_line1: '', current_address_city: '', current_address_state: '', current_address_pincode: '',
      permanent_address_line1: '', permanent_address_city: '', permanent_address_state: '', permanent_address_pincode: '',
      permanent_same_as_current: false,
      linkedin_url: '',
      bank_account_number: '', bank_ifsc: '', bank_confirmed: false,
      ec_name: '', ec_phone: '', ec_relationship: '',
      is_pep: null, pep_note: '', declaration: false,
    }

    const STEP_META = [
      { n: 1, title: 'Profile Photo',     sub: 'Your photo appears across the platform — org chart, requests, and more.',   tip: 'A real photo helps teammates recognise you in meetings, on the org chart, and in announcements.' },
      { n: 2, title: 'Personal Details',  sub: 'A few basics we keep on file for your records.',                            tip: 'This information is only accessible to HR and is never shared externally.' },
      { n: 3, title: 'Address & Socials', sub: 'Your current and permanent address, and professional links.',              tip: 'Your LinkedIn profile helps with client introductions and builds your professional presence.' },
      { n: 4, title: 'Bank Details',      sub: 'Required for payroll — stored securely.',                                   tip: '🔒 Bank details are encrypted and only accessible to the Finance team for payroll processing.' },
      { n: 5, title: 'Emergency Contact', sub: 'Someone we can reach in case of an emergency.',                             tip: 'Only used in genuine emergencies. Never shared outside the company.' },
      { n: 6, title: 'KYC Documents',     sub: 'Identity documents for your employee records.',                             tip: 'Files are stored in a secure, access-controlled Google Drive folder visible only to HR.' },
      { n: 7, title: 'Compliance',        sub: 'A quick regulatory check — takes 30 seconds.',                             tip: 'PEP screening is a standard regulatory requirement for all employees.' },
    ]

    // ── Capture current step fields into _d ────────────────────
    function _capture() {
      if (_step === 2) {
        const day   = document.getElementById('pw-dob-day')?.value   || ''
        const month = document.getElementById('pw-dob-month')?.value || ''
        const year  = document.getElementById('pw-dob-year')?.value  || ''
        _d.dob            = (day && month && year) ? `${year}-${month}-${day}` : ''
        _d.personal_email = document.getElementById('pw-personal-email')?.value.trim() || ''
        _d.phone          = document.getElementById('pw-phone')?.value.trim() || ''
        _d.blood_group    = document.getElementById('pw-blood-group')?.value || ''
      }
      if (_step === 3) {
        _d.current_address_line1     = document.getElementById('pw-curr-line1')?.value.trim()   || ''
        _d.current_address_city      = document.getElementById('pw-curr-city')?.value.trim()    || ''
        _d.current_address_state     = document.getElementById('pw-curr-state')?.value.trim()   || ''
        _d.current_address_pincode   = document.getElementById('pw-curr-pincode')?.value.trim() || ''
        _d.permanent_same_as_current = document.getElementById('pw-perm-same')?.checked         || false
        if (_d.permanent_same_as_current) {
          _d.permanent_address_line1   = _d.current_address_line1
          _d.permanent_address_city    = _d.current_address_city
          _d.permanent_address_state   = _d.current_address_state
          _d.permanent_address_pincode = _d.current_address_pincode
        } else {
          _d.permanent_address_line1   = document.getElementById('pw-perm-line1')?.value.trim()   || ''
          _d.permanent_address_city    = document.getElementById('pw-perm-city')?.value.trim()    || ''
          _d.permanent_address_state   = document.getElementById('pw-perm-state')?.value.trim()   || ''
          _d.permanent_address_pincode = document.getElementById('pw-perm-pincode')?.value.trim() || ''
        }
        _d.linkedin_url = document.getElementById('pw-linkedin')?.value.trim() || ''
      }
      if (_step === 4) {
        _d.bank_account_number = document.getElementById('pw-bank-account')?.value.trim() || ''
        _d.bank_ifsc           = document.getElementById('pw-bank-ifsc')?.value.trim()    || ''
        _d.bank_confirmed      = document.getElementById('pw-bank-confirm')?.checked      || false
      }
      if (_step === 5) {
        _d.ec_name         = document.getElementById('pw-ec-name')?.value.trim() || ''
        _d.ec_phone        = document.getElementById('pw-ec-phone')?.value.trim() || ''
        _d.ec_relationship = document.getElementById('pw-ec-relationship')?.value || ''
      }
      if (_step === 7) {
        _d.is_pep      = document.querySelector('input[name="pep"]:checked')?.value ?? null
        _d.pep_note    = document.getElementById('pw-pep-note')?.value.trim() || ''
        _d.declaration = document.getElementById('pw-declaration')?.checked || false
      }
    }

    function _validate() {
      if (_step === 1 && !_avatarFile && !user.profile_image_url)
        return 'Please upload a profile photo to continue.'
      if (_step === 7) {
        if (_d.is_pep === null) return 'Please answer the PEP question to continue.'
        if (!_d.declaration)   return 'Please confirm the declaration to continue.'
      }
      return null
    }

    function _completeness() {
      let pts = 0
      if (_avatarFile || user.profile_image_url)           pts += 20
      if (_d.dob || _d.phone || _d.personal_email)        pts += 15
      if (_d.current_address_line1)                        pts += 5
      if (_d.linkedin_url)                                 pts += 5
      if (_d.bank_account_number || _d.bank_ifsc)         pts += 15
      if (_d.ec_name && _d.ec_phone)                      pts += 15
      if (Object.values(_kycFiles).some(Boolean))         pts += 20
      if (_d.is_pep !== null && _d.declaration)           pts += 5
      return Math.min(pts, 100)
    }

    // ── Step 0: Welcome ────────────────────────────────────────
    function _renderWelcome() {
      const chips = [
        { icon: '📸', label: 'Profile Photo' },
        { icon: '👤', label: 'Personal Details' },
        { icon: '🏠', label: 'Address & Socials' },
        { icon: '🏦', label: 'Bank Details' },
        { icon: '🚨', label: 'Emergency Contact' },
        { icon: '🪪', label: 'KYC Documents' },
        { icon: '✅', label: 'Compliance' },
      ]
      content.innerHTML = `
        <div class="profile-wizard-overlay pw-overlay--welcome">
          <div class="pw-welcome-wrap">
            <img src="../assets/img/logo.jpg" alt="Growthic One" style="height:44px;margin-bottom:20px;">
            <div class="pw-welcome-emoji">👋</div>
            <h1 class="pw-welcome-title">Welcome aboard, ${Utils.escapeHtml(user.name.split(' ')[0])}!</h1>
            <p class="pw-welcome-sub">You're officially part of the Growthic family. Before you dive in, let's get your profile set up — it takes about 3 minutes.</p>
            <div class="pw-welcome-chips">
              ${chips.map(c => `<div class="pw-welcome-chip"><span>${c.icon}</span><span>${c.label}</span></div>`).join('')}
            </div>
            <button class="btn btn--primary pw-welcome-cta" id="pw-start">Let's get started →</button>
            <p style="font-size:12px;color:var(--text-muted);margin-top:14px;">You can update all of this later from your profile settings.</p>
          </div>
        </div>`
      document.getElementById('pw-start').addEventListener('click', () => {
        _step = 1
        _renderShell()
        _update(1)
      })
    }

    // ── Form shell (rendered once, updated in-place) ───────────
    function _renderShell() {
      content.innerHTML = `
        <div class="profile-wizard-overlay">
          <div class="pw-layout">
            <div class="profile-wizard-card" id="pw-card">
              <div class="profile-wizard-header" style="padding-bottom:12px;margin-bottom:0;">
                <img src="../assets/img/logo.jpg" alt="" style="height:28px;">
              </div>
              <div class="pw-progress-wrap"><div id="pw-progress-bar"></div></div>
              <div class="pw-stepper" id="pw-stepper"></div>
              <div class="pw-step-body" id="pw-step-body"></div>
              <div id="pw-error" class="form-error" style="display:none;margin-top:14px;"></div>
              <div class="pw-nav" id="pw-nav"></div>
            </div>
            <div class="pw-preview-panel">
              <p class="pw-preview-label">Your Profile Preview</p>
              <div class="pw-preview-card" id="pw-preview-card"></div>
            </div>
          </div>
        </div>`
    }

    // ── Full update cycle ──────────────────────────────────────
    function _update(dir) {
      _renderProgressBar()
      _renderStepper()
      _renderBody(dir)
      _renderNav()
      _renderPreview()
      document.getElementById('pw-card')?.scrollTo({ top: 0, behavior: 'smooth' })
    }

    function _renderProgressBar() {
      const bar = document.getElementById('pw-progress-bar')
      if (bar) bar.style.width = Math.round((_step / TOTAL) * 100) + '%'
    }

    function _renderStepper() {
      const el = document.getElementById('pw-stepper')
      if (!el) return
      el.innerHTML = STEP_META.map((s, i) => {
        const done = _step > s.n, active = _step === s.n
        const cls  = done ? 'pw-dot--done' : active ? 'pw-dot--active' : ''
        return `
          <div class="pw-step-item">
            <div class="pw-dot ${cls}" title="${s.title}">
              ${done ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>` : s.n}
            </div>
            <span class="pw-step-lbl">${s.title}</span>
          </div>
          ${i < STEP_META.length - 1 ? `<div class="pw-step-line${done ? ' pw-step-line--done' : ''}"></div>` : ''}`
      }).join('')
    }

    function _renderBody(dir) {
      const wrap = document.getElementById('pw-step-body')
      if (!wrap) return
      const meta = STEP_META[_step - 1]

      let html = `
        <div class="pw-step-heading">
          <h3 class="pw-step-title">${meta.title}</h3>
          <p class="pw-step-sub">${meta.sub}</p>
        </div>
        <div class="pw-tip"><span>💡</span><span>${meta.tip}</span></div>`

      if (_step === 1) {
        const src = user.profile_image_url
          ? `<img src="${Utils.escapeHtml(user.profile_image_url)}" alt="">`
          : `<span>${Utils.getInitials(user.name)}</span>`
        html += `
          <div class="pw-avatar-center">
            <div class="pw-avatar-preview pw-avatar-lg" id="pw-avatar-preview">${_avatarFile ? '' : src}</div>
            <label class="btn btn--secondary" style="cursor:pointer;margin-top:18px;">
              ${_avatarFile ? '✓ Change Photo' : 'Choose Photo'}
              <input type="file" id="pw-avatar-file" accept="image/*" style="display:none;">
            </label>
            <p style="font-size:12px;color:var(--text-muted);margin-top:8px;">JPG or PNG · max 2 MB · <span style="color:var(--danger);font-weight:600;">Required</span></p>
          </div>`
      }

      if (_step === 2) {
        const _dobParts  = _d.dob ? _d.dob.split('-') : ['', '', '']
        const _dobYear   = _dobParts[0] || ''
        const _dobMonth  = _dobParts[1] || ''
        const _dobDay    = _dobParts[2] || ''
        const _thisYear  = new Date().getFullYear()
        const _maxYear   = _thisYear - 18   // must be at least 18
        const _minYear   = _thisYear - 80
        const _months    = ['January','February','March','April','May','June','July','August','September','October','November','December']

        html += `
          <div class="people-field-grid">
            <div class="form-group" style="grid-column:1/-1;">
              <label class="form-label">Date of Birth <span class="required">*</span></label>
              <div class="pw-dob-selects">
                <select id="pw-dob-day" class="form-input">
                  <option value="">Day</option>
                  ${Array.from({length:31},(_,i)=>{const v=String(i+1).padStart(2,'0');return`<option value="${v}"${_dobDay===v?' selected':''}>${i+1}</option>`}).join('')}
                </select>
                <select id="pw-dob-month" class="form-input">
                  <option value="">Month</option>
                  ${_months.map((m,i)=>{const v=String(i+1).padStart(2,'0');return`<option value="${v}"${_dobMonth===v?' selected':''}>${m}</option>`}).join('')}
                </select>
                <select id="pw-dob-year" class="form-input">
                  <option value="">Year</option>
                  ${Array.from({length:_maxYear-_minYear+1},(_,i)=>{const y=_maxYear-i;return`<option value="${y}"${_dobYear===String(y)?' selected':''}>${y}</option>`}).join('')}
                </select>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Personal Email <span class="required">*</span></label>
              <input type="email" id="pw-personal-email" class="form-input" placeholder="personal@example.com" value="${Utils.escapeHtml(_d.personal_email)}">
            </div>
            <div class="form-group">
              <label class="form-label">Phone Number <span class="required">*</span></label>
              <input type="tel" id="pw-phone" class="form-input" placeholder="+91 98765 43210" value="${Utils.escapeHtml(_d.phone)}">
            </div>
            <div class="form-group">
              <label class="form-label">Blood Group <span class="required">*</span></label>
              <select id="pw-blood-group" class="form-input">
                <option value="">Select</option>
                ${['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(bg =>
                  `<option value="${bg}"${_d.blood_group === bg ? ' selected' : ''}>${bg}</option>`).join('')}
              </select>
            </div>
          </div>`
      }

      if (_step === 3) {
        const _permDis = _d.permanent_same_as_current
        html += `
          <div style="margin-bottom:22px;">
            <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:12px;">Current Address</div>
            <div class="form-group" style="margin-bottom:10px;">
              <label class="form-label">House / Flat No. &amp; Street <span class="required">*</span></label>
              <input type="text" id="pw-curr-line1" class="form-input" placeholder="e.g. Flat 4B, 12 MG Road" value="${Utils.escapeHtml(_d.current_address_line1)}">
            </div>
            <div class="people-field-grid">
              <div class="form-group">
                <label class="form-label">City <span class="required">*</span></label>
                <input type="text" id="pw-curr-city" class="form-input" placeholder="City" value="${Utils.escapeHtml(_d.current_address_city)}">
              </div>
              <div class="form-group">
                <label class="form-label">State <span class="required">*</span></label>
                <input type="text" id="pw-curr-state" class="form-input" placeholder="State" value="${Utils.escapeHtml(_d.current_address_state)}">
              </div>
              <div class="form-group">
                <label class="form-label">Pincode <span class="required">*</span></label>
                <input type="text" id="pw-curr-pincode" class="form-input" placeholder="Pincode" value="${Utils.escapeHtml(_d.current_address_pincode)}" maxlength="6">
              </div>
            </div>
          </div>

          <div style="border-top:1px solid var(--border);padding-top:18px;margin-bottom:16px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
              <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);">Permanent Address</div>
              <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:13px;font-weight:500;color:var(--primary);">
                <input type="checkbox" id="pw-perm-same" ${_permDis ? 'checked' : ''} style="width:15px;height:15px;accent-color:var(--primary);cursor:pointer;">
                Same as Current Address
              </label>
            </div>
            <div id="pw-perm-fields" style="${_permDis ? 'opacity:0.45;pointer-events:none;' : ''}">
              <div class="form-group" style="margin-bottom:10px;">
                <label class="form-label">House / Flat No. &amp; Street <span class="required">*</span></label>
                <input type="text" id="pw-perm-line1" class="form-input" placeholder="e.g. Flat 4B, 12 MG Road" value="${Utils.escapeHtml(_d.permanent_address_line1)}"${_permDis ? ' disabled' : ''}>
              </div>
              <div class="people-field-grid">
                <div class="form-group">
                  <label class="form-label">City <span class="required">*</span></label>
                  <input type="text" id="pw-perm-city" class="form-input" placeholder="City" value="${Utils.escapeHtml(_d.permanent_address_city)}"${_permDis ? ' disabled' : ''}>
                </div>
                <div class="form-group">
                  <label class="form-label">State <span class="required">*</span></label>
                  <input type="text" id="pw-perm-state" class="form-input" placeholder="State" value="${Utils.escapeHtml(_d.permanent_address_state)}"${_permDis ? ' disabled' : ''}>
                </div>
                <div class="form-group">
                  <label class="form-label">Pincode <span class="required">*</span></label>
                  <input type="text" id="pw-perm-pincode" class="form-input" placeholder="Pincode" value="${Utils.escapeHtml(_d.permanent_address_pincode)}"${_permDis ? ' disabled' : ''} maxlength="6">
                </div>
              </div>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">LinkedIn URL</label>
            <input type="url" id="pw-linkedin" class="form-input" placeholder="https://linkedin.com/in/yourprofile" value="${Utils.escapeHtml(_d.linkedin_url)}">
          </div>`
      }

      if (_step === 4) {
        html += `
          <div class="people-field-grid">
            <div class="form-group">
              <label class="form-label">Bank Account Number <span class="required">*</span></label>
              <input type="text" id="pw-bank-account" class="form-input" placeholder="Account number" value="${Utils.escapeHtml(_d.bank_account_number)}">
            </div>
            <div class="form-group">
              <label class="form-label">IFSC Code <span class="required">*</span></label>
              <input type="text" id="pw-bank-ifsc" class="form-input" placeholder="e.g. HDFC0001234" value="${Utils.escapeHtml(_d.bank_ifsc)}">
            </div>
          </div>
          <label class="pw-declaration" style="margin-top:20px;">
            <input type="checkbox" id="pw-bank-confirm" ${_d.bank_confirmed ? 'checked' : ''}>
            <span>I hereby confirm that all the information and details provided by me are accurate and complete to the best of my knowledge.</span>
          </label>`
      }

      if (_step === 5) {
        html += `
          <div class="people-field-grid">
            <div class="form-group">
              <label class="form-label">Contact Name <span class="required">*</span></label>
              <input type="text" id="pw-ec-name" class="form-input" placeholder="Full name" value="${Utils.escapeHtml(_d.ec_name)}">
            </div>
            <div class="form-group">
              <label class="form-label">Phone Number <span class="required">*</span></label>
              <input type="tel" id="pw-ec-phone" class="form-input" placeholder="+91 98765 43210" value="${Utils.escapeHtml(_d.ec_phone)}">
            </div>
            <div class="form-group">
              <label class="form-label">Relationship <span class="required">*</span></label>
              <select id="pw-ec-relationship" class="form-input">
                <option value="">Select</option>
                ${['Parent','Spouse','Sibling','Child','Friend','Other'].map(r =>
                  `<option value="${r}"${_d.ec_relationship === r ? ' selected' : ''}>${r}</option>`).join('')}
              </select>
            </div>
          </div>`
      }

      if (_step === 6) {
        const DOCS = [
          { key: 'aadhar', label: 'Aadhar Card', icon: '🪪', optional: false },
          { key: 'pan',    label: 'PAN Card',    icon: '📋', optional: false },
        ]
        html += `
          <div class="pw-kyc-grid">
            ${DOCS.map(doc => {
              const f = _kycFiles[doc.key]
              return `
                <label class="pw-kyc-slot${f ? ' pw-kyc-slot--done' : ''}" style="cursor:pointer;">
                  <span class="pw-kyc-icon">${doc.icon}</span>
                  <span class="pw-kyc-label">${doc.label}${doc.optional ? '<span class="pw-kyc-opt"> (optional)</span>' : ''}</span>
                  ${f
                    ? `<span class="pw-kyc-check">✓ ${Utils.escapeHtml(f.name.length > 22 ? f.name.slice(0,20)+'…' : f.name)}</span>`
                    : `<span class="pw-kyc-hint">Tap to upload</span>`}
                  <input type="file" data-doc="${doc.key}" class="pw-kyc-input" accept=".pdf,.jpg,.jpeg,.png" style="display:none;">
                </label>`
            }).join('')}
          </div>
          <p style="font-size:12px;color:var(--text-muted);margin-top:12px;">PDF, JPG, or PNG · Max 10 MB each</p>`
      }

      if (_step === 7) {
        html += `
          <div class="pw-pep-wrap">
            <p class="pw-pep-q">Are you a Politically Exposed Person (PEP)?</p>
            <div class="pw-pep-hint">A PEP is someone who holds or has held a prominent public function — such as a head of state, senior politician, senior government, judicial, or military official — or a close family member or associate of such a person.</div>
            <div class="pw-pep-options">
              <label class="pw-pep-option${_d.is_pep === 'no'  ? ' pw-pep-option--sel' : ''}">
                <input type="radio" name="pep" value="no"  ${_d.is_pep === 'no'  ? 'checked' : ''}> No, I am not a PEP
              </label>
              <label class="pw-pep-option${_d.is_pep === 'yes' ? ' pw-pep-option--sel' : ''}">
                <input type="radio" name="pep" value="yes" ${_d.is_pep === 'yes' ? 'checked' : ''}> Yes, I am a PEP
              </label>
            </div>
            ${_d.is_pep === 'yes' ? `
              <div class="form-group" style="margin-top:12px;">
                <label class="form-label">Please provide details</label>
                <textarea id="pw-pep-note" class="form-input" rows="2" placeholder="Role / position held…">${Utils.escapeHtml(_d.pep_note)}</textarea>
              </div>` : ''}
            <label class="pw-declaration">
              <input type="checkbox" id="pw-declaration" ${_d.declaration ? 'checked' : ''}>
              <span>I confirm that all the information and documents provided by me are accurate and complete to the best of my knowledge, and I consent to the collection, storage, and processing of my information by the organization for employment, administrative, operational, and compliance purposes.</span>
            </label>
          </div>`
      }

      // Slide animation
      wrap.innerHTML = dir === 0
        ? `<div>${html}</div>`
        : `<div class="pw-slide-${dir > 0 ? 'right' : 'left'}">${html}</div>`

      // Avatar bindings
      if (_step === 1) {
        if (_avatarFile) {
          const reader = new FileReader()
          reader.onload = e => {
            const el = document.getElementById('pw-avatar-preview')
            if (el) el.innerHTML = `<img src="${e.target.result}" alt="">`
          }
          reader.readAsDataURL(_avatarFile)
        }
        document.getElementById('pw-avatar-file')?.addEventListener('change', function () {
          const f = this.files[0]; if (!f) return
          _avatarFile = f
          const reader = new FileReader()
          reader.onload = e => {
            const el = document.getElementById('pw-avatar-preview')
            if (el) el.innerHTML = `<img src="${e.target.result}" alt="">`
          }
          reader.readAsDataURL(f)
          _renderPreview()
        })
      }

      // Address "Same as Current" binding
      if (_step === 3) {
        const sameBox = document.getElementById('pw-perm-same')
        if (sameBox) {
          sameBox.addEventListener('change', () => {
            const checked    = sameBox.checked
            const permFields = document.getElementById('pw-perm-fields')
            if (permFields) {
              permFields.style.opacity       = checked ? '0.45' : '1'
              permFields.style.pointerEvents = checked ? 'none'  : ''
              permFields.querySelectorAll('input').forEach(inp => { inp.disabled = checked })
            }
            if (checked) {
              const g   = id => document.getElementById(id)?.value || ''
              const s   = (id, v) => { const el = document.getElementById(id); if (el) el.value = v }
              s('pw-perm-line1',   g('pw-curr-line1'))
              s('pw-perm-city',    g('pw-curr-city'))
              s('pw-perm-state',   g('pw-curr-state'))
              s('pw-perm-pincode', g('pw-curr-pincode'))
            }
            _capture()
            const nextBtn = document.getElementById('pw-next')
            if (nextBtn) nextBtn.disabled = !_isStepComplete()
          })
        }
      }

      // KYC bindings
      if (_step === 6) {
        wrap.querySelectorAll('.pw-kyc-input').forEach(input => {
          input.addEventListener('change', function () {
            const f = this.files[0]; if (!f) return
            _kycFiles[this.dataset.doc] = f
            _renderBody(0)
            _renderPreview()
            // Re-render nav so Next button reflects the updated _kycFiles state.
            // _renderBody(0) replaces DOM, so the old _bindStepInputs bindings
            // are now on detached nodes — _renderNav re-attaches them.
            _renderNav()
          })
        })
      }

      // PEP radio live update
      if (_step === 7) {
        wrap.querySelectorAll('input[name="pep"]').forEach(r => {
          r.addEventListener('change', () => {
            _capture()
            _renderBody(0)
            // _renderBody(0) replaces the DOM, so _bindStepInputs bindings are
            // now on detached nodes. Re-render nav to re-attach them to the new
            // declaration checkbox and update the Next button state.
            _renderNav()
          })
        })
      }
    }

    // ── Right preview panel ────────────────────────────────────
    function _renderPreview() {
      const panel = document.getElementById('pw-preview-card')
      if (!panel) return
      let avatarHtml
      if (_avatarFile) {
        const url = URL.createObjectURL(_avatarFile)
        avatarHtml = `<img src="${url}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
      } else if (user.profile_image_url) {
        avatarHtml = `<img src="${Utils.escapeHtml(user.profile_image_url)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
      } else {
        avatarHtml = `<span>${Utils.getInitials(user.name)}</span>`
      }
      const pct = _completeness()
      const pctColor = pct >= 80 ? 'var(--success)' : pct >= 50 ? 'var(--warning)' : 'var(--primary)'
      panel.innerHTML = `
        <div class="pw-prev-avatar">${avatarHtml}</div>
        <div class="pw-prev-name">${Utils.escapeHtml(user.name)}</div>
        <div class="pw-prev-role">${Utils.escapeHtml(user.role || '')}</div>
        ${user.department ? `<div class="pw-prev-dept">${Utils.escapeHtml(user.department)}</div>` : ''}
        <div class="pw-prev-fields">
          ${_d.phone         ? `<div class="pw-prev-field"><span>📞</span><span>${Utils.escapeHtml(_d.phone)}</span></div>` : ''}
          ${_d.personal_email? `<div class="pw-prev-field"><span>✉️</span><span>${Utils.escapeHtml(_d.personal_email)}</span></div>` : ''}
          ${_d.linkedin_url  ? `<div class="pw-prev-field"><span>🔗</span><span>LinkedIn</span></div>` : ''}
          ${_d.current_address_line1 ? `<div class="pw-prev-field"><span>📍</span><span>${Utils.escapeHtml(_d.current_address_line1)}</span></div>` : ''}
        </div>
        <div class="pw-prev-pct">
          <div class="pw-prev-pct-row"><span>Completeness</span><strong style="color:${pctColor};">${pct}%</strong></div>
          <div class="pw-prev-pct-track">
            <div style="width:${pct}%;background:${pctColor};height:100%;border-radius:3px;transition:width .4s,background .4s;"></div>
          </div>
        </div>`
    }

    // ── Step completeness check ────────────────────────────────
    function _isStepComplete() {
      if (_step === 1) return !!(_avatarFile || user.profile_image_url)
      if (_step === 2) {
        const day   = document.getElementById('pw-dob-day')?.value
        const month = document.getElementById('pw-dob-month')?.value
        const year  = document.getElementById('pw-dob-year')?.value
        const email = document.getElementById('pw-personal-email')?.value.trim()
        const phone = document.getElementById('pw-phone')?.value.trim()
        const blood = document.getElementById('pw-blood-group')?.value
        return !!(day && month && year && email && phone && blood)
      }
      if (_step === 3) {
        const line1     = document.getElementById('pw-curr-line1')?.value.trim()
        const city      = document.getElementById('pw-curr-city')?.value.trim()
        const state     = document.getElementById('pw-curr-state')?.value.trim()
        const pincode   = document.getElementById('pw-curr-pincode')?.value.trim()
        const same      = document.getElementById('pw-perm-same')?.checked
        const permLine1   = document.getElementById('pw-perm-line1')?.value.trim()
        const permCity    = document.getElementById('pw-perm-city')?.value.trim()
        const permState   = document.getElementById('pw-perm-state')?.value.trim()
        const permPincode = document.getElementById('pw-perm-pincode')?.value.trim()
        const currOk = !!(line1 && city && state && pincode)
        const permOk = same || !!(permLine1 && permCity && permState && permPincode)
        return currOk && permOk
      }
      if (_step === 4) {
        const acc       = document.getElementById('pw-bank-account')?.value.trim()
        const ifsc      = document.getElementById('pw-bank-ifsc')?.value.trim()
        const confirmed = document.getElementById('pw-bank-confirm')?.checked
        return !!(acc && ifsc && confirmed)
      }
      if (_step === 5) {
        const name = document.getElementById('pw-ec-name')?.value.trim()
        const ph   = document.getElementById('pw-ec-phone')?.value.trim()
        const rel  = document.getElementById('pw-ec-relationship')?.value
        return !!(name && ph && rel)
      }
      if (_step === 6) return !!(_kycFiles.aadhar && _kycFiles.pan)
      if (_step === 7) {
        const pep = document.querySelector('input[name="pep"]:checked')?.value
        const dec = document.getElementById('pw-declaration')?.checked
        return !!(pep && dec)
      }
      return true
    }

    // Bind all inputs in the current step body to re-evaluate Next button
    function _bindStepInputs() {
      const next = document.getElementById('pw-next')
      if (!next) return
      const check = () => { next.disabled = !_isStepComplete() }
      document.querySelectorAll('#pw-step-body input, #pw-step-body select, #pw-step-body textarea')
        .forEach(el => { el.addEventListener('input', check); el.addEventListener('change', check) })
    }

    // ── Navigation ─────────────────────────────────────────────
    function _renderNav() {
      const nav = document.getElementById('pw-nav')
      if (!nav) return
      const isLast    = _step === TOTAL
      const complete  = _isStepComplete()
      nav.innerHTML = `
        <div class="pw-nav-inner">
          ${_step > 1 ? `<button class="btn btn--ghost" id="pw-back">← Back</button>` : '<div></div>'}
          <span class="pw-step-counter">Step ${_step} of ${TOTAL}</span>
          <button class="btn btn--primary" id="pw-next"${complete ? '' : ' disabled'}>${isLast ? 'Save & Finish ✓' : 'Next →'}</button>
        </div>`

      // Re-bind inputs so Next re-enables as the user fills fields
      _bindStepInputs()

      document.getElementById('pw-back')?.addEventListener('click', () => {
        _capture()
        document.getElementById('pw-error').style.display = 'none'
        _step--; _update(-1)
      })

      document.getElementById('pw-next')?.addEventListener('click', async () => {
        _capture()
        const errEl = document.getElementById('pw-error')
        errEl.style.display = 'none'
        const err = _validate()
        if (err) { errEl.textContent = err; errEl.style.display = 'block'; return }
        if (!isLast) { _step++; _update(1); return }

        // ── Final save ────────────────────────────────────────
        const btn = document.getElementById('pw-next')
        btn.disabled = true; btn.textContent = 'Saving…'

        // Upload avatar
        let profile_image_url = null
        if (_avatarFile) {
          const { url, error: uploadErr } = await API.uploadAvatar(user.id, _avatarFile)
          if (uploadErr) {
            errEl.textContent = 'Avatar upload failed: ' + uploadErr.message
            errEl.style.display = 'block'
            btn.disabled = false; btn.textContent = 'Save & Finish ✓'
            return
          }
          profile_image_url = url
        }

        // Upload KYC docs to Drive (non-blocking per doc)
        const kycUrls = {}
        for (const [key, file] of Object.entries(_kycFiles)) {
          if (!file) continue
          try {
            const res = await API.uploadKycDocument(file, user.id, user.name, key)
            if (res?.drive_url) kycUrls[key] = res.drive_url
          } catch (_) { /* doc upload failure must not block profile save */ }
        }

        const profileData = {
          date_of_birth:                  _d.dob                 || null,
          personal_email:                 _d.personal_email      || null,
          phone:                          _d.phone               || null,
          blood_group:                    _d.blood_group         || null,
          address:           [_d.current_address_line1, _d.current_address_city, _d.current_address_state, _d.current_address_pincode].filter(Boolean).join(', ') || null,
          permanent_address: [_d.permanent_address_line1, _d.permanent_address_city, _d.permanent_address_state, _d.permanent_address_pincode].filter(Boolean).join(', ') || null,
          linkedin_url:                   _d.linkedin_url        || null,
          bank_account_number:            _d.bank_account_number || null,
          bank_ifsc:                      _d.bank_ifsc           || null,
          emergency_contact_name:         _d.ec_name             || null,
          emergency_contact_phone:        _d.ec_phone            || null,
          emergency_contact_relationship: _d.ec_relationship     || null,
          is_pep:                         _d.is_pep === 'yes',
          kyc_aadhar_url:                 kycUrls.aadhar         || null,
          kyc_pan_url:                    kycUrls.pan            || null,
          kyc_passport_url:               kycUrls.passport       || null,
          kyc_passport_photo_url:         kycUrls.passport_photo || null,
          kyc_submitted_at:               new Date().toISOString(),
          profile_completed:              true,
        }
        if (profile_image_url) profileData.profile_image_url = profile_image_url

        const { error } = await API.updateOwnProfile(user.id, profileData)
        if (error) {
          errEl.textContent = 'Could not save: ' + error.message
          errEl.style.display = 'block'
          btn.disabled = false; btn.textContent = 'Save & Finish ✓'
          return
        }

        // ── Done / Welcome screen ─────────────────────────────
        document.getElementById('pw-stepper').innerHTML = ''
        document.getElementById('pw-nav').innerHTML = ''
        document.getElementById('pw-error').style.display = 'none'
        document.getElementById('pw-progress-bar').style.width = '100%'
        document.getElementById('pw-step-body').innerHTML = `
          <div class="pw-done" style="text-align:center;padding:32px 12px 20px;">
            <div class="pw-done-check" style="margin:0 auto 28px;">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <h2 style="font-size:26px;font-weight:800;color:var(--text);margin-bottom:14px;line-height:1.2;">You're all set.</h2>
            <p style="font-size:15px;color:var(--text-muted);line-height:1.65;max-width:340px;margin:0 auto 12px;">Everything you need to collaborate, manage, and grow is now in one place.</p>
            <p style="font-size:17px;font-weight:700;color:var(--primary);margin-bottom:32px;">Welcome to Growthic One.</p>
            <p class="pw-done-hint">Taking you to your dashboard in a moment…</p>
          </div>`
        _launchConfetti()
        setTimeout(() => window.location.reload(), 4000)
      })
    }

    // ── Confetti ───────────────────────────────────────────────
    function _launchConfetti() {
      const overlay = document.querySelector('.profile-wizard-overlay')
      if (!overlay) return
      const colors = ['#4f46e5','#22c55e','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4']
      for (let i = 0; i < 100; i++) {
        const el = document.createElement('div')
        el.className = 'pw-confetti'
        el.style.cssText = `left:${Math.random()*100}%;background:${colors[Math.floor(Math.random()*colors.length)]};animation-duration:${1.6+Math.random()*2}s;animation-delay:${Math.random()*0.8}s;width:${5+Math.random()*8}px;height:${5+Math.random()*8}px;border-radius:${Math.random()>.5?'50%':'2px'};`
        overlay.appendChild(el)
        setTimeout(() => el.remove(), 4500)
      }
    }

    // ── Entry ──────────────────────────────────────────────────
    _renderWelcome()
  }

  return { init, hasAccess, renderAccessDenied }
})()

document.addEventListener('DOMContentLoaded', App.init)
