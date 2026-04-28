/* ============================================================
   ASSET MANAGEMENT — Phase 5 design language
   Two tabs: All Assets (HR/Admin) + My Assets
   Modals via Utils.openModal().
   ============================================================ */

const Assets = (() => {

  let _user      = null
  let _assets    = []
  let _employees = []
  let _activeTab = 'all'
  let _p         = null  // department permissions

  const CAN_MANAGE = ['super_admin', 'hr']

  const STATUS_BADGE = {
    available: '<span class="badge badge--success">Available</span>',
    in_use:    '<span class="badge badge--primary">In Use</span>',
    pending:   '<span class="badge badge--warning">Pending</span>',
    overdue:   '<span class="badge badge--danger">Overdue</span>',
    retired:   '<span class="badge badge--muted">Retired</span>',
  }

  const ASSET_TYPES = ['Laptop', 'Phone', 'Monitor', 'Keyboard', 'Mouse', 'Headset', 'Camera', 'Other']
  const CONDITIONS  = ['New', 'Good', 'Fair', 'Poor']

  /* ── render ──────────────────────────────────────────────── */
  function render(user) {
    const canManage = CAN_MANAGE.includes(user.role) && App.hasAccess('asset_management', 'manage_assets', 'can_manage')
    const tabs = []
    if (canManage) tabs.push({ id: 'all',  label: 'All Assets' })
    tabs.push(      { id: 'mine', label: 'My Assets' })

    return `
      <div class="page-inner">
        <div class="page-toolbar">
          <div class="tabs" id="ast-tabs">
            ${tabs.map((t, i) => `
              <button class="tab-btn${i === 0 ? ' tab-btn--active' : ''}" data-tab="${t.id}">
                ${t.label}
              </button>`).join('')}
          </div>
          <div id="ast-toolbar-actions"></div>
        </div>
        <div id="ast-content" class="mt-4"></div>
      </div>
    `
  }

  /* ── init ────────────────────────────────────────────────── */
  async function init(user) {
    _user = user
    _p    = {
      can_view:   App.hasAccess('asset_management', 'view_assets',   'view_only'),
      can_create: App.hasAccess('asset_management', 'request_asset', 'can_upload'),
      can_edit:   App.hasAccess('asset_management', 'manage_assets', 'can_manage'),
    }
    const canManage = CAN_MANAGE.includes(user.role) && _p.can_edit

    const promises = [API.getAssets()]
    if (canManage) promises.push(API.getEmployees(true))

    const results = await Promise.all(promises)
    _assets       = results[0].data || []
    _employees    = canManage ? (results[1].data || []) : []

    _activeTab = canManage ? 'all' : 'mine'
    _bindTabs()
    _loadTab(_activeTab)
  }

  function _bindTabs() {
    document.querySelectorAll('#ast-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#ast-tabs .tab-btn').forEach(b => b.classList.remove('tab-btn--active'))
        btn.classList.add('tab-btn--active')
        _activeTab = btn.dataset.tab
        _loadTab(_activeTab)
      })
    })
  }

  function _loadTab(tab) {
    const toolbar   = document.getElementById('ast-toolbar-actions')
    const canManage = CAN_MANAGE.includes(_user.role) && _p.can_edit

    if (toolbar) {
      toolbar.innerHTML = tab === 'all' && canManage
        ? `<button class="btn btn--primary btn--sm" id="ast-add-btn">+ Add Asset</button>`
        : ''
      if (tab === 'all' && canManage) {
        document.getElementById('ast-add-btn').addEventListener('click', _openAddModal)
      }
    }

    switch (tab) {
      case 'all':  return _renderAllTab()
      case 'mine': return _renderMineTab()
    }
  }

  /* ══════════════════════════════════════════════════════════
     ALL ASSETS TAB
  ══════════════════════════════════════════════════════════ */
  function _renderAllTab() {
    const content = document.getElementById('ast-content')
    if (!content) return

    content.innerHTML = `
      <div class="section-card">
        <div class="section-card-header"><h3>All Assets</h3></div>
        <div class="section-card-body">
          ${!_assets.length
            ? '<p class="empty-state">No assets yet. Add the first one using the button above.</p>'
            : `<table class="data-table">
                <thead><tr>
                  <th>Asset</th>
                  <th>Type</th>
                  <th>Serial No.</th>
                  <th>Condition</th>
                  <th>Assigned To</th>
                  <th>Status</th>
                  <th></th>
                </tr></thead>
                <tbody>
                  ${_assets.map(a => `
                    <tr>
                      <td><strong>${Utils.escapeHtml(a.name)}</strong></td>
                      <td class="text-muted">${a.type}</td>
                      <td class="text-sm text-muted">${a.serial_number || '—'}</td>
                      <td class="text-sm">${a.condition || '—'}</td>
                      <td>
                        ${a.employees
                          ? Utils.escapeHtml(a.employees.name)
                          : '<span class="text-muted">Unassigned</span>'}
                      </td>
                      <td>${STATUS_BADGE[a.status] || `<span class="badge badge--muted">${a.status}</span>`}</td>
                      <td style="white-space:nowrap;">
                        ${_p.can_edit
                          ? a.status === 'available'
                            ? `<button class="btn btn--xs btn--secondary ast-assign"
                                 data-id="${a.id}" data-name="${Utils.escapeHtml(a.name)}">Assign</button>`
                            : a.status === 'in_use'
                            ? `<button class="btn btn--xs btn--ghost ast-return"
                                 data-id="${a.id}">Return</button>`
                            : ''
                          : ''}
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>`
          }
        </div>
      </div>
    `

    content.querySelectorAll('.ast-assign').forEach(btn =>
      btn.addEventListener('click', () => _openAssignModal(btn.dataset.id, btn.dataset.name))
    )
    content.querySelectorAll('.ast-return').forEach(btn =>
      btn.addEventListener('click', () => _returnAsset(btn.dataset.id))
    )
  }

  /* ══════════════════════════════════════════════════════════
     MY ASSETS TAB
  ══════════════════════════════════════════════════════════ */
  function _renderMineTab() {
    const content = document.getElementById('ast-content')
    if (!content) return
    const mine = _assets.filter(a => a.assigned_to === _user.id)

    content.innerHTML = `
      <div class="section-card">
        <div class="section-card-header"><h3>My Assigned Assets</h3></div>
        <div class="section-card-body">
          ${!mine.length
            ? '<p class="empty-state">No company assets are currently assigned to you.</p>'
            : `<table class="data-table">
                <thead><tr>
                  <th>Asset</th>
                  <th>Type</th>
                  <th>Serial No.</th>
                  <th>Condition</th>
                  <th>Assigned Since</th>
                  <th>Status</th>
                </tr></thead>
                <tbody>
                  ${mine.map(a => `
                    <tr>
                      <td><strong>${Utils.escapeHtml(a.name)}</strong></td>
                      <td class="text-muted">${a.type}</td>
                      <td class="text-sm text-muted">${a.serial_number || '—'}</td>
                      <td class="text-sm">${a.condition || '—'}</td>
                      <td class="text-sm text-muted">
                        ${a.assigned_date ? Utils.formatDate(a.assigned_date) : '—'}
                      </td>
                      <td>${STATUS_BADGE[a.status] || `<span class="badge badge--muted">${a.status}</span>`}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>`
          }
        </div>
      </div>
    `
  }

  /* ══════════════════════════════════════════════════════════
     ADD ASSET MODAL
  ══════════════════════════════════════════════════════════ */
  function _openAddModal() {
    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Add New Asset</h3>
        <button class="modal-close" onclick="Utils.closeModal()">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <div id="ast-modal-err" class="alert alert--danger" style="display:none;"></div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Asset Name <span class="required">*</span></label>
            <input class="form-input" id="ast-f-name" placeholder="e.g. MacBook Pro 14" />
          </div>
          <div class="form-group">
            <label class="form-label">Type <span class="required">*</span></label>
            <select class="form-select" id="ast-f-type">
              ${ASSET_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Serial Number</label>
            <input class="form-input" id="ast-f-serial" placeholder="Optional" />
          </div>
          <div class="form-group">
            <label class="form-label">Condition</label>
            <select class="form-select" id="ast-f-condition">
              ${CONDITIONS.map((c, i) => `<option value="${c}"${i === 1 ? ' selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Notes</label>
          <textarea class="form-input" id="ast-f-notes" rows="2"
            placeholder="Any additional notes…" style="resize:vertical;"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="ast-modal-save">Add Asset</button>
      </div>
    `)

    document.getElementById('ast-modal-save').addEventListener('click', async () => {
      const errEl   = document.getElementById('ast-modal-err')
      const saveBtn = document.getElementById('ast-modal-save')
      const name    = document.getElementById('ast-f-name').value.trim()
      const type    = document.getElementById('ast-f-type').value
      const serial  = document.getElementById('ast-f-serial').value.trim()
      const cond    = document.getElementById('ast-f-condition').value
      const notes   = document.getElementById('ast-f-notes').value.trim()

      errEl.style.display = 'none'
      if (!name) {
        errEl.textContent   = 'Asset name is required.'
        errEl.style.display = 'block'
        return
      }

      saveBtn.disabled    = true
      saveBtn.textContent = 'Saving…'

      const { error } = await Config.supabase.from('assets').insert({
        name,
        type,
        serial_number: serial || null,
        condition:     cond,
        notes:         notes || null,
        status:        'available',
      })

      saveBtn.disabled    = false
      saveBtn.textContent = 'Add Asset'

      if (error) {
        errEl.textContent   = error.message
        errEl.style.display = 'block'
      } else {
        Utils.closeModal()
        Utils.showToast('Asset added.', 'success')
        const { data } = await API.getAssets()
        _assets = data || []
        _renderAllTab()
      }
    })
  }

  /* ══════════════════════════════════════════════════════════
     ASSIGN ASSET MODAL
  ══════════════════════════════════════════════════════════ */
  function _openAssignModal(assetId, assetName) {
    const empOptions = _employees.map(e =>
      `<option value="${e.id}">${Utils.escapeHtml(e.name)} (${Utils.getRoleLabel(e.role)})</option>`
    ).join('')

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Assign Asset</h3>
        <button class="modal-close" onclick="Utils.closeModal()">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <div id="ast-assign-err" class="alert alert--danger" style="display:none;"></div>
        <p style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:16px;">
          Assigning: ${Utils.escapeHtml(assetName)}
        </p>
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">Assign to <span class="required">*</span></label>
          <select class="form-select" id="ast-assign-emp">
            <option value="">Select employee…</option>
            ${empOptions}
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="ast-assign-save">Assign</button>
      </div>
    `)

    document.getElementById('ast-assign-save').addEventListener('click', async () => {
      const errEl   = document.getElementById('ast-assign-err')
      const saveBtn = document.getElementById('ast-assign-save')
      const empId   = document.getElementById('ast-assign-emp').value

      errEl.style.display = 'none'
      if (!empId) {
        errEl.textContent   = 'Please select an employee.'
        errEl.style.display = 'block'
        return
      }

      saveBtn.disabled    = true
      saveBtn.textContent = 'Assigning…'

      const { error } = await Config.supabase.from('assets').update({
        assigned_to:   empId,
        assigned_date: new Date().toISOString().split('T')[0],
        status:        'in_use',
        updated_at:    new Date().toISOString(),
      }).eq('id', assetId)

      saveBtn.disabled    = false
      saveBtn.textContent = 'Assign'

      if (error) {
        errEl.textContent   = error.message
        errEl.style.display = 'block'
      } else {
        Utils.closeModal()
        Utils.showToast('Asset assigned.', 'success')
        const { data } = await API.getAssets()
        _assets = data || []
        _renderAllTab()
      }
    })
  }

  /* ── Return Asset ──────────────────────────────────────────── */
  async function _returnAsset(assetId) {
    const { error } = await Config.supabase.from('assets').update({
      assigned_to:   null,
      assigned_date: null,
      status:        'available',
      updated_at:    new Date().toISOString(),
    }).eq('id', assetId)

    if (error) {
      Utils.showToast('Failed to return asset.', 'error')
    } else {
      Utils.showToast('Asset marked as returned.', 'success')
      const { data } = await API.getAssets()
      _assets = data || []
      _renderAllTab()
    }
  }

  return { render, init }
})()
