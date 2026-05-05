/* ============================================================
   ACCESS CONTROL — Super Admin + People & Culture
   Feature-level 6-tier access matrix per department.
   Reads from / writes to access_matrix table.
   Data-driven: modules and features come from DB.
   ============================================================ */

const Access = (() => {

  /* ── Access level config ─────────────────────────────────── */
  const LEVELS = [
    { key: 'no_access',   label: 'No Access',   short: 'None',    color: '#94A3B8' },
    { key: 'view_only',   label: 'View Only',   short: 'View',    color: '#45BBF0' },
    { key: 'can_upload',  label: 'Can Upload',  short: 'Upload',  color: '#F59E0B' },
    { key: 'can_edit',    label: 'Can Edit',    short: 'Edit',    color: '#8B5CF6' },
    { key: 'can_manage',  label: 'Can Manage',  short: 'Manage',  color: '#1D9E75' },
    { key: 'can_approve', label: 'Can Approve', short: 'Approve', color: '#0F4799' },
  ]

  const LEVEL_INDEX = {}
  LEVELS.forEach((l, i) => { LEVEL_INDEX[l.key] = i })

  /* ── Static display config (labels, icons, feature ordering) */
  // Derived from ModuleRegistry — populated by each page file's registration call.
  // Adding a new module only requires a ModuleRegistry.register() in its page file.
  const MODULE_CONFIG = Object.fromEntries(
    ModuleRegistry.getAll().map(m => [m.key, { label: m.label, icon: m.icon, features: m.features }])
  )

  const DEPARTMENTS = [
    { key: 'management',           label: 'Management'           },
    { key: 'operations_growth',    label: 'Operations & Growth'  },
    { key: 'people_culture',       label: 'People & Culture'     },
    { key: 'business_development', label: 'Business Development' },
    { key: 'content_strategy',     label: 'Content'              },
    { key: 'creative',             label: 'Creative'             },
    { key: 'creators',             label: 'Creators'             },
    { key: 'finance',              label: 'Finance'              },
  ]

  // Order is determined by the `order` field in each page file's registration.
  const MODULE_ORDER = ModuleRegistry.getAll().map(m => m.key)

  /* ── State ───────────────────────────────────────────────── */
  let _selectedDept  = 'management'
  // _state: { [module]: { [feature]: access_level_key } }
  let _state         = {}
  let _expandedMods  = new Set(MODULE_ORDER)  // all expanded by default
  let _saving        = false
  let _currentUser   = null

  /* ── render ──────────────────────────────────────────────── */
  function render(user) {
    _currentUser = user
    const isSuperAdmin = user.role === 'super_admin'

    return `
      <div class="access-layout">

        <!-- Left: department list -->
        <aside class="access-sidebar">
          <div class="access-sidebar-header">
            <div class="access-sidebar-title">Access Control</div>
            <p class="access-sidebar-sub">Set feature-level access per department</p>
          </div>

          ${isSuperAdmin ? `
            <div class="access-super-badge">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              Super Admin — full access, not affected by this matrix
            </div>
          ` : ''}

          <div class="access-dept-section">
            <div class="access-dept-label">DEPARTMENTS</div>
            <nav class="access-dept-list" id="access-dept-list">
              ${DEPARTMENTS.map(d => `
                <button class="access-dept-item${d.key === 'management' ? ' access-dept-item--active' : ''}"
                  data-dept="${d.key}">
                  ${d.label}
                </button>
              `).join('')}
            </nav>
          </div>
        </aside>

        <!-- Right: feature access matrix -->
        <div class="access-right">
          <div class="access-right-body" id="access-right-body">
            <p class="loading-text">Loading…</p>
          </div>
          <div class="access-right-footer" id="access-right-footer" style="display:none;">
            <p class="access-footer-hint">
              Higher levels include all lower levels.
              Changes apply to all employees in the department.
            </p>
            <div style="display:flex;gap:10px;flex-shrink:0;">
              <button class="btn btn--secondary" id="access-reset-btn">Reset to Default</button>
              <button class="btn btn--primary"   id="access-save-btn">Save Changes</button>
            </div>
          </div>
        </div>

      </div>
    `
  }

  /* ── init ────────────────────────────────────────────────── */
  async function init(user) {
    _currentUser   = user
    _selectedDept  = 'management'
    _state         = {}
    _expandedMods  = new Set(MODULE_ORDER)
    _saving        = false

    document.querySelectorAll('.access-dept-item').forEach(item => {
      item.addEventListener('click', () => {
        const dept = item.dataset.dept
        if (dept === _selectedDept) return
        document.querySelectorAll('.access-dept-item').forEach(i =>
          i.classList.remove('access-dept-item--active')
        )
        item.classList.add('access-dept-item--active')
        _loadDept(dept)
      })
    })

    await _loadDept('management')
  }

  /* ── Load dept matrix from DB ────────────────────────────── */
  async function _loadDept(dept) {
    _selectedDept = dept

    const body = document.getElementById('access-right-body')
    if (body) body.innerHTML = '<p class="loading-text">Loading…</p>'

    const { data, error } = await API.getAllDeptAccessMatrix(dept)

    if (error) {
      if (body) body.innerHTML = '<p class="empty-state">Failed to load access data.</p>'
      Utils.showToast('Failed to load access data.', 'error')
      return
    }

    // Build state from DB rows
    _state = {}
    ;(data || []).forEach(row => {
      if (!_state[row.module]) _state[row.module] = {}
      _state[row.module][row.feature] = row.access_level
    })

    // For any module/feature not in DB, default to no_access
    MODULE_ORDER.forEach(mod => {
      if (!_state[mod]) _state[mod] = {}
      const features = MODULE_CONFIG[mod]?.features || {}
      Object.keys(features).forEach(feat => {
        if (!_state[mod][feat]) _state[mod][feat] = 'no_access'
      })
    })

    _renderPanel()
  }

  /* ── Render the access matrix panel ─────────────────────── */
  function _renderPanel() {
    const deptInfo = DEPARTMENTS.find(d => d.key === _selectedDept) || { label: _selectedDept }
    const body     = document.getElementById('access-right-body')
    const footer   = document.getElementById('access-right-footer')
    if (!body) return

    body.innerHTML = `
      <div class="access-right-header">
        <div class="access-header-row">
          <div>
            <h2 class="access-dept-title">${deptInfo.label}</h2>
            <p class="access-dept-subtitle">Feature-level access for this department</p>
          </div>
          <div class="access-level-legend">
            ${LEVELS.map(l => `
              <span class="access-legend-item" title="${l.label}">
                <span class="access-level-dot" style="background:${l.color}"></span>
                <span>${l.short}</span>
              </span>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="access-modules" id="access-modules">
        ${MODULE_ORDER.map(modKey => _renderModule(modKey)).join('')}
      </div>
    `

    // Bind expand/collapse
    body.querySelectorAll('.access-mod-header').forEach(header => {
      header.addEventListener('click', () => {
        const mod     = header.dataset.module
        const isOpen  = _expandedMods.has(mod)
        if (isOpen) { _expandedMods.delete(mod) } else { _expandedMods.add(mod) }
        const featureList = body.querySelector(`.access-mod-features[data-module="${mod}"]`)
        const chevron     = header.querySelector('.access-mod-chevron')
        if (featureList) featureList.style.display = !isOpen ? 'block' : 'none'
        if (chevron) chevron.style.transform = !isOpen ? 'rotate(0deg)' : 'rotate(-90deg)'
      })
    })

    // Bind pill clicks
    body.querySelectorAll('.alp').forEach(pill => {
      pill.addEventListener('click', (e) => {
        e.stopPropagation()
        const pills   = pill.closest('.access-level-pills')
        const mod     = pills.dataset.module
        const feature = pills.dataset.feature
        const level   = pill.dataset.level
        if (!_state[mod]) _state[mod] = {}
        _state[mod][feature] = level
        // Update pill visual states
        pills.querySelectorAll('.alp').forEach(p => {
          const active = p.dataset.level === level
          const cfg    = LEVELS.find(l => l.key === p.dataset.level)
          p.classList.toggle('alp--active', active)
          p.style.setProperty('--alp-bg', active ? cfg.color : 'transparent')
          p.style.setProperty('--alp-border', active ? cfg.color : '')
          p.style.setProperty('--alp-color', active ? '#fff' : '')
        })
        // Update summary badge
        _updateModSummary(body, mod)
      })
    })

    // Show footer
    if (footer) {
      footer.style.display = 'flex'
      document.getElementById('access-save-btn').onclick  = _saveChanges
      document.getElementById('access-reset-btn').onclick = _resetToDefault
    }
  }

  function _updateModSummary(body, modKey) {
    const modState   = _state[modKey] || {}
    const features   = MODULE_CONFIG[modKey]?.features || {}
    const active     = Object.values(modState).filter(l => l !== 'no_access').length
    const total      = Object.keys(features).length
    const hasAny     = active > 0
    const summary    = body.querySelector(`.access-mod-header[data-module="${modKey}"] .access-mod-summary`)
    if (!summary) return
    summary.textContent  = hasAny ? `${active} / ${total}` : 'No Access'
    summary.className    = `access-mod-summary${hasAny ? ' access-mod-summary--active' : ''}`
  }

  function _renderModule(modKey) {
    const config  = MODULE_CONFIG[modKey]
    if (!config) return ''
    const features = config.features || {}
    const isOpen   = _expandedMods.has(modKey)
    const modState = _state[modKey] || {}
    const active   = Object.values(modState).filter(l => l !== 'no_access').length
    const total    = Object.keys(features).length
    const hasAny   = active > 0

    return `
      <div class="access-mod-card">
        <div class="access-mod-header" data-module="${modKey}">
          <div class="access-mod-header-left">
            <span class="access-mod-chevron" style="transform:rotate(${isOpen ? '0' : '-90'}deg);">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </span>
            <span class="access-mod-icon">${config.icon}</span>
            <span class="access-mod-label">${config.label}</span>
          </div>
          <span class="access-mod-summary ${hasAny ? 'access-mod-summary--active' : ''}">
            ${hasAny ? `${active} / ${total}` : 'No Access'}
          </span>
        </div>
        <div class="access-mod-features" data-module="${modKey}" style="display:${isOpen ? 'block' : 'none'};">
          ${Object.entries(features).map(([featKey, featLabel]) => {
            const current = modState[featKey] || 'no_access'
            return `
              <div class="access-feature-row">
                <span class="access-feature-name">${featLabel}</span>
                ${_renderLevelPills(modKey, featKey, current)}
              </div>
            `
          }).join('')}
        </div>
      </div>
    `
  }

  function _renderLevelPills(modKey, featKey, currentLevel) {
    return `
      <div class="access-level-pills" data-module="${modKey}" data-feature="${featKey}">
        ${LEVELS.map(l => {
          const active = l.key === currentLevel
          return `<button class="alp${active ? ' alp--active' : ''}"
            data-level="${l.key}"
            title="${l.label}"
            style="${active ? `--alp-bg:${l.color};--alp-border:${l.color};--alp-color:#fff;` : ''}"
          >${l.short}</button>`
        }).join('')}
      </div>
    `
  }

  /* ── Save ────────────────────────────────────────────────── */
  async function _saveChanges() {
    if (_saving) return
    _saving = true

    const saveBtn = document.getElementById('access-save-btn')
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…' }

    // Build rows from state
    const rows = []
    MODULE_ORDER.forEach(modKey => {
      const features = MODULE_CONFIG[modKey]?.features || {}
      Object.keys(features).forEach(featKey => {
        rows.push({
          department:   _selectedDept,
          module:       modKey,
          feature:      featKey,
          access_level: (_state[modKey]?.[featKey]) || 'no_access',
        })
      })
    })

    const { error } = await API.saveAccessMatrix(rows)

    _saving = false
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Changes' }

    if (error) {
      Utils.showToast('Failed to save: ' + error.message, 'error')
    } else {
      const deptLabel = DEPARTMENTS.find(d => d.key === _selectedDept)?.label || _selectedDept
      Utils.showToast(`Access control saved for ${deptLabel}.`, 'success')
    }
  }

  /* ── Reset to Default ────────────────────────────────────── */
  function _resetToDefault() {
    const defaults = DEFAULT_ACCESS[_selectedDept]
    if (!defaults) {
      Utils.showToast('No defaults defined for this department.', 'error')
      return
    }

    // Deep-copy defaults into state
    MODULE_ORDER.forEach(modKey => {
      if (!_state[modKey]) _state[modKey] = {}
      const features = MODULE_CONFIG[modKey]?.features || {}
      Object.keys(features).forEach(featKey => {
        _state[modKey][featKey] = defaults[modKey]?.[featKey] || 'no_access'
      })
    })

    // Update pill states and summary badges
    const body = document.getElementById('access-right-body')
    if (body) {
      body.querySelectorAll('.access-level-pills').forEach(pills => {
        const mod     = pills.dataset.module
        const feature = pills.dataset.feature
        const val     = _state[mod]?.[feature] || 'no_access'
        pills.querySelectorAll('.alp').forEach(p => {
          const active = p.dataset.level === val
          const cfg    = LEVELS.find(l => l.key === p.dataset.level)
          p.classList.toggle('alp--active', active)
          p.style.setProperty('--alp-bg',     active ? cfg.color : 'transparent')
          p.style.setProperty('--alp-border',  active ? cfg.color : '')
          p.style.setProperty('--alp-color',   active ? '#fff' : '')
        })
      })
      MODULE_ORDER.forEach(modKey => _updateModSummary(body, modKey))
    }

    Utils.showToast('Defaults restored — click Save Changes to apply.', 'success')
  }

  /* ── Default access matrix ───────────────────────────────── */
  const DEFAULT_ACCESS = {
    management: {
      client_dashboard:    { view_dashboard: 'view_only',   upload_performance_data: 'can_manage',  update_client_status: 'can_manage'  },
      client_directory:    { view_clients:   'view_only',   create_client:           'can_manage',  edit_client:          'can_manage',  edit_project_codes: 'can_edit', manage_project_codes: 'no_access' },
      client_repository:   { view_files:     'view_only',   upload_files:            'can_upload',  manage_files:         'can_manage'  },
      timesheet:           { log_entry:      'can_upload',  submit_timesheet:        'can_upload',  approve_timesheets:   'can_approve' },
      reimbursements:      { raise_pre_approval: 'can_upload', raise_expense_claim:  'can_upload',  approve_requests:     'can_approve',  process_payment: 'no_access'  },
      asset_management:    { view_assets: 'view_only', view_available_assets: 'view_only', request_asset: 'can_upload', manage_assets: 'can_manage', view_inventories: 'can_manage', retire_delete_asset: 'can_manage', resolve_repair: 'can_approve', manage_asset_types: 'can_manage' },
      tools_subscriptions: { view_tools:     'view_only',   request_access:          'can_upload',  manage_tools:         'can_manage',   approve_requests: 'can_approve' },
      people_hrms:         { view_employees: 'can_manage',  manage_employees:        'can_manage',  invite_employee:      'can_manage',   manage_access:    'no_access'   },
      leave_tracker:       { view_leaves: 'view_only', apply_leave: 'can_upload', apply_wfh: 'can_upload', approve_leave: 'can_approve', manage_leave_settings: 'no_access', manage_wfh_quotas: 'no_access', manage_leave_credits: 'no_access' },
      announcements:       { view_announcements: 'view_only', react_announcements: 'can_upload', post_announcement: 'can_manage', manage_announcements: 'no_access' },
      policies:            { view_policies: 'view_only', manage_policies: 'no_access' },
    },
    operations_growth: {
      client_dashboard:    { view_dashboard: 'view_only',   upload_performance_data: 'can_manage',  update_client_status: 'can_manage'  },
      client_directory:    { view_clients:   'view_only',   create_client:           'can_manage',  edit_client:          'can_manage',  edit_project_codes: 'can_edit', manage_project_codes: 'no_access' },
      client_repository:   { view_files:     'view_only',   upload_files:            'can_upload',  manage_files:         'can_manage'  },
      timesheet:           { log_entry:      'can_upload',  submit_timesheet:        'can_upload',  approve_timesheets:   'can_approve' },
      reimbursements:      { raise_pre_approval: 'can_upload', raise_expense_claim:  'can_upload',  approve_requests:     'can_approve',  process_payment: 'no_access'  },
      asset_management:    { view_assets: 'view_only', view_available_assets: 'view_only', request_asset: 'can_upload', manage_assets: 'can_manage', view_inventories: 'can_manage', retire_delete_asset: 'can_manage', resolve_repair: 'can_approve', manage_asset_types: 'can_manage' },
      tools_subscriptions: { view_tools:     'view_only',   request_access:          'can_upload',  manage_tools:         'can_manage',   approve_requests: 'can_approve' },
      people_hrms:         { view_employees: 'can_manage',  manage_employees:        'can_manage',  invite_employee:      'can_manage',   manage_access:    'no_access'   },
      leave_tracker:       { view_leaves: 'view_only', apply_leave: 'can_upload', apply_wfh: 'can_upload', approve_leave: 'can_approve', manage_leave_settings: 'no_access', manage_wfh_quotas: 'no_access', manage_leave_credits: 'no_access' },
      announcements:       { view_announcements: 'view_only', react_announcements: 'can_upload', post_announcement: 'can_manage', manage_announcements: 'no_access' },
      policies:            { view_policies: 'view_only', manage_policies: 'no_access' },
    },
    people_culture: {
      client_dashboard:    { view_dashboard: 'view_only',   upload_performance_data: 'no_access',   update_client_status: 'no_access'   },
      client_directory:    { view_clients:   'view_only',   create_client:           'no_access',   edit_client:          'no_access',   edit_project_codes: 'no_access', manage_project_codes: 'no_access' },
      client_repository:   { view_files:     'view_only',   upload_files:            'no_access',   manage_files:         'no_access'   },
      timesheet:           { log_entry:      'can_upload',  submit_timesheet:        'can_upload',  approve_timesheets:   'can_approve' },
      reimbursements:      { raise_pre_approval: 'can_upload', raise_expense_claim:  'can_upload',  approve_requests:     'can_approve',  process_payment: 'no_access'  },
      asset_management:    { view_assets: 'view_only', view_available_assets: 'view_only', request_asset: 'can_upload', manage_assets: 'can_manage', view_inventories: 'can_manage', retire_delete_asset: 'can_manage', resolve_repair: 'can_manage', manage_asset_types: 'can_manage' },
      tools_subscriptions: { view_tools:     'view_only',   request_access:          'can_upload',  manage_tools:         'can_manage',   approve_requests: 'can_approve' },
      people_hrms:         { view_employees: 'can_manage',  manage_employees:        'can_manage',  invite_employee:      'can_manage',   manage_access:    'can_manage'  },
      leave_tracker:       { view_leaves: 'view_only', apply_leave: 'can_upload', apply_wfh: 'can_upload', approve_leave: 'can_approve', manage_leave_settings: 'can_manage', manage_wfh_quotas: 'can_manage', manage_leave_credits: 'can_manage' },
      announcements:       { view_announcements: 'view_only', react_announcements: 'can_upload', post_announcement: 'can_manage', manage_announcements: 'can_manage' },
      policies:            { view_policies: 'view_only', manage_policies: 'can_manage' },
    },
    business_development: {
      client_dashboard:    { view_dashboard: 'view_only',   upload_performance_data: 'no_access',   update_client_status: 'no_access'   },
      client_directory:    { view_clients:   'view_only',   create_client:           'can_upload',  edit_client:          'can_edit',    edit_project_codes: 'no_access', manage_project_codes: 'no_access' },
      client_repository:   { view_files:     'view_only',   upload_files:            'no_access',   manage_files:         'no_access'   },
      timesheet:           { log_entry:      'can_upload',  submit_timesheet:        'can_upload',  approve_timesheets:   'no_access'   },
      reimbursements:      { raise_pre_approval: 'can_upload', raise_expense_claim:  'can_upload',  approve_requests:     'no_access',   process_payment: 'no_access'  },
      asset_management:    { view_assets: 'view_only', view_available_assets: 'view_only', request_asset: 'can_upload', manage_assets: 'no_access', view_inventories: 'no_access', retire_delete_asset: 'no_access', resolve_repair: 'no_access', manage_asset_types: 'no_access' },
      tools_subscriptions: { view_tools:     'view_only',   request_access:          'can_upload',  manage_tools:         'no_access',   approve_requests: 'no_access'  },
      people_hrms:         { view_employees: 'no_access',   manage_employees:        'no_access',   invite_employee:      'no_access',   manage_access:    'no_access'   },
      leave_tracker:       { view_leaves: 'view_only', apply_leave: 'can_upload', apply_wfh: 'can_upload', approve_leave: 'no_access', manage_leave_settings: 'no_access', manage_wfh_quotas: 'no_access', manage_leave_credits: 'no_access' },
      announcements:       { view_announcements: 'view_only', react_announcements: 'can_upload', post_announcement: 'no_access', manage_announcements: 'no_access' },
      policies:            { view_policies: 'view_only', manage_policies: 'no_access' },
    },
    content_strategy: {
      client_dashboard:    { view_dashboard: 'view_only',   upload_performance_data: 'no_access',   update_client_status: 'no_access'   },
      client_directory:    { view_clients:   'view_only',   create_client:           'no_access',   edit_client:          'no_access',   edit_project_codes: 'no_access', manage_project_codes: 'no_access' },
      client_repository:   { view_files:     'view_only',   upload_files:            'can_upload',  manage_files:         'no_access'   },
      timesheet:           { log_entry:      'can_upload',  submit_timesheet:        'can_upload',  approve_timesheets:   'can_approve' },
      reimbursements:      { raise_pre_approval: 'can_upload', raise_expense_claim:  'can_upload',  approve_requests:     'no_access',   process_payment: 'no_access'  },
      asset_management:    { view_assets: 'view_only', view_available_assets: 'view_only', request_asset: 'can_upload', manage_assets: 'no_access', view_inventories: 'no_access', retire_delete_asset: 'no_access', resolve_repair: 'no_access', manage_asset_types: 'no_access' },
      tools_subscriptions: { view_tools:     'view_only',   request_access:          'can_upload',  manage_tools:         'no_access',   approve_requests: 'no_access'  },
      people_hrms:         { view_employees: 'no_access',   manage_employees:        'no_access',   invite_employee:      'no_access',   manage_access:    'no_access'   },
      leave_tracker:       { view_leaves: 'view_only', apply_leave: 'can_upload', apply_wfh: 'can_upload', approve_leave: 'can_approve', manage_leave_settings: 'no_access', manage_wfh_quotas: 'no_access', manage_leave_credits: 'no_access' },
      announcements:       { view_announcements: 'view_only', react_announcements: 'can_upload', post_announcement: 'no_access', manage_announcements: 'no_access' },
      policies:            { view_policies: 'view_only', manage_policies: 'no_access' },
    },
    creative: {
      client_dashboard:    { view_dashboard: 'view_only',   upload_performance_data: 'no_access',   update_client_status: 'no_access'   },
      client_directory:    { view_clients:   'view_only',   create_client:           'no_access',   edit_client:          'no_access',   edit_project_codes: 'no_access', manage_project_codes: 'no_access' },
      client_repository:   { view_files:     'view_only',   upload_files:            'can_upload',  manage_files:         'no_access'   },
      timesheet:           { log_entry:      'can_upload',  submit_timesheet:        'can_upload',  approve_timesheets:   'can_approve' },
      reimbursements:      { raise_pre_approval: 'can_upload', raise_expense_claim:  'can_upload',  approve_requests:     'no_access',   process_payment: 'no_access'  },
      asset_management:    { view_assets: 'view_only', view_available_assets: 'view_only', request_asset: 'can_upload', manage_assets: 'no_access', view_inventories: 'no_access', retire_delete_asset: 'no_access', resolve_repair: 'no_access', manage_asset_types: 'no_access' },
      tools_subscriptions: { view_tools:     'view_only',   request_access:          'can_upload',  manage_tools:         'no_access',   approve_requests: 'no_access'  },
      people_hrms:         { view_employees: 'no_access',   manage_employees:        'no_access',   invite_employee:      'no_access',   manage_access:    'no_access'   },
      leave_tracker:       { view_leaves: 'view_only', apply_leave: 'can_upload', apply_wfh: 'can_upload', approve_leave: 'can_approve', manage_leave_settings: 'no_access', manage_wfh_quotas: 'no_access', manage_leave_credits: 'no_access' },
      announcements:       { view_announcements: 'view_only', react_announcements: 'can_upload', post_announcement: 'no_access', manage_announcements: 'no_access' },
      policies:            { view_policies: 'view_only', manage_policies: 'no_access' },
    },
    creators: {
      client_dashboard:    { view_dashboard: 'no_access',   upload_performance_data: 'no_access',   update_client_status: 'no_access'   },
      client_directory:    { view_clients:   'no_access',   create_client:           'no_access',   edit_client:          'no_access',   edit_project_codes: 'no_access', manage_project_codes: 'no_access' },
      client_repository:   { view_files:     'view_only',   upload_files:            'can_upload',  manage_files:         'no_access'   },
      timesheet:           { log_entry:      'can_upload',  submit_timesheet:        'can_upload',  approve_timesheets:   'no_access'   },
      reimbursements:      { raise_pre_approval: 'can_upload', raise_expense_claim:  'can_upload',  approve_requests:     'no_access',   process_payment: 'no_access'  },
      asset_management:    { view_assets: 'view_only', view_available_assets: 'view_only', request_asset: 'no_access', manage_assets: 'no_access', view_inventories: 'no_access', retire_delete_asset: 'no_access', resolve_repair: 'no_access', manage_asset_types: 'no_access' },
      tools_subscriptions: { view_tools:     'view_only',   request_access:          'can_upload',  manage_tools:         'no_access',   approve_requests: 'no_access'  },
      people_hrms:         { view_employees: 'no_access',   manage_employees:        'no_access',   invite_employee:      'no_access',   manage_access:    'no_access'   },
      leave_tracker:       { view_leaves: 'view_only', apply_leave: 'can_upload', apply_wfh: 'can_upload', approve_leave: 'no_access', manage_leave_settings: 'no_access', manage_wfh_quotas: 'no_access', manage_leave_credits: 'no_access' },
      announcements:       { view_announcements: 'view_only', react_announcements: 'can_upload', post_announcement: 'no_access', manage_announcements: 'no_access' },
      policies:            { view_policies: 'view_only', manage_policies: 'no_access' },
    },
    finance: {
      client_dashboard:    { view_dashboard: 'view_only',   upload_performance_data: 'no_access',   update_client_status: 'no_access'   },
      client_directory:    { view_clients:   'view_only',   create_client:           'no_access',   edit_client:          'no_access',   edit_project_codes: 'no_access', manage_project_codes: 'no_access' },
      client_repository:   { view_files:     'view_only',   upload_files:            'no_access',   manage_files:         'no_access'   },
      timesheet:           { log_entry:      'can_upload',  submit_timesheet:        'can_upload',  approve_timesheets:   'no_access'   },
      reimbursements:      { raise_pre_approval: 'can_upload', raise_expense_claim:  'can_upload',  approve_requests:     'can_approve',  process_payment: 'can_approve' },
      asset_management:    { view_assets: 'view_only', view_available_assets: 'view_only', request_asset: 'no_access', manage_assets: 'no_access', view_inventories: 'no_access', retire_delete_asset: 'no_access', resolve_repair: 'no_access', manage_asset_types: 'no_access' },
      tools_subscriptions: { view_tools:     'view_only',   request_access:          'can_upload',  manage_tools:         'can_manage',   approve_requests: 'can_approve' },
      people_hrms:         { view_employees: 'no_access',   manage_employees:        'no_access',   invite_employee:      'no_access',   manage_access:    'no_access'   },
      leave_tracker:       { view_leaves: 'view_only', apply_leave: 'can_upload', apply_wfh: 'can_upload', approve_leave: 'no_access', manage_leave_settings: 'no_access', manage_wfh_quotas: 'no_access', manage_leave_credits: 'no_access' },
      announcements:       { view_announcements: 'view_only', react_announcements: 'can_upload', post_announcement: 'no_access', manage_announcements: 'no_access' },
      policies:            { view_policies: 'view_only', manage_policies: 'no_access' },
    },
  }

  return { render, init }
})()
