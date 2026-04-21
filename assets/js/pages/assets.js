/* ============================================================
   ASSET MANAGEMENT — Phase 1
   ============================================================ */

const Assets = (() => {

  let _user      = null
  let _assets    = []
  let _employees = []
  let _activeTab = 'all'

  const CAN_MANAGE = ['super_admin', 'hr']

  const STATUS_BADGE = {
    available: 'badge--success',
    in_use:    'badge--primary',
    pending:   'badge--warning',
    overdue:   'badge--danger',
    retired:   'badge--muted',
  }

  function render(user) {
    _user = user
    const canManage = CAN_MANAGE.includes(user.role)

    return `
      <div class="page-inner">

        <div class="page-header" style="margin-bottom:0;">
          <div class="tabs" style="border:none;margin:0;gap:0;">
            ${canManage ? `<button class="tab-btn tab-btn--active" id="ast-tab-all">All Assets</button>` : ''}
            <button class="tab-btn ${!canManage ? 'tab-btn--active' : ''}" id="ast-tab-mine">My Assets</button>
          </div>
          ${canManage ? `<button class="btn btn-primary btn-sm" id="ast-add-btn">+ Add Asset</button>` : ''}
        </div>

        <div style="height:1px;background:var(--border);margin-bottom:20px;"></div>

        <div id="ast-content" class="page-loading">Loading assets…</div>

      </div>

      ${canManage ? `
        <!-- Add Asset Modal -->
        <div class="modal-overlay" id="ast-modal-bg" style="display:none;">
          <div class="modal">
            <div class="modal-header">
              <h3 class="modal-title">Add New Asset</h3>
              <button class="modal-close" id="ast-modal-x">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div class="modal-body">
              <div id="ast-modal-err" class="alert alert-danger" style="display:none;"></div>
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">Asset Name <span style="color:var(--danger)">*</span></label>
                  <input class="form-input" id="ast-f-name" placeholder="e.g. MacBook Pro 14">
                </div>
                <div class="form-group">
                  <label class="form-label">Type <span style="color:var(--danger)">*</span></label>
                  <select class="form-select" id="ast-f-type">
                    <option value="Laptop">Laptop</option>
                    <option value="Phone">Phone</option>
                    <option value="Monitor">Monitor</option>
                    <option value="Keyboard">Keyboard</option>
                    <option value="Mouse">Mouse</option>
                    <option value="Headset">Headset</option>
                    <option value="Camera">Camera</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">Serial Number</label>
                  <input class="form-input" id="ast-f-serial" placeholder="Optional">
                </div>
                <div class="form-group">
                  <label class="form-label">Condition</label>
                  <select class="form-select" id="ast-f-condition">
                    <option value="New">New</option>
                    <option value="Good" selected>Good</option>
                    <option value="Fair">Fair</option>
                    <option value="Poor">Poor</option>
                  </select>
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">Notes</label>
                <textarea class="form-input form-textarea" id="ast-f-notes" placeholder="Any additional notes…"></textarea>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-secondary" id="ast-modal-cancel">Cancel</button>
              <button class="btn btn-primary" id="ast-modal-save">Add Asset</button>
            </div>
          </div>
        </div>

        <!-- Assign Asset Modal -->
        <div class="modal-overlay" id="ast-assign-bg" style="display:none;">
          <div class="modal">
            <div class="modal-header">
              <h3 class="modal-title">Assign Asset</h3>
              <button class="modal-close" id="ast-assign-x">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div class="modal-body">
              <div id="ast-assign-err" class="alert alert-danger" style="display:none;"></div>
              <p id="ast-assign-name" style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:16px;"></p>
              <div class="form-group" style="margin-bottom:0;">
                <label class="form-label">Assign to <span style="color:var(--danger)">*</span></label>
                <select class="form-select" id="ast-assign-emp">
                  <option value="">Select employee…</option>
                </select>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-secondary" id="ast-assign-cancel">Cancel</button>
              <button class="btn btn-primary" id="ast-assign-save">Assign</button>
            </div>
          </div>
        </div>
      ` : ''}
    `
  }

  async function init(user) {
    _user = user
    const canManage = CAN_MANAGE.includes(user.role)

    const promises = [API.getAssets()]
    if (canManage) promises.push(API.getEmployees(true))

    const results  = await Promise.all(promises)
    _assets        = results[0].data || []
    _employees     = canManage ? (results[1].data || []) : []

    if (canManage) {
      _activeTab = 'all'
      _bindTabs()
      _bindAddModal()
      _bindAssignModal()
      _renderAll()
    } else {
      _activeTab = 'mine'
      _renderMine()
    }
  }

  // ── Tabs ─────────────────────────────────────────────────────

  function _bindTabs() {
    const allTab  = document.getElementById('ast-tab-all')
    const mineTab = document.getElementById('ast-tab-mine')

    allTab && allTab.addEventListener('click', () => {
      allTab.classList.add('tab-btn--active')
      mineTab.classList.remove('tab-btn--active')
      _activeTab = 'all'
      _renderAll()
    })

    mineTab && mineTab.addEventListener('click', () => {
      mineTab.classList.add('tab-btn--active')
      allTab && allTab.classList.remove('tab-btn--active')
      _activeTab = 'mine'
      _renderMine()
    })
  }

  // ── Render All Assets ─────────────────────────────────────────

  function _renderAll() {
    const el = document.getElementById('ast-content')
    if (!el) return

    if (!_assets.length) {
      el.className = ''
      el.innerHTML = `
        <div class="empty-state">
          <h3>No assets yet</h3>
          <p>Add your first company asset using the button above.</p>
        </div>`
      return
    }

    el.className = 'table-wrap'
    el.innerHTML = `
      <table class="table">
        <thead>
          <tr>
            <th>Asset</th>
            <th>Type</th>
            <th>Serial No.</th>
            <th>Condition</th>
            <th>Assigned To</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${_assets.map(a => `
            <tr>
              <td><strong>${Utils.escapeHtml(a.name)}</strong></td>
              <td style="color:var(--text-secondary);">${a.type}</td>
              <td style="font-size:12px;color:var(--text-muted);">${a.serial_number || '—'}</td>
              <td style="font-size:12px;">${a.condition || '—'}</td>
              <td>
                ${a.employees
                  ? Utils.escapeHtml(a.employees.name)
                  : '<span style="color:var(--text-muted);">Unassigned</span>'}
              </td>
              <td>
                <span class="badge ${STATUS_BADGE[a.status] || 'badge--muted'}">
                  ${a.status.replace('_', ' ')}
                </span>
              </td>
              <td style="white-space:nowrap;">
                ${a.status === 'available'
                  ? `<button class="btn btn-secondary btn-sm ast-assign" data-id="${a.id}" data-name="${Utils.escapeHtml(a.name)}">Assign</button>`
                  : a.status === 'in_use'
                  ? `<button class="btn btn-ghost btn-sm ast-return" data-id="${a.id}">Return</button>`
                  : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>`

    el.querySelectorAll('.ast-assign').forEach(btn =>
      btn.addEventListener('click', () => _openAssignModal(btn.dataset.id, btn.dataset.name))
    )
    el.querySelectorAll('.ast-return').forEach(btn =>
      btn.addEventListener('click', () => _returnAsset(btn.dataset.id))
    )
  }

  // ── Render My Assets ──────────────────────────────────────────

  function _renderMine() {
    const el   = document.getElementById('ast-content')
    if (!el) return
    const mine = _assets.filter(a => a.assigned_to === _user.id)

    el.className = ''

    if (!mine.length) {
      el.innerHTML = `
        <div class="empty-state">
          <h3>No assets assigned</h3>
          <p>You have no company assets currently assigned to you.</p>
        </div>`
      return
    }

    el.className = 'table-wrap'
    el.innerHTML = `
      <table class="table">
        <thead>
          <tr>
            <th>Asset</th>
            <th>Type</th>
            <th>Serial No.</th>
            <th>Condition</th>
            <th>Assigned Since</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${mine.map(a => `
            <tr>
              <td><strong>${Utils.escapeHtml(a.name)}</strong></td>
              <td style="color:var(--text-secondary);">${a.type}</td>
              <td style="font-size:12px;color:var(--text-muted);">${a.serial_number || '—'}</td>
              <td style="font-size:12px;">${a.condition || '—'}</td>
              <td style="font-size:12px;color:var(--text-muted);">
                ${a.assigned_date ? Utils.formatDateShort(a.assigned_date) : '—'}
              </td>
              <td>
                <span class="badge ${STATUS_BADGE[a.status] || 'badge--muted'}">
                  ${a.status.replace('_', ' ')}
                </span>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>`
  }

  // ── Add Asset Modal ───────────────────────────────────────────

  function _bindAddModal() {
    const bg      = document.getElementById('ast-modal-bg')
    const saveBtn = document.getElementById('ast-modal-save')
    if (!bg) return

    const _open  = () => {
      document.getElementById('ast-modal-err').style.display = 'none'
      bg.style.display = 'flex'
    }
    const _close = () => {
      bg.style.display = 'none'
      ;['ast-f-name', 'ast-f-serial', 'ast-f-notes'].forEach(id => {
        const el = document.getElementById(id)
        if (el) el.value = ''
      })
    }

    document.getElementById('ast-add-btn').addEventListener('click', _open)
    document.getElementById('ast-modal-x').addEventListener('click', _close)
    document.getElementById('ast-modal-cancel').addEventListener('click', _close)
    bg.addEventListener('click', e => { if (e.target === bg) _close() })

    saveBtn.addEventListener('click', async () => {
      const errEl  = document.getElementById('ast-modal-err')
      const name   = document.getElementById('ast-f-name').value.trim()
      const type   = document.getElementById('ast-f-type').value
      const serial = document.getElementById('ast-f-serial').value.trim()
      const cond   = document.getElementById('ast-f-condition').value
      const notes  = document.getElementById('ast-f-notes').value.trim()

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
        _close()
        Utils.showToast('Asset added', 'success')
        const { data } = await API.getAssets()
        _assets = data || []
        _renderAll()
      }
    })
  }

  // ── Assign Asset Modal ────────────────────────────────────────

  function _bindAssignModal() {
    // Modal is opened dynamically via _openAssignModal — nothing to bind here at init
  }

  function _openAssignModal(assetId, assetName) {
    const bg = document.getElementById('ast-assign-bg')
    if (!bg) return

    document.getElementById('ast-assign-name').textContent    = `Assigning: ${assetName}`
    document.getElementById('ast-assign-err').style.display   = 'none'

    const empSel = document.getElementById('ast-assign-emp')
    empSel.innerHTML = '<option value="">Select employee…</option>' +
      _employees.map(e =>
        `<option value="${e.id}">${Utils.escapeHtml(e.name)} (${Utils.getRoleLabel(e.role)})</option>`
      ).join('')

    bg.style.display = 'flex'

    const saveBtn = document.getElementById('ast-assign-save')
    const _close  = () => { bg.style.display = 'none' }

    document.getElementById('ast-assign-x').onclick      = _close
    document.getElementById('ast-assign-cancel').onclick = _close
    bg.onclick = e => { if (e.target === bg) _close() }

    // Replace save button to clear stale listeners from previous opens
    const fresh = saveBtn.cloneNode(true)
    saveBtn.parentNode.replaceChild(fresh, saveBtn)

    fresh.addEventListener('click', async () => {
      const errEl = document.getElementById('ast-assign-err')
      const empId = empSel.value

      errEl.style.display = 'none'
      if (!empId) {
        errEl.textContent   = 'Please select an employee.'
        errEl.style.display = 'block'
        return
      }

      fresh.disabled    = true
      fresh.textContent = 'Assigning…'

      const { error } = await Config.supabase.from('assets').update({
        assigned_to:   empId,
        assigned_date: new Date().toISOString().split('T')[0],
        status:        'in_use',
        updated_at:    new Date().toISOString(),
      }).eq('id', assetId)

      fresh.disabled    = false
      fresh.textContent = 'Assign'

      if (error) {
        errEl.textContent   = error.message
        errEl.style.display = 'block'
      } else {
        _close()
        Utils.showToast('Asset assigned', 'success')
        const { data } = await API.getAssets()
        _assets = data || []
        _renderAll()
      }
    })
  }

  // ── Return Asset ──────────────────────────────────────────────

  async function _returnAsset(assetId) {
    const { error } = await Config.supabase.from('assets').update({
      assigned_to:   null,
      assigned_date: null,
      status:        'available',
      updated_at:    new Date().toISOString(),
    }).eq('id', assetId)

    if (error) {
      Utils.showToast('Failed to return asset', 'error')
    } else {
      Utils.showToast('Asset marked as returned', 'success')
      const { data } = await API.getAssets()
      _assets = data || []
      _renderAll()
    }
  }

  return { render, init }
})()
