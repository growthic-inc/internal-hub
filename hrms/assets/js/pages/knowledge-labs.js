/* ============================================================
   KNOWLEDGE LABS — HRMS admin console
   Two tabs: Manage resources (create/edit/delete the SOP and
   Template entries browsed from /knowledgelabs) and Access
   control (per-person cross-department grants).
   ============================================================ */

const KnowledgeLabsModule = (() => {

  /* ── State ─────────────────────────────────────────────────── */
  let _user          = null
  let _activeTab      = 'resources'
  let _departments    = []
  let _employees      = []

  // Resources tab
  let _resources       = []
  let _activeDept      = null   // null = All
  let _activeCategory  = null   // null = All
  let _searchQuery     = ''
  let _editingResourceId = null

  // Access control tab
  let _grants = []
  let _selectedGrantEmployeeId = null
  let _selectedGrantResourceIds = new Set()

  // Resource form
  let _selectedOwnerId = null

  /* ── Icons ─────────────────────────────────────────────────── */
  const ICON_EXT    = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`
  const ICON_CLOSE  = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`

  // "Growthic" — company-wide, not a real departments row. A resource with
  // department_id = NULL applies to everyone. This sentinel is only ever
  // used inside <select> values to represent that choice in the UI; it
  // never gets written to the database directly (see _saveResource /
  // _saveGrant, which translate it back to null before saving).
  const GROWTHIC_DEPT_VALUE = '__growthic__'

  function _deptLabel(departmentId) {
    return departmentId ? null : 'Growthic'
  }

  const CATEGORY_BADGE_CLASS = { SOP: 'badge badge--blue', Template: 'badge badge--success', Guide: 'badge badge--warning' }
  function _catBadge(category) {
    return `<span class="${CATEGORY_BADGE_CLASS[category] || 'badge'}">${Utils.escapeHtml(category)}</span>`
  }

  /* ── render ────────────────────────────────────────────────── */
  function render(user) {
    _user = user

    return `
      <div class="page-inner">
        <div class="page-toolbar">
          <div class="tabs" id="kl-tabs">
            <button class="tab-btn tab-btn--active" data-tab="resources">Manage Resources</button>
            <button class="tab-btn" data-tab="access">Access Control</button>
          </div>
          <div id="kl-toolbar-actions"></div>
        </div>
        <div id="kl-content" class="page-loading">Loading…</div>
      </div>`
  }

  /* ── init ──────────────────────────────────────────────────── */
  async function init(user) {
    _user           = user
    _activeTab      = 'resources'
    _activeDept     = null
    _activeCategory = null
    _searchQuery    = ''

    const [deptResult, empResult, resResult] = await Promise.all([
      API.getDepartments(),
      API.getEmployees(),
      API.getKnowledgeResources(),
    ])
    if (deptResult.error) { Utils.showToast('Failed to load departments', 'error'); return }
    if (empResult.error)  { Utils.showToast('Failed to load employees', 'error'); return }
    if (resResult.error)  { Utils.showToast('Failed to load resources', 'error'); return }
    _departments = deptResult.data || []
    _employees   = empResult.data || []
    _resources   = resResult.data || []

    _bindTabs()
    await _loadTab('resources')
  }

  /* ── Tab switching ─────────────────────────────────────────── */
  function _bindTabs() {
    document.querySelectorAll('#kl-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#kl-tabs .tab-btn').forEach(b => b.classList.remove('tab-btn--active'))
        btn.classList.add('tab-btn--active')
        _loadTab(btn.dataset.tab)
      })
    })
  }

  async function _loadTab(tab) {
    _activeTab = tab
    const content = document.getElementById('kl-content')
    const actions = document.getElementById('kl-toolbar-actions')
    if (content) content.className = 'page-loading'
    if (actions) actions.innerHTML = ''

    if (tab === 'resources') {
      if (actions) actions.innerHTML = `<button class="btn btn-primary btn-sm" id="kl-new-btn">+ Add Resource</button>`
      document.getElementById('kl-new-btn')?.addEventListener('click', () => _openResourceModal(null))
      await _loadResources()
    } else {
      await _loadGrants()
    }
  }

  /* ── Resources: Data ───────────────────────────────────────── */
  async function _loadResources() {
    const resResult = await API.getKnowledgeResources()
    if (resResult.error) { Utils.showToast('Failed to load resources', 'error'); return }
    _resources = resResult.data || []
    _renderResourcesLayout()
  }

  /* ── Resources: Layout ────────────────────────────────────── */
  function _renderResourcesLayout() {
    const el = document.getElementById('kl-content')
    if (!el) return

    el.className = ''
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:nowrap;">
        <div class="search-wrap" style="flex:1 1 auto;min-width:0;">
          <span class="search-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </span>
          <input class="form-input" id="kl-search" type="search" placeholder="Search resources…" value="${Utils.escapeHtml(_searchQuery)}">
        </div>
        <select class="form-select" id="kl-filter-dept" style="flex:0 0 180px;">
          <option value="">All departments</option>
          <option value="${GROWTHIC_DEPT_VALUE}" ${_activeDept === GROWTHIC_DEPT_VALUE ? 'selected' : ''}>Growthic</option>
          ${_departments.map(d => `<option value="${d.id}" ${_activeDept === d.id ? 'selected' : ''}>${Utils.escapeHtml(d.name)}</option>`).join('')}
        </select>
        <select class="form-select" id="kl-filter-cat" style="flex:0 0 150px;">
          <option value="">All categories</option>
          <option value="SOP" ${_activeCategory === 'SOP' ? 'selected' : ''}>SOP</option>
          <option value="Template" ${_activeCategory === 'Template' ? 'selected' : ''}>Template</option>
          <option value="Guide" ${_activeCategory === 'Guide' ? 'selected' : ''}>Guide</option>
        </select>
      </div>
      <div class="table-wrap">
        <table class="data-table" id="kl-table">
          <thead>
            <tr>
              <th>Department</th><th>Title</th><th>Category</th><th>Owner</th><th>Updated</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody id="kl-rows">${_rowsHTML()}</tbody>
        </table>
      </div>`

    _bindLayoutEvents()
  }

  function _filteredResources() {
    const q = _searchQuery.toLowerCase()
    return _resources.filter(r => {
      if (_activeDept === GROWTHIC_DEPT_VALUE) {
        if (r.department_id) return false
      } else if (_activeDept && r.department_id !== _activeDept) {
        return false
      }
      if (_activeCategory && r.category !== _activeCategory) return false
      if (q && !r.title.toLowerCase().includes(q)) return false
      return true
    })
  }

  function _rowsHTML() {
    const list = _filteredResources()
    if (!list.length) {
      return `<tr><td colspan="7"><div class="empty-state"><h3>No resources found</h3><p>Try a different filter or search term.</p></div></td></tr>`
    }
    return list.map(_rowHTML).join('')
  }

  function _rowHTML(r) {
    return `
      <tr>
        <td>${Utils.escapeHtml(_deptLabel(r.department_id) || r.department?.name || '—')}</td>
        <td>
          <div style="font-weight:500;">${Utils.escapeHtml(r.title)}</div>
          ${r.description ? `<div style="font-size:12px;color:var(--text-muted);">${Utils.escapeHtml(r.description)}</div>` : ''}
        </td>
        <td>${_catBadge(r.category)}</td>
        <td>${Utils.escapeHtml(r.owner?.name || '—')}</td>
        <td style="font-size:13px;color:var(--text-muted);">${Utils.formatDate(r.updated_at || r.created_at)}</td>
        <td>${r.published
          ? `<span style="font-size:12px;color:var(--success);">Published</span>`
          : `<span style="font-size:12px;color:var(--text-muted);">Draft</span>`}</td>
        <td style="white-space:nowrap;">
          <a href="${Utils.escapeHtml(r.doc_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" title="Open doc">${ICON_EXT}</a>
          <button class="btn btn-secondary btn-sm kl-edit-btn" data-id="${r.id}">Edit</button>
          <button class="btn btn-sm kl-delete-btn" style="background:var(--danger,#E53E3E);color:#fff;border-color:var(--danger,#E53E3E);" data-id="${r.id}">Delete</button>
        </td>
      </tr>`
  }

  /* ── Bind Layout Events ────────────────────────────────────── */
  function _bindLayoutEvents() {
    const searchEl = document.getElementById('kl-search')
    searchEl?.addEventListener('input', Utils.debounce(e => {
      _searchQuery = e.target.value
      _rerenderRows()
    }, 250))

    document.getElementById('kl-filter-dept')?.addEventListener('change', e => {
      _activeDept = e.target.value || null
      _rerenderRows()
    })

    document.getElementById('kl-filter-cat')?.addEventListener('change', e => {
      _activeCategory = e.target.value || null
      _rerenderRows()
    })

    _bindRowEvents()
  }

  function _bindRowEvents() {
    document.querySelectorAll('.kl-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const r = _resources.find(x => x.id === btn.dataset.id)
        if (r) _openResourceModal(r)
      })
    })
    document.querySelectorAll('.kl-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => _deleteResource(btn.dataset.id))
    })
  }

  function _rerenderRows() {
    const el = document.getElementById('kl-rows')
    if (!el) return
    el.innerHTML = _rowsHTML()
    _bindRowEvents()
  }

  /* ── Add / Edit Modal ──────────────────────────────────────── */
  function _openResourceModal(resource) {
    _editingResourceId = resource?.id || null
    const isEdit        = !!resource
    const isPublished   = isEdit ? !!resource.published : true

    const deptOptions = _departments.map(d =>
      `<option value="${d.id}" ${resource?.department_id === d.id ? 'selected' : ''}>${Utils.escapeHtml(d.name)}</option>`
    ).join('')
    const isGrowthicWide = isEdit && !resource.department_id

    _selectedOwnerId = resource?.owner_id || null

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">${isEdit ? 'Edit Resource' : 'New Resource'}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">${ICON_CLOSE}</button>
      </div>

      <div class="modal-body">
        <div id="kl-form-err" class="alert alert-danger" style="display:none;margin-bottom:16px;"></div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label class="form-label">Department <span style="color:var(--danger)">*</span></label>
            <select class="form-select" id="kl-f-dept">
              <option value="">— Select department —</option>
              <option value="${GROWTHIC_DEPT_VALUE}" ${isGrowthicWide ? 'selected' : ''}>Growthic (company-wide)</option>
              ${deptOptions}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Category <span style="color:var(--danger)">*</span></label>
            <select class="form-select" id="kl-f-cat">
              <option value="SOP" ${resource?.category === 'SOP' ? 'selected' : ''}>SOP</option>
              <option value="Template" ${resource?.category === 'Template' ? 'selected' : ''}>Template</option>
              <option value="Guide" ${resource?.category === 'Guide' ? 'selected' : ''}>Guide</option>
            </select>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Title <span style="color:var(--danger)">*</span></label>
          <input class="form-input" id="kl-f-title" type="text" placeholder="Leave request process"
                 value="${Utils.escapeHtml(resource?.title || '')}">
        </div>

        <div class="form-group">
          <label class="form-label">Description</label>
          <textarea class="form-input" id="kl-f-desc" rows="2" placeholder="One line on what this covers">${Utils.escapeHtml(resource?.description || '')}</textarea>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label class="form-label">Google Doc link <span style="color:var(--danger)">*</span></label>
            <input class="form-input" id="kl-f-url" type="text" placeholder="https://docs.google.com/…"
                   value="${Utils.escapeHtml(resource?.doc_url || '')}">
          </div>
          <div class="form-group">
            <label class="form-label">Owner</label>
            ${_pickerHTML(OWNER_PICKER_IDS, resource?.owner?.name || 'Select owner')}
          </div>
        </div>

        <div class="form-group" style="margin-bottom:0;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;">
            <input type="checkbox" id="kl-f-published" style="width:16px;height:16px;cursor:pointer;" ${isPublished ? 'checked' : ''}>
            <span style="font-size:14px;font-weight:500;">Published</span>
          </label>
          <span class="form-hint" style="padding-left:24px;">Unchecked saves as draft — not visible in Knowledge Labs yet.</span>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="kl-f-save">${isEdit ? 'Save Changes' : 'Save Resource'}</button>
      </div>
    `, '')

    document.getElementById('kl-f-save')?.addEventListener('click', _saveResource)
    _bindOwnerPicker()
  }

  /* ── Save Resource ─────────────────────────────────────────── */
  async function _saveResource() {
    const saveBtn = document.getElementById('kl-f-save')
    const errEl   = document.getElementById('kl-form-err')

    const deptId      = document.getElementById('kl-f-dept')?.value || ''
    const category    = document.getElementById('kl-f-cat')?.value || ''
    const title        = (document.getElementById('kl-f-title')?.value || '').trim()
    const description  = (document.getElementById('kl-f-desc')?.value || '').trim()
    const docUrl        = (document.getElementById('kl-f-url')?.value || '').trim()
    const ownerId        = _selectedOwnerId || null
    const published     = document.getElementById('kl-f-published')?.checked ?? false

    errEl.style.display = 'none'

    if (!deptId)   { errEl.textContent = 'Please select a department.'; errEl.style.display = 'block'; return }
    if (!title)    { errEl.textContent = 'Title is required.';          errEl.style.display = 'block'; return }
    if (!docUrl)   { errEl.textContent = 'Google Doc link is required.'; errEl.style.display = 'block'; return }

    saveBtn.disabled    = true
    saveBtn.textContent = 'Saving…'

    try {
      const record = {
        department_id: deptId === GROWTHIC_DEPT_VALUE ? null : deptId,
        category,
        title,
        description: description || null,
        doc_url:     docUrl,
        owner_id:    ownerId,
        published,
      }

      if (_editingResourceId) {
        const { error } = await API.updateKnowledgeResource(_editingResourceId, record)
        if (error) throw error
      } else {
        record.created_by = _user.id
        const { error } = await API.createKnowledgeResource(record)
        if (error) throw error
      }

      Utils.closeModal()
      Utils.showToast(_editingResourceId ? 'Resource updated' : 'Resource created', 'success')
      await _loadResources()

    } catch (err) {
      errEl.textContent   = err.message || 'Failed to save resource.'
      errEl.style.display = 'block'
    } finally {
      saveBtn.disabled    = false
      saveBtn.textContent = _editingResourceId ? 'Save Changes' : 'Save Resource'
    }
  }

  /* ── Delete Resource ───────────────────────────────────────── */
  async function _deleteResource(id) {
    if (!confirm('Delete this resource? This cannot be undone.')) return

    const { error } = await API.deleteKnowledgeResource(id)
    if (error) { Utils.showToast('Failed to delete resource', 'error'); return }

    _resources = _resources.filter(r => r.id !== id)
    _rerenderRows()
    Utils.showToast('Resource deleted', 'success')
  }

  /* ── Access control: Data ─────────────────────────────────── */
  async function _loadGrants() {
    const grantsResult = await API.getKnowledgeAccessGrants()
    if (grantsResult.error) { Utils.showToast('Failed to load grants', 'error'); return }
    _grants = grantsResult.data || []
    _renderGrantsLayout()
  }

  /* ── Access control: Layout ───────────────────────────────── */
  function _renderGrantsLayout() {
    const el = document.getElementById('kl-content')
    if (!el) return

    const deptOptions = _departments.map(d =>
      `<option value="${d.id}">${Utils.escapeHtml(d.name)}</option>`
    ).join('')

    _selectedGrantEmployeeId  = null
    _selectedGrantResourceIds = new Set()

    el.className = ''
    el.innerHTML = `
      <div class="card" style="margin-bottom:20px;">
        <p class="card-title" style="margin:0 0 4px;">Grant access</p>
        <p style="font-size:12px;color:var(--text-muted);margin:0 0 12px;">Pick a person, narrow down by department and (optionally) category, then tick every SOP/Template they need — one grant can cover several documents at once.</p>
        <div id="kl-grant-err" class="alert alert-danger" style="display:none;margin-bottom:12px;"></div>
        <div style="display:flex;align-items:end;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
          <div class="form-group" style="flex:1 1 200px;margin-bottom:0;">
            <label class="form-label">Employee</label>
            ${_pickerHTML(EMP_PICKER_IDS, 'Select employee')}
          </div>
          <div class="form-group" style="flex:1 1 160px;margin-bottom:0;">
            <label class="form-label">Department</label>
            <select class="form-select" id="kl-grant-dept">
              <option value="">— Select department —</option>
              <option value="${GROWTHIC_DEPT_VALUE}">Growthic (company-wide)</option>
              ${deptOptions}
            </select>
          </div>
          <div class="form-group" style="flex:0 0 150px;margin-bottom:0;">
            <label class="form-label">Category</label>
            <select class="form-select" id="kl-grant-cat">
              <option value="">All categories</option>
              <option value="SOP">SOP</option>
              <option value="Template">Template</option>
              <option value="Guide">Guide</option>
            </select>
          </div>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">Resources</label>
          <div id="kl-res-checklist" class="table-wrap" style="max-height:220px;overflow:auto;"></div>
        </div>
        <div style="margin-top:12px;display:flex;align-items:center;gap:10px;">
          <button class="btn btn-primary btn-sm" id="kl-grant-btn">Grant access</button>
          <span id="kl-grant-selected-count" style="font-size:12px;color:var(--text-muted);"></span>
        </div>
      </div>

      <p class="card-title" style="margin:0 0 8px;">Grants</p>
      <div class="table-wrap">
        <table class="data-table" id="kl-grants-table">
          <thead>
            <tr><th>Employee</th><th>Resource</th><th>Granted</th><th>Status</th><th></th></tr>
          </thead>
          <tbody id="kl-grant-rows">${_grantRowsHTML()}</tbody>
        </table>
      </div>`

    document.getElementById('kl-grant-btn')?.addEventListener('click', _saveGrant)
    document.getElementById('kl-grant-dept')?.addEventListener('change', _refreshResourceChecklist)
    document.getElementById('kl-grant-cat')?.addEventListener('change', _refreshResourceChecklist)
    _bindEmployeePicker()
    _refreshResourceChecklist()
    _bindGrantRowEvents()
  }

  /* ── Generic searchable picker (matches Client Repository's pattern) ──
     ids: { wrap, btn, dropdown, search, list, label }
     items: array to pick from (re-render with a new array to re-filter externally, e.g. dept/category change)
     renderItem(item) -> HTML for the row; searchText(item) -> string matched against typed query
     onSelect(item) -> called when a row is clicked ── */
  function _bindPicker(ids, items, { renderItem, searchText, emptyLabel, onSelect }) {
    const wrap     = document.getElementById(ids.wrap)
    const btn      = document.getElementById(ids.btn)
    const dropdown = document.getElementById(ids.dropdown)
    const search   = document.getElementById(ids.search)
    const list     = document.getElementById(ids.list)
    if (!wrap || !btn || !dropdown || !search || !list) return

    const _renderList = filtered => {
      list.innerHTML = filtered.length
        ? filtered.map((item, i) => `<div class="custom-select-item" data-i="${i}">${renderItem(item)}</div>`).join('')
        : `<div class="custom-select-empty">${emptyLabel || 'No results'}</div>`

      list.querySelectorAll('.custom-select-item').forEach(el => {
        el.addEventListener('click', () => {
          const item = filtered[Number(el.dataset.i)]
          dropdown.style.display = 'none'
          onSelect(item)
        })
      })
    }

    _renderList(items)

    btn.addEventListener('click', e => {
      e.stopPropagation()
      const open = dropdown.style.display !== 'none'
      dropdown.style.display = open ? 'none' : 'block'
      if (!open) { search.value = ''; _renderList(items); search.focus() }
    })

    search.addEventListener('input', () => {
      const q = search.value.toLowerCase()
      _renderList(items.filter(item => searchText(item).toLowerCase().includes(q)))
    })

    document.addEventListener('click', e => {
      if (!wrap.contains(e.target)) dropdown.style.display = 'none'
    })
  }

  function _pickerHTML(ids, placeholder) {
    return `
      <div class="custom-select-wrap" id="${ids.wrap}">
        <button type="button" class="custom-select-btn" id="${ids.btn}">
          <span id="${ids.label}">${placeholder}</span>
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </button>
        <div class="custom-select-dropdown" id="${ids.dropdown}" style="display:none;">
          <input class="custom-select-search" id="${ids.search}" placeholder="Search…" autocomplete="off" />
          <div class="custom-select-list" id="${ids.list}"></div>
        </div>
      </div>`
  }

  const EMP_PICKER_IDS = { wrap: 'kl-emp-select-wrap', btn: 'kl-emp-select-btn', dropdown: 'kl-emp-select-dropdown', search: 'kl-emp-search-input', list: 'kl-emp-select-list', label: 'kl-emp-select-label' }
  const OWNER_PICKER_IDS = { wrap: 'kl-owner-select-wrap', btn: 'kl-owner-select-btn', dropdown: 'kl-owner-select-dropdown', search: 'kl-owner-search-input', list: 'kl-owner-select-list', label: 'kl-owner-select-label' }

  function _employeeRenderItem(e) {
    return `<span>${Utils.escapeHtml(e.name)}</span><span class="text-muted text-sm">${Utils.escapeHtml(e.email)}</span>`
  }
  function _employeeSearchText(e) { return `${e.name} ${e.email}` }

  function _bindEmployeePicker() {
    _bindPicker(EMP_PICKER_IDS, _employees, {
      renderItem:  _employeeRenderItem,
      searchText:  _employeeSearchText,
      emptyLabel:  'No employees found',
      onSelect:    e => {
        _selectedGrantEmployeeId = e.id
        document.getElementById(EMP_PICKER_IDS.label).textContent = e.name
      },
    })
  }

  function _bindOwnerPicker() {
    _bindPicker(OWNER_PICKER_IDS, _employees, {
      renderItem:  _employeeRenderItem,
      searchText:  _employeeSearchText,
      emptyLabel:  'No employees found',
      onSelect:    e => {
        _selectedOwnerId = e.id
        document.getElementById(OWNER_PICKER_IDS.label).textContent = e.name
      },
    })
  }

  function _resourceChecklistItems() {
    const deptId = document.getElementById('kl-grant-dept')?.value || ''
    const cat    = document.getElementById('kl-grant-cat')?.value  || ''
    if (!deptId) return []
    return _resources.filter(r => {
      if (!r.published) return false
      const matchesDept = deptId === GROWTHIC_DEPT_VALUE ? !r.department_id : r.department_id === deptId
      if (!matchesDept) return false
      return !cat || r.category === cat
    })
  }

  function _refreshResourceChecklist() {
    _selectedGrantResourceIds = new Set()
    _updateGrantSelectedCount()

    const box    = document.getElementById('kl-res-checklist')
    if (!box) return
    const deptId = document.getElementById('kl-grant-dept')?.value || ''
    const items  = _resourceChecklistItems()

    if (!deptId) {
      box.innerHTML = `<div class="empty-state"><p>Pick a department to see its resources.</p></div>`
      return
    }
    if (!items.length) {
      box.innerHTML = `<div class="empty-state"><p>No published resources found for this filter.</p></div>`
      return
    }

    box.innerHTML = items.map((r, i) => `
      <label style="display:flex;align-items:center;gap:10px;padding:10px 14px;${i < items.length - 1 ? 'border-bottom:0.5px solid var(--border);' : ''}cursor:pointer;">
        <input type="checkbox" class="kl-res-check" data-id="${r.id}" style="width:16px;height:16px;cursor:pointer;flex-shrink:0;">
        <span style="flex:1;font-size:13px;">${Utils.escapeHtml(r.title)}</span>
        ${_catBadge(r.category)}
      </label>`).join('')

    box.querySelectorAll('.kl-res-check').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) _selectedGrantResourceIds.add(cb.dataset.id)
        else _selectedGrantResourceIds.delete(cb.dataset.id)
        _updateGrantSelectedCount()
      })
    })
  }

  function _updateGrantSelectedCount() {
    const el = document.getElementById('kl-grant-selected-count')
    if (!el) return
    const n = _selectedGrantResourceIds.size
    el.textContent = n ? `${n} resource${n > 1 ? 's' : ''} selected` : ''
  }

  function _grantRowsHTML() {
    if (!_grants.length) {
      return `<tr><td colspan="5"><div class="empty-state"><h3>No grants yet</h3><p>Everyone currently sees only their own department.</p></div></td></tr>`
    }
    return _grants.map(g => {
      const isActive = !g.revoked_at
      return `
      <tr>
        <td>
          <div style="font-weight:500;">${Utils.escapeHtml(g.employee?.name || '—')}</div>
          <div style="font-size:12px;color:var(--text-muted);">Own dept: ${Utils.escapeHtml(g.employee?.department?.name || '—')}</div>
        </td>
        <td>
          <div style="font-weight:500;">${Utils.escapeHtml(g.resource?.title || '—')}</div>
          <div style="font-size:12px;color:var(--text-muted);">${Utils.escapeHtml(_deptLabel(g.resource?.department_id) || g.resource?.department?.name || '—')} · ${Utils.escapeHtml(g.resource?.category || '—')}</div>
        </td>
        <td>
          <div style="font-size:13px;">${Utils.formatDate(g.created_at)}</div>
          <div style="font-size:12px;color:var(--text-muted);">by ${Utils.escapeHtml(g.granter?.name || '—')}</div>
        </td>
        <td>
          ${isActive
            ? `<span style="font-size:12px;color:var(--success);">Active</span>`
            : `<div style="font-size:12px;color:var(--text-muted);">Revoked ${Utils.formatDate(g.revoked_at)}</div>
               <div style="font-size:11px;color:var(--text-muted);">by ${Utils.escapeHtml(g.revoker?.name || '—')}</div>`}
        </td>
        <td>
          ${isActive
            ? `<button class="btn btn-sm kl-revoke-btn" style="background:var(--danger,#E53E3E);color:#fff;border-color:var(--danger,#E53E3E);" data-id="${g.id}">Revoke</button>`
            : ''}
        </td>
      </tr>`
    }).join('')
  }

  function _bindGrantRowEvents() {
    document.querySelectorAll('.kl-revoke-btn').forEach(btn => {
      btn.addEventListener('click', () => _revokeGrant(btn.dataset.id))
    })
  }

  /* ── Save Grant ────────────────────────────────────────────── */
  async function _saveGrant() {
    const btn    = document.getElementById('kl-grant-btn')
    const errEl  = document.getElementById('kl-grant-err')
    const empId  = _selectedGrantEmployeeId || ''
    const deptId = document.getElementById('kl-grant-dept')?.value || ''
    const resIds = Array.from(_selectedGrantResourceIds)

    errEl.style.display = 'none'
    if (!empId)        { errEl.textContent = 'Please select an employee.';        errEl.style.display = 'block'; return }
    if (!deptId)       { errEl.textContent = 'Please select a department.';       errEl.style.display = 'block'; return }
    if (!resIds.length) { errEl.textContent = 'Please tick at least one resource.'; errEl.style.display = 'block'; return }

    btn.disabled    = true
    btn.textContent = 'Granting…'

    const { error } = await API.grantKnowledgeAccess(empId, resIds, _user.id)
    if (error) {
      errEl.textContent   = error.message || 'Failed to grant access.'
      errEl.style.display = 'block'
    } else {
      Utils.showToast(`Access granted to ${resIds.length} resource${resIds.length > 1 ? 's' : ''}`, 'success')
      await _loadGrants()
      return
    }

    btn.disabled    = false
    btn.textContent = 'Grant access'
  }

  /* ── Revoke Grant ──────────────────────────────────────────── */
  async function _revokeGrant(id) {
    if (!confirm('Revoke this access grant?')) return

    const { error } = await API.revokeKnowledgeAccess(id, _user.id)
    if (error) { Utils.showToast('Failed to revoke access', 'error'); return }

    Utils.showToast('Access revoked', 'success')
    await _loadGrants()
  }

  return { render, init }
})()

ModuleRegistry.register({
  key:       'knowledge_labs',
  routeId:   'knowledge-labs',
  label:     'Knowledge Labs',
  order:     7,
  icon:      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v6l-6 10a2 2 0 0 0 2 3h14a2 2 0 0 0 2-3l-6-10V2"/><line x1="9" y1="2" x2="15" y2="2"/></svg>`,
  getModule: () => KnowledgeLabsModule,
  // Role-based only, deliberately not using the department-wide
  // People & Culture carve-out other /hrms modules use — inside
  // Knowledge Labs, HR gets no special treatment: own department
  // automatic, everything else needs an explicit resource grant,
  // same as any employee. Matches the RLS policies (is_admin()).
  access:    (user) => user.role === 'super_admin' || user.role === 'admin',
  features:  {
    manage_resources: 'Manage Resources',
    access_control:   'Access Control',
  },
})
