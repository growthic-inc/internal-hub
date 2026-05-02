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
  const MODULE_CONFIG = {
    client_dashboard: {
      label: 'Client Dashboard',
      icon: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
      features: {
        view_dashboard:          'View Dashboard',
        upload_performance_data: 'Upload Performance Data',
        update_client_status:    'Update Client Status',
      },
    },
    client_directory: {
      label: 'Client Directory',
      icon: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`,
      features: {
        view_clients:  'View Clients',
        create_client: 'Create Client',
        edit_client:   'Edit Client',
      },
    },
    client_repository: {
      label: 'Client Repository',
      icon: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
      features: {
        view_files:    'View Files',
        upload_files:  'Upload Files',
        manage_files:  'Manage Files (delete/rename)',
      },
    },
    timesheet: {
      label: 'Timesheet',
      icon: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
      features: {
        log_entry:          'Log Time Entry',
        submit_timesheet:   'Submit Timesheet',
        approve_timesheets: 'Approve Team Timesheets',
      },
    },
    reimbursements: {
      label: 'Reimbursements',
      icon: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`,
      features: {
        raise_pre_approval:  'Raise Pre-Approval Request',
        raise_expense_claim: 'Raise Expense Claim',
        approve_requests:    'Approve Requests',
        process_payment:     'Process Payment',
      },
    },
    asset_management: {
      label: 'Asset Management',
      icon: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`,
      features: {
        view_assets:        'View Assets',
        request_asset:      'Request Asset',
        manage_assets:      'Manage Assets (assign/return)',
        report_issue:       'Report Repair / Issue',
        resolve_repair:     'Resolve / Close Repairs',
        manage_asset_types: 'Manage Asset Types',
      },
    },
    tools_subscriptions: {
      label: 'Tools & Subscriptions',
      icon: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
      features: {
        view_tools:       'View Tool Registry',
        request_access:   'Request Tool Access',
        manage_tools:     'Manage Tools (add/edit)',
        approve_requests: 'Approve Access Requests',
      },
    },
    people_hrms: {
      label: 'People & HRMS',
      icon: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
      features: {
        view_employees:    'View Employees',
        manage_employees:  'Manage Employees (edit/deactivate)',
        invite_employee:   'Invite New Employee',
        manage_access:     'Manage Access Control',
      },
    },
    leave_tracker: {
      label: 'Leave Tracker',
      icon: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
      features: {
        view_leaves:            'View Own Leaves & WFH',
        apply_leave:            'Apply for Leave',
        apply_wfh:              'Apply for WFH',
        approve_leave:          'Approve / Reject Team Leaves',
        manage_leave_settings:  'Manage Leave Types & Holidays',
        manage_wfh_quotas:      'Manage WFH Quotas',
        manage_leave_credits:   'Manage Leave Allocations',
      },
    },
    announcements: {
      label: 'Announcements',
      icon: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>`,
      features: {
        view_announcements:   'View Announcements',
        react_announcements:  'React to Announcements',
        post_announcement:    'Post Announcements (HR)',
        manage_announcements: 'Manage All Announcements',
      },
    },
    policies: {
      label: 'Policies & Documents',
      icon: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
      features: {
        view_policies:    'View Policies',
        manage_policies:  'Manage Policies (HR)',
      },
    },
  }

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

  // Module display order
  const MODULE_ORDER = [
    'client_dashboard',
    'client_directory',
    'client_repository',
    'timesheet',
    'reimbursements',
    'asset_management',
    'tools_subscriptions',
    'people_hrms',
    'leave_tracker',
    'announcements',
    'policies',
  ]

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
      client_directory:    { view_clients:   'view_only',   create_client:           'can_manage',  edit_client:          'can_manage'  },
      client_repository:   { view_files:     'view_only',   upload_files:            'can_upload',  manage_files:         'can_manage'  },
      timesheet:           { log_entry:      'can_upload',  submit_timesheet:        'can_upload',  approve_timesheets:   'can_approve' },
      reimbursements:      { raise_pre_approval: 'can_upload', raise_expense_claim:  'can_upload',  approve_requests:     'can_approve',  process_payment: 'no_access'  },
      asset_management:    { view_assets: 'view_only', request_asset: 'can_upload', manage_assets: 'can_manage', report_issue: 'can_upload', resolve_repair: 'can_approve', manage_asset_types: 'can_manage' },
      tools_subscriptions: { view_tools:     'view_only',   request_access:          'can_upload',  manage_tools:         'can_manage',   approve_requests: 'can_approve' },
      people_hrms:         { view_employees: 'can_manage',  manage_employees:        'can_manage',  invite_employee:      'can_manage',   manage_access:    'no_access'   },
      leave_tracker:       { view_leaves: 'view_only', apply_leave: 'can_upload', apply_wfh: 'can_upload', approve_leave: 'can_approve', manage_leave_settings: 'no_access', manage_wfh_quotas: 'no_access', manage_leave_credits: 'no_access' },
      announcements:       { view_announcements: 'view_only', react_announcements: 'can_upload', post_announcement: 'can_manage', manage_announcements: 'no_access' },
      policies:            { view_policies: 'view_only', manage_policies: 'no_access' },
    },
    operations_growth: {
      client_dashboard:    { view_dashboard: 'view_only',   upload_performance_data: 'can_manage',  update_client_status: 'can_manage'  },
      client_directory:    { view_clients:   'view_only',   create_client:           'can_manage',  edit_client:          'can_manage'  },
      client_repository:   { view_files:     'view_only',   upload_files:            'can_upload',  manage_files:         'can_manage'  },
      timesheet:           { log_entry:      'can_upload',  submit_timesheet:        'can_upload',  approve_timesheets:   'can_approve' },
      reimbursements:      { raise_pre_approval: 'can_upload', raise_expense_claim:  'can_upload',  approve_requests:     'can_approve',  process_payment: 'no_access'  },
      asset_management:    { view_assets: 'view_only', request_asset: 'can_upload', manage_assets: 'can_manage', report_issue: 'can_upload', resolve_repair: 'can_approve', manage_asset_types: 'can_manage' },
      tools_subscriptions: { view_tools:     'view_only',   request_access:          'can_upload',  manage_tools:         'can_manage',   approve_requests: 'can_approve' },
      people_hrms:         { view_employees: 'can_manage',  manage_employees:        'can_manage',  invite_employee:      'can_manage',   manage_access:    'no_access'   },
      leave_tracker:       { view_leaves: 'view_only', apply_leave: 'can_upload', apply_wfh: 'can_upload', approve_leave: 'can_approve', manage_leave_settings: 'no_access', manage_wfh_quotas: 'no_access', manage_leave_credits: 'no_access' },
      announcements:       { view_announcements: 'view_only', react_announcements: 'can_upload', post_announcement: 'can_manage', manage_announcements: 'no_access' },
      policies:            { view_policies: 'view_only', manage_policies: 'no_access' },
    },
    people_culture: {
      client_dashboard:    { view_dashboard: 'view_only',   upload_performance_data: 'no_access',   update_client_status: 'no_access'   },
      client_directory:    { view_clients:   'view_only',   create_client:           'no_access',   edit_client:          'no_access'   },
      client_repository:   { view_files:     'view_only',   upload_files:            'no_access',   manage_files:         'no_access'   },
      timesheet:           { log_entry:      'can_upload',  submit_timesheet:        'can_upload',  approve_timesheets:   'can_approve' },
      reimbursements:      { raise_pre_approval: 'can_upload', raise_expense_claim:  'can_upload',  approve_requests:     'can_approve',  process_payment: 'no_access'  },
      asset_management:    { view_assets: 'view_only', request_asset: 'can_upload', manage_assets: 'can_manage', report_issue: 'can_upload', resolve_repair: 'can_manage', manage_asset_types: 'can_manage' },
      tools_subscriptions: { view_tools:     'view_only',   request_access:          'can_upload',  manage_tools:         'can_manage',   approve_requests: 'can_approve' },
      people_hrms:         { view_employees: 'can_manage',  manage_employees:        'can_manage',  invite_employee:      'can_manage',   manage_access:    'can_manage'  },
      leave_tracker:       { view_leaves: 'view_only', apply_leave: 'can_upload', apply_wfh: 'can_upload', approve_leave: 'can_approve', manage_leave_settings: 'can_manage', manage_wfh_quotas: 'can_manage', manage_leave_credits: 'can_manage' },
      announcements:       { view_announcements: 'view_only', react_announcements: 'can_upload', post_announcement: 'can_manage', manage_announcements: 'can_manage' },
      policies:            { view_policies: 'view_only', manage_policies: 'can_manage' },
    },
    business_development: {
      client_dashboard:    { view_dashboard: 'view_only',   upload_performance_data: 'no_access',   update_client_status: 'no_access'   },
      client_directory:    { view_clients:   'view_only',   create_client:           'can_upload',  edit_client:          'can_edit'    },
      client_repository:   { view_files:     'view_only',   upload_files:            'no_access',   manage_files:         'no_access'   },
      timesheet:           { log_entry:      'can_upload',  submit_timesheet:        'can_upload',  approve_timesheets:   'no_access'   },
      reimbursements:      { raise_pre_approval: 'can_upload', raise_expense_claim:  'can_upload',  approve_requests:     'no_access',   process_payment: 'no_access'  },
      asset_management:    { view_assets: 'view_only', request_asset: 'can_upload', manage_assets: 'no_access', report_issue: 'can_upload', resolve_repair: 'no_access', manage_asset_types: 'no_access' },
      tools_subscriptions: { view_tools:     'view_only',   request_access:          'can_upload',  manage_tools:         'no_access',   approve_requests: 'no_access'  },
      people_hrms:         { view_employees: 'no_access',   manage_employees:        'no_access',   invite_employee:      'no_access',   manage_access:    'no_access'   },
      leave_tracker:       { view_leaves: 'view_only', apply_leave: 'can_upload', apply_wfh: 'can_upload', approve_leave: 'no_access', manage_leave_settings: 'no_access', manage_wfh_quotas: 'no_access', manage_leave_credits: 'no_access' },
      announcements:       { view_announcements: 'view_only', react_announcements: 'can_upload', post_announcement: 'no_access', manage_announcements: 'no_access' },
      policies:            { view_policies: 'view_only', manage_policies: 'no_access' },
    },
    content_strategy: {
      client_dashboard:    { view_dashboard: 'view_only',   upload_performance_data: 'no_access',   update_client_status: 'no_access'   },
      client_directory:    { view_clients:   'view_only',   create_client:           'no_access',   edit_client:          'no_access'   },
      client_repository:   { view_files:     'view_only',   upload_files:            'can_upload',  manage_files:         'no_access'   },
      timesheet:           { log_entry:      'can_upload',  submit_timesheet:        'can_upload',  approve_timesheets:   'can_approve' },
      reimbursements:      { raise_pre_approval: 'can_upload', raise_expense_claim:  'can_upload',  approve_requests:     'no_access',   process_payment: 'no_access'  },
      asset_management:    { view_assets: 'view_only', request_asset: 'can_upload', manage_assets: 'no_access', report_issue: 'can_upload', resolve_repair: 'no_access', manage_asset_types: 'no_access' },
      tools_subscriptions: { view_tools:     'view_only',   request_access:          'can_upload',  manage_tools:         'no_access',   approve_requests: 'no_access'  },
      people_hrms:         { view_employees: 'no_access',   manage_employees:        'no_access',   invite_employee:      'no_access',   manage_access:    'no_access'   },
      leave_tracker:       { view_leaves: 'view_only', apply_leave: 'can_upload', apply_wfh: 'can_upload', approve_leave: 'can_approve', manage_leave_settings: 'no_access', manage_wfh_quotas: 'no_access', manage_leave_credits: 'no_access' },
      announcements:       { view_announcements: 'view_only', react_announcements: 'can_upload', post_announcement: 'no_access', manage_announcements: 'no_access' },
      policies:            { view_policies: 'view_only', manage_policies: 'no_access' },
    },
    creative: {
      client_dashboard:    { view_dashboard: 'view_only',   upload_performance_data: 'no_access',   update_client_status: 'no_access'   },
      client_directory:    { view_clients:   'view_only',   create_client:           'no_access',   edit_client:          'no_access'   },
      client_repository:   { view_files:     'view_only',   upload_files:            'can_upload',  manage_files:         'no_access'   },
      timesheet:           { log_entry:      'can_upload',  submit_timesheet:        'can_upload',  approve_timesheets:   'can_approve' },
      reimbursements:      { raise_pre_approval: 'can_upload', raise_expense_claim:  'can_upload',  approve_requests:     'no_access',   process_payment: 'no_access'  },
      asset_management:    { view_assets: 'view_only', request_asset: 'can_upload', manage_assets: 'no_access', report_issue: 'can_upload', resolve_repair: 'no_access', manage_asset_types: 'no_access' },
      tools_subscriptions: { view_tools:     'view_only',   request_access:          'can_upload',  manage_tools:         'no_access',   approve_requests: 'no_access'  },
      people_hrms:         { view_employees: 'no_access',   manage_employees:        'no_access',   invite_employee:      'no_access',   manage_access:    'no_access'   },
      leave_tracker:       { view_leaves: 'view_only', apply_leave: 'can_upload', apply_wfh: 'can_upload', approve_leave: 'can_approve', manage_leave_settings: 'no_access', manage_wfh_quotas: 'no_access', manage_leave_credits: 'no_access' },
      announcements:       { view_announcements: 'view_only', react_announcements: 'can_upload', post_announcement: 'no_access', manage_announcements: 'no_access' },
      policies:            { view_policies: 'view_only', manage_policies: 'no_access' },
    },
    creators: {
      client_dashboard:    { view_dashboard: 'no_access',   upload_performance_data: 'no_access',   update_client_status: 'no_access'   },
      client_directory:    { view_clients:   'no_access',   create_client:           'no_access',   edit_client:          'no_access'   },
      client_repository:   { view_files:     'view_only',   upload_files:            'can_upload',  manage_files:         'no_access'   },
      timesheet:           { log_entry:      'can_upload',  submit_timesheet:        'can_upload',  approve_timesheets:   'no_access'   },
      reimbursements:      { raise_pre_approval: 'can_upload', raise_expense_claim:  'can_upload',  approve_requests:     'no_access',   process_payment: 'no_access'  },
      asset_management:    { view_assets: 'view_only', request_asset: 'no_access', manage_assets: 'no_access', report_issue: 'can_upload', resolve_repair: 'no_access', manage_asset_types: 'no_access' },
      tools_subscriptions: { view_tools:     'view_only',   request_access:          'can_upload',  manage_tools:         'no_access',   approve_requests: 'no_access'  },
      people_hrms:         { view_employees: 'no_access',   manage_employees:        'no_access',   invite_employee:      'no_access',   manage_access:    'no_access'   },
      leave_tracker:       { view_leaves: 'view_only', apply_leave: 'can_upload', apply_wfh: 'can_upload', approve_leave: 'no_access', manage_leave_settings: 'no_access', manage_wfh_quotas: 'no_access', manage_leave_credits: 'no_access' },
      announcements:       { view_announcements: 'view_only', react_announcements: 'can_upload', post_announcement: 'no_access', manage_announcements: 'no_access' },
      policies:            { view_policies: 'view_only', manage_policies: 'no_access' },
    },
    finance: {
      client_dashboard:    { view_dashboard: 'view_only',   upload_performance_data: 'no_access',   update_client_status: 'no_access'   },
      client_directory:    { view_clients:   'view_only',   create_client:           'no_access',   edit_client:          'no_access'   },
      client_repository:   { view_files:     'view_only',   upload_files:            'no_access',   manage_files:         'no_access'   },
      timesheet:           { log_entry:      'can_upload',  submit_timesheet:        'can_upload',  approve_timesheets:   'no_access'   },
      reimbursements:      { raise_pre_approval: 'can_upload', raise_expense_claim:  'can_upload',  approve_requests:     'can_approve',  process_payment: 'can_approve' },
      asset_management:    { view_assets: 'view_only', request_asset: 'no_access', manage_assets: 'no_access', report_issue: 'can_upload', resolve_repair: 'no_access', manage_asset_types: 'no_access' },
      tools_subscriptions: { view_tools:     'view_only',   request_access:          'can_upload',  manage_tools:         'can_manage',   approve_requests: 'can_approve' },
      people_hrms:         { view_employees: 'no_access',   manage_employees:        'no_access',   invite_employee:      'no_access',   manage_access:    'no_access'   },
      leave_tracker:       { view_leaves: 'view_only', apply_leave: 'can_upload', apply_wfh: 'can_upload', approve_leave: 'no_access', manage_leave_settings: 'no_access', manage_wfh_quotas: 'no_access', manage_leave_credits: 'no_access' },
      announcements:       { view_announcements: 'view_only', react_announcements: 'can_upload', post_announcement: 'no_access', manage_announcements: 'no_access' },
      policies:            { view_policies: 'view_only', manage_policies: 'no_access' },
    },
  }

  return { render, init }
})()
