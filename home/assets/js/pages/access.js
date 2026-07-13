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

  // Departments are loaded dynamically from the `departments` table in init().
  // Each entry: { key (slug), label (name), id, slug, name, system_key }
  let _departments = []

  function _deptByKey(key) {
    return _departments.find(d => d.key === key) || { key, label: key, slug: key }
  }

  // Order is determined by the `order` field in each page file's registration.
  const MODULE_ORDER = ModuleRegistry.getAll().map(m => m.key)

  /* ── State ───────────────────────────────────────────────── */
  let _selectedDept  = null
  // _state: { [module]: { [feature]: access_level_key } }
  let _state         = {}
  let _expandedMods  = new Set(MODULE_ORDER)  // all expanded by default
  let _saving        = false
  let _currentUser   = null

  // Portal Access tab (super_admin only) — independent of the matrix above.
  let _activeTab      = 'departments'   // 'departments' | 'portal'
  let _portalLoaded   = false
  let _paEmployees    = []              // active employees: {id, name, email, role}
  let _paGrants       = {}              // { employee_id: Set(portal_id) }
  let _paSearch       = ''
  let _paPortal       = null            // selected portal chip id
  let _paBusy         = new Set()       // "employeeId:portalId" keys mid-save

  /* ── render ──────────────────────────────────────────────── */
  function render(user) {
    _currentUser = user
    const isSuperAdmin = user.role === 'super_admin'

    return `
      <div class="page-inner">
        ${isSuperAdmin ? `
          <div class="tabs" id="access-top-tabs" style="margin-bottom:16px;">
            <button class="tab-btn tab-btn--active" data-tab="departments">Department Access</button>
            <button class="tab-btn" data-tab="portal">Portal Access</button>
          </div>
        ` : ''}

        <div id="tab-panel-departments">
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
                  <p class="loading-text" style="padding:12px;">Loading…</p>
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
        </div>

        <div id="tab-panel-portal" style="display:none;">
          <p class="page-loading">Loading…</p>
        </div>
      </div>
    `
  }

  /* ── init ────────────────────────────────────────────────── */
  async function init(user) {
    _currentUser   = user
    _selectedDept  = null
    _state         = {}
    _expandedMods  = new Set(MODULE_ORDER)
    _saving        = false
    _activeTab     = 'departments'
    _portalLoaded  = false
    _paPortal      = null
    _paSearch      = ''

    document.querySelectorAll('#access-top-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => _switchTab(btn.dataset.tab))
    })

    await _loadDepartments()
  }

  /* ── Top-level tab switch ───────────────────────────────── */
  function _switchTab(tab) {
    if (tab === _activeTab) return
    _activeTab = tab

    document.querySelectorAll('#access-top-tabs .tab-btn').forEach(btn => {
      btn.classList.toggle('tab-btn--active', btn.dataset.tab === tab)
    })
    document.getElementById('tab-panel-departments').style.display = tab === 'departments' ? '' : 'none'
    document.getElementById('tab-panel-portal').style.display      = tab === 'portal'      ? '' : 'none'

    if (tab === 'portal' && !_portalLoaded) _loadPortalAccessTab()
  }

  /* ── Load departments from the table & render the sidebar ──── */
  async function _loadDepartments(preferSlug) {
    const nav = document.getElementById('access-dept-list')

    const { data, error } = await API.getDepartments()
    if (error || !data || !data.length) {
      if (nav) nav.innerHTML = '<p class="empty-state" style="padding:12px;">No departments found.</p>'
      return
    }

    // Normalise: slug is the matrix key, name is the display label.
    _departments = data.map(d => ({
      key: d.slug, label: d.name,
      id: d.id, slug: d.slug, name: d.name, system_key: d.system_key,
    }))

    // Select the preferred department if given & present, else the first.
    _selectedDept = (preferSlug && _departments.some(d => d.key === preferSlug))
      ? preferSlug
      : _departments[0].key

    _renderDeptList()
    await _loadDept(_selectedDept)
  }

  function _canManageDepts() {
    return _currentUser && (
      _currentUser.role === 'super_admin' ||
      Utils.getDeptSystemKey(_currentUser.department) === 'people_culture'
    )
  }

  // Frontend slug generator — MUST mirror the SQL slugify() exactly.
  function _slugify(name) {
    return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  }

  const _PENCIL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>'

  function _renderDeptList() {
    const nav = document.getElementById('access-dept-list')
    if (!nav) return
    const canManage = _canManageDepts()

    nav.innerHTML = _departments.map(d => `
      <div class="access-dept-row">
        <button class="access-dept-item${d.key === _selectedDept ? ' access-dept-item--active' : ''}"
          data-dept="${Utils.escapeHtml(d.key)}">
          <span class="access-dept-name">${Utils.escapeHtml(d.label)}</span>
          <span class="access-dept-slug">${Utils.escapeHtml(d.slug)}</span>
        </button>
        ${canManage ? `
          <button class="access-dept-edit" data-edit="${Utils.escapeHtml(d.id)}" title="Edit department" aria-label="Edit ${Utils.escapeHtml(d.label)}">
            ${_PENCIL_SVG}
          </button>
        ` : ''}
      </div>
    `).join('') + (canManage ? `
      <button class="access-dept-add" id="access-dept-add-btn">
        <span style="font-size:15px;line-height:1;">+</span> Add Department
      </button>
    ` : '')

    nav.querySelectorAll('.access-dept-item').forEach(item => {
      item.addEventListener('click', () => {
        const dept = item.dataset.dept
        if (dept === _selectedDept) return
        nav.querySelectorAll('.access-dept-item').forEach(i =>
          i.classList.remove('access-dept-item--active')
        )
        item.classList.add('access-dept-item--active')
        _loadDept(dept)
      })
    })

    nav.querySelectorAll('.access-dept-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const dept = _departments.find(d => d.id === btn.dataset.edit)
        if (dept) _openDeptModal(dept)
      })
    })

    const addBtn = document.getElementById('access-dept-add-btn')
    if (addBtn) addBtn.addEventListener('click', () => _openDeptModal(null))
  }

  /* ── Add / Edit department modal ─────────────────────────── */
  function _openDeptModal(dept) {
    const isEdit = !!dept
    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">${isEdit ? 'Edit Department' : 'Add Department'}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body" style="padding:20px 24px;display:flex;flex-direction:column;gap:16px;">
        <div id="dept-modal-error" class="alert alert-danger" style="display:none;"></div>

        <div>
          <label class="form-label" for="dept-name-input">Department Name</label>
          <input type="text" class="form-input" id="dept-name-input"
            placeholder="e.g. Client Success"
            value="${isEdit ? Utils.escapeHtml(dept.name) : ''}" autocomplete="off">
        </div>

        <div>
          <label class="form-label">Slug <span style="font-weight:400;color:var(--text-muted);">(auto-generated)</span></label>
          <div class="dept-slug-preview" id="dept-slug-preview">—</div>
          <p class="form-hint" id="dept-slug-hint" style="margin-top:6px;">
            Used internally. Generated automatically from the name.
          </p>
        </div>

        ${isEdit ? `
          <p class="form-hint" style="color:var(--text-muted);">
            Renaming updates this department everywhere automatically — employees,
            access control, and reports all stay in sync.
          </p>
        ` : `
          <p class="form-hint" style="color:var(--text-muted);">
            New departments start with <strong>No Access</strong> for every feature.
            You can grant access right after creating it.
          </p>
        `}
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="dept-save-btn">${isEdit ? 'Save Changes' : 'Create Department'}</button>
      </div>
    `, 'dept-modal')

    const nameInput = document.getElementById('dept-name-input')
    const preview   = document.getElementById('dept-slug-preview')
    const hint      = document.getElementById('dept-slug-hint')
    const saveBtn   = document.getElementById('dept-save-btn')
    const errEl     = document.getElementById('dept-modal-error')

    function _refresh() {
      const slug = _slugify(nameInput.value)
      preview.textContent = slug || '—'

      // Live duplicate check against other departments.
      const clash = slug && _departments.some(d =>
        d.slug === slug && (!isEdit || d.id !== dept.id)
      )
      if (clash) {
        hint.textContent = 'A department with this name already exists.'
        hint.style.color = 'var(--danger, #DC2626)'
        saveBtn.disabled = true
      } else {
        hint.textContent = 'Used internally. Generated automatically from the name.'
        hint.style.color = 'var(--text-muted)'
        saveBtn.disabled = !slug
      }
    }

    nameInput.addEventListener('input', _refresh)
    _refresh()
    setTimeout(() => nameInput.focus(), 50)

    saveBtn.addEventListener('click', () => _submitDept(dept, nameInput.value, saveBtn, errEl))
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !saveBtn.disabled) _submitDept(dept, nameInput.value, saveBtn, errEl)
    })
  }

  async function _submitDept(dept, name, saveBtn, errEl) {
    const isEdit = !!dept
    const trimmed = (name || '').trim()
    if (!trimmed) return

    saveBtn.disabled = true
    saveBtn.textContent = isEdit ? 'Saving…' : 'Creating…'
    errEl.style.display = 'none'

    const { data, error } = isEdit
      ? await API.renameDepartmentRpc(dept.id, trimmed)
      : await API.createDepartmentRpc(trimmed)

    if (error) {
      errEl.textContent = error.message || 'Something went wrong.'
      errEl.style.display = 'block'
      saveBtn.disabled = false
      saveBtn.textContent = isEdit ? 'Save Changes' : 'Create Department'
      return
    }

    // Refresh the app-wide label cache so renames reflect immediately.
    try {
      const { data: all } = await API.getDepartments()
      if (all) Utils.setDeptCache(all)
    } catch (_) {}

    Utils.closeModal()
    Utils.showToast(
      isEdit ? `Department renamed to “${data.name}”.` : `Department “${data.name}” created.`,
      'success'
    )

    // Reload the sidebar and land on the affected department.
    await _loadDepartments(data.slug)
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
    const deptInfo = _deptByKey(_selectedDept)
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
      const deptLabel = _deptByKey(_selectedDept).label
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

  /* ════════════════════════════════════════════════════════════
     PORTAL ACCESS (Super Admin only)
     Per-employee grants controlling which departmental portals
     (Growthic HRMS, and future ones) a user can open. Independent
     of the department/module matrix above — reads from / writes
     to the portal_access table.
  ════════════════════════════════════════════════════════════ */
  function _portals() {
    // Every authenticated user already gets growthic-one — nothing to grant there.
    return PlatformConfig.getAll().filter(p => p.id !== 'growthic-one')
  }

  async function _loadPortalAccessTab() {
    const panel = document.getElementById('tab-panel-portal')
    if (panel) panel.innerHTML = '<p class="page-loading">Loading…</p>'

    const [{ data: emps }, { data: grants }] = await Promise.all([
      Config.supabase.from('employees').select('id, name, email, role').eq('status', 'active').order('name'),
      Config.supabase.from('portal_access').select('employee_id, portal_id'),
    ])

    _paEmployees = emps || []
    _paGrants    = {}
    ;(grants || []).forEach(g => {
      if (!_paGrants[g.employee_id]) _paGrants[g.employee_id] = new Set()
      _paGrants[g.employee_id].add(g.portal_id)
    })

    _portalLoaded = true
    if (!_paPortal) _paPortal = _portals()[0]?.id || null
    _renderPortalAccessTab()
  }

  function _renderPortalAccessTab() {
    const panel = document.getElementById('tab-panel-portal')
    if (!panel) return

    const portals = _portals()
    if (!portals.length) {
      panel.innerHTML = `<div class="section-card"><div class="section-card-body"><p class="empty-state" style="padding:24px;">No portals configured.</p></div></div>`
      return
    }

    const activePortal = portals.find(p => p.id === _paPortal) || portals[0]

    const chipsHtml = portals.map(p => `
      <button class="pa-chip${p.id === _paPortal ? ' pa-chip--active' : ''}" data-portal="${p.id}">
        ${Utils.escapeHtml(p.name)}
      </button>`
    ).join('')

    panel.innerHTML = `
      <div class="section-card">
        <div class="section-card-header">
          <div>
            <h3 style="margin:0;">Portal Access</h3>
            <p style="margin:4px 0 0;font-size:12px;color:var(--text-muted);">
              Control who can open each portal — independent of department-based module access.
            </p>
          </div>
        </div>
        <div class="section-card-body">
          <div class="pa-chips">${chipsHtml}</div>
          <div class="pa-search-wrap">
            <input class="form-input" id="pa-search" type="search"
              placeholder="Search by name or email…"
              value="${Utils.escapeHtml(_paSearch)}" autocomplete="off">
          </div>
          <div id="pa-results"></div>
        </div>
      </div>
    `

    _renderPortalResults(activePortal)

    panel.querySelectorAll('.pa-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.portal === _paPortal) return
        _paPortal = btn.dataset.portal
        _paSearch = ''
        _renderPortalAccessTab()
      })
    })

    document.getElementById('pa-search')?.addEventListener('input', e => {
      _paSearch = e.target.value
      _renderPortalResults(activePortal)
    })

    document.getElementById('pa-search')?.focus()
  }

  function _renderPortalResults(portal) {
    const container = document.getElementById('pa-results')
    if (!container) return

    const q = _paSearch.trim().toLowerCase()

    let html
    if (!q) {
      const granted = _paEmployees.filter(e =>
        e.role !== 'super_admin' && (_paGrants[e.id]?.has(_paPortal) ?? false)
      )
      if (!granted.length) {
        html = `
          <div class="pa-prompt">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M12 8v4m0 4h.01"/></svg>
            <p>No one has been granted <strong>${Utils.escapeHtml(portal.name)}</strong> access yet.<br>Search above to add someone.</p>
          </div>`
      } else {
        html = `
          <div class="pa-section-label">Has Access (${granted.length})</div>
          ${granted.map(e => _paRowHtml(e)).join('')}`
      }
    } else {
      const emps = _paEmployees.filter(e =>
        e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q)
      )
      if (!emps.length) {
        html = `<p class="empty-state" style="padding:24px 0;">No employees found for "<strong>${Utils.escapeHtml(q)}</strong>"</p>`
      } else {
        html = emps.map(e => _paRowHtml(e)).join('')
      }
    }

    container.innerHTML = html

    container.querySelectorAll('.pa-toggle').forEach(input => {
      input.addEventListener('change', () =>
        _togglePortalAccess(input.dataset.emp, input.dataset.portal, input.checked)
      )
    })
  }

  function _paRowHtml(e) {
    const isSuperAdmin = e.role === 'super_admin'
    const hasAccess    = isSuperAdmin || (_paGrants[e.id]?.has(_paPortal) ?? false)
    const busy         = _paBusy.has(`${e.id}:${_paPortal}`)
    return `
      <div class="pa-row">
        <div class="pa-row-info">
          <div class="pa-row-name">${Utils.escapeHtml(e.name)}</div>
          <div class="pa-row-email">${Utils.escapeHtml(e.email)}</div>
        </div>
        ${isSuperAdmin
          ? `<span class="badge badge--muted" style="font-size:11px;" title="Super Admin always has access">Always</span>`
          : `<label class="toggle">
              <input type="checkbox" class="pa-toggle"
                data-emp="${e.id}" data-portal="${_paPortal}"
                ${hasAccess ? 'checked' : ''} ${busy ? 'disabled' : ''}>
              <span class="toggle-slider"></span>
            </label>`
        }
      </div>`
  }

  async function _togglePortalAccess(employeeId, portalId, grant) {
    const key = `${employeeId}:${portalId}`
    if (_paBusy.has(key)) return
    _paBusy.add(key)

    const emp    = _paEmployees.find(e => e.id === employeeId)
    const portal = _portals().find(p => p.id === portalId)

    const { error } = grant
      ? await Config.supabase.from('portal_access')
          .upsert(
            { employee_id: employeeId, portal_id: portalId, granted_by: _currentUser.id },
            { onConflict: 'employee_id,portal_id' }
          )
      : await Config.supabase.from('portal_access')
          .delete().eq('employee_id', employeeId).eq('portal_id', portalId)

    _paBusy.delete(key)

    if (error) {
      Utils.showToast('Failed to update access: ' + error.message, 'error')
      _renderPortalAccessTab() // revert the toggle back to its last known-good state
      return
    }

    if (!_paGrants[employeeId]) _paGrants[employeeId] = new Set()
    if (grant) _paGrants[employeeId].add(portalId)
    else       _paGrants[employeeId].delete(portalId)

    // Re-render results so granted list stays in sync (e.g. revoked person disappears)
    const portals = _portals()
    const activePortal = portals.find(p => p.id === _paPortal) || portals[0]
    _renderPortalResults(activePortal)

    Utils.showToast(
      grant
        ? `${emp?.name || 'Employee'} granted access to ${portal?.name || portalId}.`
        : `${emp?.name || 'Employee'}'s access to ${portal?.name || portalId} revoked.`,
      'success'
    )
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
      people:         { view_employees: 'can_manage',  manage_employees:        'can_manage',  invite_employee:      'can_manage',   manage_access:    'no_access'   },
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
      people:         { view_employees: 'can_manage',  manage_employees:        'can_manage',  invite_employee:      'can_manage',   manage_access:    'no_access'   },
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
      people:         { view_employees: 'can_manage',  manage_employees:        'can_manage',  invite_employee:      'can_manage',   manage_access:    'can_manage'  },
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
      people:         { view_employees: 'no_access',   manage_employees:        'no_access',   invite_employee:      'no_access',   manage_access:    'no_access'   },
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
      people:         { view_employees: 'no_access',   manage_employees:        'no_access',   invite_employee:      'no_access',   manage_access:    'no_access'   },
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
      people:         { view_employees: 'no_access',   manage_employees:        'no_access',   invite_employee:      'no_access',   manage_access:    'no_access'   },
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
      people:         { view_employees: 'no_access',   manage_employees:        'no_access',   invite_employee:      'no_access',   manage_access:    'no_access'   },
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
      people:         { view_employees: 'no_access',   manage_employees:        'no_access',   invite_employee:      'no_access',   manage_access:    'no_access'   },
      leave_tracker:       { view_leaves: 'view_only', apply_leave: 'can_upload', apply_wfh: 'can_upload', approve_leave: 'no_access', manage_leave_settings: 'no_access', manage_wfh_quotas: 'no_access', manage_leave_credits: 'no_access' },
      announcements:       { view_announcements: 'view_only', react_announcements: 'can_upload', post_announcement: 'no_access', manage_announcements: 'no_access' },
      policies:            { view_policies: 'view_only', manage_policies: 'no_access' },
    },
  }

  return { render, init }
})()
