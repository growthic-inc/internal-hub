/* ============================================================
   PERMISSIONS CONTROL PANEL — Super Admin only
   Department → module permission matrix with toggle switches.
   Reads from / writes to department_permissions table.
   ============================================================ */

const Permissions = (() => {

  /* ── Static config ───────────────────────────────────────── */

  const DEPARTMENTS = [
    { key: 'management',           label: 'Management'           },
    { key: 'operations_growth',    label: 'Operations & Growth'  },
    { key: 'people_culture',       label: 'People & Culture'     },
    { key: 'business_development', label: 'Business Development' },
    { key: 'content_strategy',     label: 'Content Strategy'     },
    { key: 'creative',             label: 'Creative'             },
    { key: 'creators',             label: 'Creators'             },
    { key: 'finance',              label: 'Finance'              },
  ]

  const PERMISSIONS = [
    { key: 'can_view',    label: 'View'    },
    { key: 'can_create',  label: 'Create'  },
    { key: 'can_edit',    label: 'Edit'    },
    { key: 'can_approve', label: 'Approve' },
  ]

  // Feather-style SVG icons per module key
  const MOD_ICON = {
    client_dashboard:    `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
    client_directory:    `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`,
    client_repository:   `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    timesheet:           `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    reimbursements:      `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`,
    asset_management:    `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`,
    tools_subscriptions: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
  }

  // Human-readable labels for module keys (used for rendering rows fetched from DB)
  const MOD_LABEL = {
    client_dashboard:    'Client Dashboard',
    client_directory:    'Client Directory',
    client_repository:   'Client Repository',
    timesheet:           'Timesheet',
    reimbursements:      'Reimbursements',
    asset_management:    'Asset Management',
    tools_subscriptions: 'Tools & Subscriptions',
  }

  // Default permission matrix — used by "Reset to Default"
  // Create = "can create/submit records in this module"
  // Edit   = "can modify/delete existing records (Client Repository: rename/delete/manage files)"
  // Approve = "can approve others' submissions"
  // Tools Create = "can request tool access" (everyone who can view can request)
  const DEFAULT_PERMISSIONS = {
    management: {
      client_dashboard:    { can_view: true,  can_create: false, can_edit: false, can_approve: false },
      client_directory:    { can_view: true,  can_create: true,  can_edit: true,  can_approve: true  },
      client_repository:   { can_view: true,  can_create: true,  can_edit: true,  can_approve: true  },
      timesheet:           { can_view: true,  can_create: true,  can_edit: true,  can_approve: true  },
      reimbursements:      { can_view: true,  can_create: true,  can_edit: true,  can_approve: true  },
      asset_management:    { can_view: true,  can_create: true,  can_edit: true,  can_approve: true  },
      tools_subscriptions: { can_view: true,  can_create: true,  can_edit: true,  can_approve: true  },
    },
    operations_growth: {
      client_dashboard:    { can_view: true,  can_create: false, can_edit: false, can_approve: false },
      client_directory:    { can_view: true,  can_create: true,  can_edit: true,  can_approve: true  },
      client_repository:   { can_view: true,  can_create: true,  can_edit: true,  can_approve: true  },
      timesheet:           { can_view: true,  can_create: true,  can_edit: true,  can_approve: true  },
      reimbursements:      { can_view: true,  can_create: true,  can_edit: true,  can_approve: true  },
      asset_management:    { can_view: true,  can_create: true,  can_edit: true,  can_approve: true  },
      tools_subscriptions: { can_view: true,  can_create: true,  can_edit: true,  can_approve: true  },
    },
    people_culture: {
      client_dashboard:    { can_view: true,  can_create: false, can_edit: false, can_approve: false },
      client_directory:    { can_view: true,  can_create: false, can_edit: false, can_approve: false },
      client_repository:   { can_view: true,  can_create: false, can_edit: false, can_approve: false },
      timesheet:           { can_view: true,  can_create: true,  can_edit: true,  can_approve: true  },
      reimbursements:      { can_view: true,  can_create: true,  can_edit: true,  can_approve: true  },
      asset_management:    { can_view: true,  can_create: true,  can_edit: true,  can_approve: true  },
      tools_subscriptions: { can_view: true,  can_create: true,  can_edit: true,  can_approve: true  },
    },
    business_development: {
      client_dashboard:    { can_view: true,  can_create: false, can_edit: false, can_approve: false },
      client_directory:    { can_view: true,  can_create: true,  can_edit: true,  can_approve: false },
      client_repository:   { can_view: true,  can_create: false, can_edit: false, can_approve: false },
      timesheet:           { can_view: true,  can_create: true,  can_edit: true,  can_approve: false },
      reimbursements:      { can_view: true,  can_create: true,  can_edit: true,  can_approve: false },
      asset_management:    { can_view: true,  can_create: false, can_edit: false, can_approve: false },
      tools_subscriptions: { can_view: true,  can_create: true,  can_edit: false, can_approve: false },
    },
    content_strategy: {
      client_dashboard:    { can_view: true,  can_create: false, can_edit: false, can_approve: false },
      client_directory:    { can_view: true,  can_create: false, can_edit: false, can_approve: false },
      client_repository:   { can_view: true,  can_create: true,  can_edit: false, can_approve: false },
      timesheet:           { can_view: true,  can_create: true,  can_edit: true,  can_approve: true  },
      reimbursements:      { can_view: true,  can_create: true,  can_edit: true,  can_approve: false },
      asset_management:    { can_view: true,  can_create: false, can_edit: false, can_approve: false },
      tools_subscriptions: { can_view: true,  can_create: true,  can_edit: false, can_approve: false },
    },
    creative: {
      client_dashboard:    { can_view: true,  can_create: false, can_edit: false, can_approve: false },
      client_directory:    { can_view: true,  can_create: false, can_edit: false, can_approve: false },
      client_repository:   { can_view: true,  can_create: true,  can_edit: false, can_approve: false },
      timesheet:           { can_view: true,  can_create: true,  can_edit: true,  can_approve: true  },
      reimbursements:      { can_view: true,  can_create: true,  can_edit: true,  can_approve: false },
      asset_management:    { can_view: true,  can_create: false, can_edit: false, can_approve: false },
      tools_subscriptions: { can_view: true,  can_create: true,  can_edit: false, can_approve: false },
    },
    creators: {
      client_dashboard:    { can_view: false, can_create: false, can_edit: false, can_approve: false },
      client_directory:    { can_view: false, can_create: false, can_edit: false, can_approve: false },
      client_repository:   { can_view: true,  can_create: true,  can_edit: false, can_approve: false },
      timesheet:           { can_view: true,  can_create: true,  can_edit: true,  can_approve: false },
      reimbursements:      { can_view: true,  can_create: true,  can_edit: true,  can_approve: false },
      asset_management:    { can_view: true,  can_create: false, can_edit: false, can_approve: false },
      tools_subscriptions: { can_view: true,  can_create: true,  can_edit: false, can_approve: false },
    },
    finance: {
      client_dashboard:    { can_view: true,  can_create: false, can_edit: false, can_approve: false },
      client_directory:    { can_view: true,  can_create: false, can_edit: false, can_approve: false },
      client_repository:   { can_view: true,  can_create: false, can_edit: false, can_approve: false },
      timesheet:           { can_view: true,  can_create: true,  can_edit: true,  can_approve: false },
      reimbursements:      { can_view: true,  can_create: true,  can_edit: true,  can_approve: true  },
      asset_management:    { can_view: true,  can_create: false, can_edit: false, can_approve: false },
      tools_subscriptions: { can_view: true,  can_create: true,  can_edit: true,  can_approve: true  },
    },
  }

  /* ── State ───────────────────────────────────────────────── */
  let _selectedDept = 'management'
  let _state        = {}    // { [moduleKey]: { can_view, can_create, can_edit, can_approve } }
  let _moduleKeys   = []    // ordered list of module keys as returned from DB
  let _saving       = false

  /* ── render ──────────────────────────────────────────────── */
  function render(user) {
    return `
      <div class="perms-layout">

        <!-- Left: department list -->
        <aside class="perms-sidebar">
          <div class="perms-sidebar-header">
            <div class="perms-sidebar-title-row">
              <span class="perms-sidebar-title">Permissions</span>
              <span class="perms-super-badge">Super Admin Only</span>
            </div>
            <p class="perms-sidebar-sub">Control access across departments</p>
          </div>

          <div class="perms-dept-section">
            <div class="perms-dept-label">DEPARTMENTS</div>
            <nav class="perms-dept-list" id="perms-dept-list">
              ${DEPARTMENTS.map(d => `
                <button class="perms-dept-item${d.key === 'management' ? ' perms-dept-item--active' : ''}"
                  data-dept="${d.key}">
                  ${d.label}
                </button>
              `).join('')}
            </nav>
          </div>
        </aside>

        <!-- Right: permission matrix -->
        <div class="perms-right">
          <div class="perms-right-body" id="perms-right-body">
            <p class="loading-text">Loading…</p>
          </div>
          <div class="perms-right-footer" id="perms-right-footer" style="display:none;">
            <p class="perms-footer-hint">
              Permissions apply at department level.
              Some actions may be limited to a user's own data.
            </p>
            <div style="display:flex;gap:10px;flex-shrink:0;">
              <button class="btn btn--secondary" id="perms-reset-btn">Reset to Default</button>
              <button class="btn btn--primary"   id="perms-save-btn">Save Changes</button>
            </div>
          </div>
        </div>

      </div>
    `
  }

  /* ── init ────────────────────────────────────────────────── */
  async function init(user) {
    _selectedDept = 'management'
    _state        = {}
    _moduleKeys   = []
    _saving       = false

    // Bind department list clicks
    document.querySelectorAll('.perms-dept-item').forEach(item => {
      item.addEventListener('click', () => {
        const dept = item.dataset.dept
        if (dept === _selectedDept) return
        document.querySelectorAll('.perms-dept-item').forEach(i =>
          i.classList.remove('perms-dept-item--active')
        )
        item.classList.add('perms-dept-item--active')
        _loadDept(dept)
      })
    })

    await _loadDept('management')
  }

  /* ── Load department permissions from DB ─────────────────── */
  async function _loadDept(dept) {
    _selectedDept = dept

    const rightBody = document.getElementById('perms-right-body')
    if (rightBody) rightBody.innerHTML = '<p class="loading-text">Loading…</p>'

    const { data, error } = await API.getDepartmentPermissions(dept)

    if (error) {
      if (rightBody) rightBody.innerHTML = '<p class="empty-state">Failed to load permissions.</p>'
      Utils.showToast('Failed to load permissions.', 'error')
      return
    }

    // Capture ordered module keys from DB response
    _moduleKeys = (data || []).map(row => row.module)

    // Build local state from DB rows
    _state = {}
    ;(data || []).forEach(row => {
      _state[row.module] = {
        can_view:    row.can_view    ?? false,
        can_create:  row.can_create  ?? false,
        can_edit:    row.can_edit    ?? false,
        can_approve: row.can_approve ?? false,
      }
    })

    _renderRightPanel()
  }

  /* ── Render the permission matrix panel ──────────────────── */
  function _renderRightPanel() {
    const deptInfo  = DEPARTMENTS.find(d => d.key === _selectedDept) || { label: _selectedDept }
    const rightBody = document.getElementById('perms-right-body')
    const footer    = document.getElementById('perms-right-footer')
    if (!rightBody) return

    if (_moduleKeys.length === 0) {
      rightBody.innerHTML = `
        <div class="perms-right-header">
          <h2 class="perms-dept-title">${deptInfo.label}</h2>
          <p class="perms-dept-subtitle">Manage access for this department</p>
        </div>
        <p class="empty-state">No permission modules found for this department.</p>
      `
      if (footer) footer.style.display = 'none'
      return
    }

    rightBody.innerHTML = `
      <div class="perms-right-header">
        <h2 class="perms-dept-title">${deptInfo.label}</h2>
        <p class="perms-dept-subtitle">Manage access for this department</p>
      </div>

      <div class="section-card">
        <div class="section-card-header"><h3>Permissions</h3></div>
        <div class="section-card-body" style="padding:0;">
          <table class="perms-table">
            <thead>
              <tr>
                <th>Module</th>
                ${PERMISSIONS.map(p => `<th>${p.label}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${_moduleKeys.map(moduleKey => {
                const perms = _state[moduleKey] || {}
                const label = MOD_LABEL[moduleKey] || moduleKey
                const icon  = MOD_ICON[moduleKey]  || ''
                return `
                  <tr class="perms-module-row">
                    <td class="perms-module-name">
                      <span class="perms-mod-icon">${icon}</span>
                      ${label}
                    </td>
                    ${PERMISSIONS.map(p => `
                      <td class="perms-toggle-cell">
                        <label class="toggle">
                          <input type="checkbox"
                            data-module="${moduleKey}"
                            data-perm="${p.key}"
                            ${perms[p.key] ? 'checked' : ''}
                          />
                          <span class="toggle-slider"></span>
                        </label>
                      </td>
                    `).join('')}
                  </tr>
                `
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `

    // Bind toggles → update local state + enforce View dependency
    rightBody.querySelectorAll('input[data-module]').forEach(input => {
      input.addEventListener('change', () => {
        const mod  = input.dataset.module
        const perm = input.dataset.perm
        if (!_state[mod]) _state[mod] = {}

        _state[mod][perm] = input.checked

        // Validation: Create/Edit/Approve ON → View must be ON
        if (input.checked && perm !== 'can_view') {
          if (!_state[mod].can_view) {
            _state[mod].can_view = true
            const viewInput = rightBody.querySelector(
              `input[data-module="${mod}"][data-perm="can_view"]`
            )
            if (viewInput) viewInput.checked = true
          }
        }

        // Validation: View OFF → Create/Edit/Approve must all be OFF
        if (!input.checked && perm === 'can_view') {
          ;['can_create', 'can_edit', 'can_approve'].forEach(dep => {
            _state[mod][dep] = false
            const depInput = rightBody.querySelector(
              `input[data-module="${mod}"][data-perm="${dep}"]`
            )
            if (depInput) depInput.checked = false
          })
        }
      })
    })

    // Show footer + wire buttons
    if (footer) {
      footer.style.display = 'flex'
      const saveBtn  = document.getElementById('perms-save-btn')
      const resetBtn = document.getElementById('perms-reset-btn')
      if (saveBtn)  saveBtn.onclick  = _saveChanges
      if (resetBtn) resetBtn.onclick = _resetToDefault
    }
  }

  /* ── Save changes to Supabase ────────────────────────────── */
  async function _saveChanges() {
    if (_saving) return

    // Pre-save validation: ensure View is ON wherever Create/Edit/Approve is ON
    let validationFailed = false
    _moduleKeys.forEach(moduleKey => {
      const perms = _state[moduleKey] || {}
      if ((perms.can_create || perms.can_edit || perms.can_approve) && !perms.can_view) {
        validationFailed = true
        const label = MOD_LABEL[moduleKey] || moduleKey
        Utils.showToast(`"${label}": View must be ON if Create, Edit, or Approve is ON.`, 'error')
      }
    })
    if (validationFailed) return

    _saving = true
    const saveBtn = document.getElementById('perms-save-btn')
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…' }

    // Build rows dynamically from DB-sourced module keys
    const rows = _moduleKeys.map(moduleKey => ({
      department:  _selectedDept,
      module:      moduleKey,
      can_view:    !!(_state[moduleKey]?.can_view),
      can_create:  !!(_state[moduleKey]?.can_create),
      can_edit:    !!(_state[moduleKey]?.can_edit),
      can_approve: !!(_state[moduleKey]?.can_approve),
    }))

    const { error } = await API.saveDepartmentPermissions(rows)

    _saving = false
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Changes' }

    if (error) {
      Utils.showToast('Failed to save: ' + error.message, 'error')
    } else {
      const deptLabel = DEPARTMENTS.find(d => d.key === _selectedDept)?.label || _selectedDept
      Utils.showToast(`Permissions saved for ${deptLabel}.`, 'success')
    }
  }

  /* ── Reset to default (local only — not saved until Save pressed) */
  function _resetToDefault() {
    const defaults = DEFAULT_PERMISSIONS[_selectedDept]
    if (!defaults) {
      Utils.showToast('No defaults defined for this department.', 'error')
      return
    }

    // Deep-copy defaults into state (only for modules present in DB)
    _moduleKeys.forEach(moduleKey => {
      if (defaults[moduleKey]) {
        _state[moduleKey] = { ...defaults[moduleKey] }
      }
    })

    // Update DOM toggles
    const rightBody = document.getElementById('perms-right-body')
    if (rightBody) {
      rightBody.querySelectorAll('input[data-module]').forEach(input => {
        const mod  = input.dataset.module
        const perm = input.dataset.perm
        input.checked = !!(_state[mod]?.[perm])
      })
    }

    Utils.showToast('Defaults restored — click Save Changes to apply.', 'success')
  }

  return { render, init }
})()
