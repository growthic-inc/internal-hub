/* ============================================================
   PEOPLE — Employee Management (HR + Super Admin)
   Phase 2
   ============================================================ */

const AccessControl = (() => {

  let _user      = null
  let _employees = []
  let _managers  = []
  let _tab       = 'list'

  const ROLES = [
    { value: 'super_admin',     label: 'Super Admin' },
    { value: 'founders_office', label: "Founder's Office" },
    { value: 'team_lead',       label: 'Team Lead' },
    { value: 'hr',              label: 'People & Culture (HR)' },
    { value: 'bde',             label: 'Business Development' },
    { value: 'delivery',        label: 'Delivery' },
    { value: 'finance',         label: 'Finance' },
  ]

  const DEPARTMENTS = [
    'Management', 'Operations & Growth', 'People & Culture',
    'Business Development', 'Content Strategy', 'Creative', 'Creators', 'Finance',
  ]

  const STATUS_BADGE = {
    active:   'badge--success',
    inactive: 'badge--danger',
  }

  const ROLE_BADGE = {
    super_admin:     'badge--primary',
    founders_office: 'badge--blue',
    team_lead:       'badge--warning',
    hr:              'badge--success',
    bde:             'badge--outline',
    delivery:        'badge--muted',
    finance:         'badge--muted',
  }

  function render(user) {
    return `
      <div class="page-inner">

        <div class="tabs">
          <button class="tab-btn tab-btn--active" id="ppl-tab-list">Employees</button>
          <button class="tab-btn" id="ppl-tab-invite">Invite Employee</button>
        </div>

        <!-- Employee List Panel -->
        <div id="ppl-list-panel">
          <div class="page-header">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <div class="search-wrap">
                <span class="search-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                </span>
                <input class="form-input" id="ppl-search" type="search" placeholder="Search by name or email…">
              </div>
              <select class="form-select" id="ppl-role-filter" style="width:auto;height:38px;">
                <option value="">All roles</option>
                ${ROLES.map(r => `<option value="${r.value}">${r.label}</option>`).join('')}
              </select>
              <select class="form-select" id="ppl-status-filter" style="width:auto;height:38px;">
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="">All</option>
              </select>
            </div>
          </div>
          <div id="ppl-list-content" class="page-loading">Loading employees…</div>
        </div>

        <!-- Invite Panel -->
        <div id="ppl-invite-panel" style="display:none;">
          <div style="max-width:560px;">
            <p style="font-size:13px;color:var(--text-muted);margin-bottom:24px;">
              Fill in the employee's details below. An invite email will be sent to their address so they can set their password and log in.
            </p>
            <div id="ppl-invite-err" class="alert alert-danger" style="display:none;"></div>
            <div id="ppl-invite-success" class="alert alert-success" style="display:none;"></div>
            <div class="grid-2">
              <div class="form-group">
                <label class="form-label">Full Name <span style="color:var(--danger)">*</span></label>
                <input class="form-input" id="inv-name" placeholder="e.g. Priya Sharma">
              </div>
              <div class="form-group">
                <label class="form-label">Work Email <span style="color:var(--danger)">*</span></label>
                <input class="form-input" type="email" id="inv-email" placeholder="name@thegrowthic.com">
              </div>
            </div>
            <div class="grid-2">
              <div class="form-group">
                <label class="form-label">Role <span style="color:var(--danger)">*</span></label>
                <select class="form-select" id="inv-role">
                  <option value="">Select role…</option>
                  ${ROLES.map(r => `<option value="${r.value}">${r.label}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Department <span style="color:var(--danger)">*</span></label>
                <select class="form-select" id="inv-dept">
                  <option value="">Select department…</option>
                  ${DEPARTMENTS.map(d => `<option value="${d}">${d}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="grid-2">
              <div class="form-group">
                <label class="form-label">Manager (Reporting To)</label>
                <select class="form-select" id="inv-manager">
                  <option value="">— None —</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Joining Date</label>
                <input class="form-input" type="date" id="inv-joining">
              </div>
            </div>
            <button class="btn btn-primary" id="ppl-invite-btn" style="margin-top:8px;">Send Invite</button>
          </div>
        </div>

      </div>

      <!-- Employee Detail Drawer -->
      <div class="drawer-overlay" id="ppl-drawer-bg" style="display:none;"></div>
      <div class="drawer" id="ppl-drawer" style="display:none;flex-direction:column;">
        <div class="drawer-header">
          <div>
            <div class="drawer-title" id="ppl-drawer-name">—</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px;" id="ppl-drawer-sub">—</div>
          </div>
          <button class="btn-icon-sm" id="ppl-drawer-close">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="drawer-body" id="ppl-drawer-body"></div>
      </div>

      <!-- Deactivate Confirm Modal -->
      <div class="modal-overlay" id="deact-modal-bg" style="display:none;">
        <div class="modal">
          <div class="modal-header">
            <h3 class="modal-title">Deactivate Employee</h3>
            <button class="modal-close" id="deact-modal-x">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="modal-body">
            <div class="alert alert-warning">
              This will deactivate the account. The employee will no longer be able to log in. Any assets assigned to them will automatically be returned.
            </div>
            <p id="deact-name-text" style="font-size:14px;font-weight:600;color:var(--text);margin-top:8px;"></p>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" id="deact-cancel">Cancel</button>
            <button class="btn btn-danger" id="deact-confirm">Deactivate</button>
          </div>
        </div>
      </div>

      <!-- Edit Employee Modal -->
      <div class="modal-overlay" id="edit-emp-modal-bg" style="display:none;">
        <div class="modal">
          <div class="modal-header">
            <h3 class="modal-title">Edit Employee</h3>
            <button class="modal-close" id="edit-emp-x">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="modal-body">
            <div id="edit-emp-err" class="alert alert-danger" style="display:none;"></div>
            <input type="hidden" id="edit-emp-id">
            <div class="grid-2">
              <div class="form-group">
                <label class="form-label">Role</label>
                <select class="form-select" id="edit-emp-role">
                  ${ROLES.map(r => `<option value="${r.value}">${r.label}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Department</label>
                <select class="form-select" id="edit-emp-dept">
                  ${DEPARTMENTS.map(d => `<option value="${d}">${d}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">Manager (Reporting To)</label>
              <select class="form-select" id="edit-emp-manager">
                <option value="">— None —</option>
              </select>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" id="edit-emp-cancel">Cancel</button>
            <button class="btn btn-primary" id="edit-emp-save">Save Changes</button>
          </div>
        </div>
      </div>
    `
  }

  async function init(user) {
    _user = user
    _tab  = 'list'

    const [empRes, mgrRes] = await Promise.all([
      API.getAllEmployees(),
      API.getEmployees(true),
    ])
    _employees = empRes.data  || []
    _managers  = mgrRes.data  || []

    _renderList()
    _bindTabs()
    _bindSearch()
    _bindFilters()
    _bindDrawer()
    _bindInviteForm()
    _bindDeactivateModal()
    _bindEditModal()
  }

  // ── Tabs ─────────────────────────────────────────────────────

  function _bindTabs() {
    const listBtn   = document.getElementById('ppl-tab-list')
    const inviteBtn = document.getElementById('ppl-tab-invite')
    const listPanel   = document.getElementById('ppl-list-panel')
    const invitePanel = document.getElementById('ppl-invite-panel')

    listBtn.addEventListener('click', () => {
      listBtn.classList.add('tab-btn--active')
      inviteBtn.classList.remove('tab-btn--active')
      listPanel.style.display   = 'block'
      invitePanel.style.display = 'none'
      _tab = 'list'
    })

    inviteBtn.addEventListener('click', () => {
      inviteBtn.classList.add('tab-btn--active')
      listBtn.classList.remove('tab-btn--active')
      invitePanel.style.display = 'block'
      listPanel.style.display   = 'none'
      _tab = 'invite'
      _populateManagerSelects()
    })
  }

  // ── Employee List ─────────────────────────────────────────────

  function _renderList(overrides = {}) {
    const q      = (document.getElementById('ppl-search')?.value || '').toLowerCase()
    const role   = document.getElementById('ppl-role-filter')?.value   || ''
    const status = document.getElementById('ppl-status-filter')?.value || 'active'

    const list = _employees.filter(e => {
      if (role   && e.role   !== role)   return false
      if (status && e.status !== status) return false
      if (q && !e.name.toLowerCase().includes(q) && !e.email.toLowerCase().includes(q)) return false
      return true
    })

    const el = document.getElementById('ppl-list-content')
    if (!el) return

    if (!list.length) {
      el.className = ''
      el.innerHTML = `<div class="empty-state"><h3>No employees found</h3><p>Adjust your search or filters.</p></div>`
      return
    }

    el.className = 'table-wrap'
    el.innerHTML = `
      <table class="table table--clickable">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Department</th>
            <th>Manager</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${list.map(e => `
            <tr data-id="${e.id}">
              <td>
                <div style="display:flex;align-items:center;gap:10px;">
                  <div style="width:30px;height:30px;border-radius:50%;background:var(--primary-light);color:var(--primary);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;">
                    ${Utils.getInitials(e.name)}
                  </div>
                  <strong>${Utils.escapeHtml(e.name)}</strong>
                </div>
              </td>
              <td style="color:var(--text-secondary);font-size:13px;">${Utils.escapeHtml(e.email)}</td>
              <td><span class="badge ${ROLE_BADGE[e.role] || 'badge--muted'}">${Utils.getRoleLabel(e.role)}</span></td>
              <td style="color:var(--text-secondary);font-size:13px;">${e.department || '—'}</td>
              <td style="font-size:13px;color:var(--text-muted);">${e.employees ? Utils.escapeHtml(e.employees.name) : '—'}</td>
              <td><span class="badge ${STATUS_BADGE[e.status] || 'badge--muted'}">${e.status}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>`

    el.querySelectorAll('tr[data-id]').forEach(row =>
      row.addEventListener('click', () => _openDrawer(row.dataset.id))
    )
  }

  function _bindSearch() {
    const el = document.getElementById('ppl-search')
    if (el) el.addEventListener('input', Utils.debounce(() => _renderList(), 200))
  }

  function _bindFilters() {
    document.getElementById('ppl-role-filter')?.addEventListener('change', () => _renderList())
    document.getElementById('ppl-status-filter')?.addEventListener('change', () => _renderList())
  }

  // ── Employee Drawer ───────────────────────────────────────────

  function _openDrawer(empId) {
    const emp = _employees.find(e => e.id === empId)
    if (!emp) return

    const bg    = document.getElementById('ppl-drawer-bg')
    const panel = document.getElementById('ppl-drawer')
    const body  = document.getElementById('ppl-drawer-body')

    document.getElementById('ppl-drawer-name').textContent = emp.name
    document.getElementById('ppl-drawer-sub').textContent  = `${Utils.getRoleLabel(emp.role)} · ${emp.department || '—'}`

    bg.style.display    = 'block'
    panel.style.display = 'flex'

    const manager = _employees.find(e => e.id === emp.manager_id)

    body.innerHTML = `
      <div style="margin-bottom:20px;">
        <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);margin-bottom:12px;">Details</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
          <div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px;">Email</div>
            <div style="font-size:13px;">${Utils.escapeHtml(emp.email)}</div>
          </div>
          <div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px;">Status</div>
            <span class="badge ${STATUS_BADGE[emp.status]}">${emp.status}</span>
          </div>
          <div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px;">Role</div>
            <span class="badge ${ROLE_BADGE[emp.role] || 'badge--muted'}">${Utils.getRoleLabel(emp.role)}</span>
          </div>
          <div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px;">Department</div>
            <div style="font-size:13px;">${emp.department || '—'}</div>
          </div>
          <div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px;">Manager</div>
            <div style="font-size:13px;">${manager ? Utils.escapeHtml(manager.name) : '—'}</div>
          </div>
          <div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px;">Joined</div>
            <div style="font-size:13px;">${emp.joining_date ? Utils.formatDate(emp.joining_date) : '—'}</div>
          </div>
        </div>
      </div>

      <div class="divider"></div>

      <div style="display:flex;flex-direction:column;gap:8px;">
        <button class="btn btn-secondary" id="drawer-edit-btn" data-id="${emp.id}">Edit Role / Department</button>
        ${emp.status === 'active' && emp.id !== _user.id
          ? `<button class="btn btn-danger" id="drawer-deact-btn" data-id="${emp.id}" data-name="${Utils.escapeHtml(emp.name)}">Deactivate Account</button>`
          : ''}
        ${emp.status === 'inactive'
          ? `<button class="btn btn-secondary" id="drawer-react-btn" data-id="${emp.id}">Reactivate Account</button>`
          : ''}
      </div>
    `

    document.getElementById('drawer-edit-btn')?.addEventListener('click', () => _openEditModal(emp.id))
    document.getElementById('drawer-deact-btn')?.addEventListener('click', () =>
      _openDeactivateModal(emp.id, emp.name)
    )
    document.getElementById('drawer-react-btn')?.addEventListener('click', () => _reactivate(emp.id))
  }

  function _bindDrawer() {
    const _close = () => {
      document.getElementById('ppl-drawer-bg').style.display = 'none'
      document.getElementById('ppl-drawer').style.display    = 'none'
    }
    document.getElementById('ppl-drawer-bg').addEventListener('click', _close)
    document.getElementById('ppl-drawer-close').addEventListener('click', _close)
  }

  // ── Invite Form ───────────────────────────────────────────────

  function _populateManagerSelects(targetId = null) {
    const selects = [document.getElementById('inv-manager'), document.getElementById('edit-emp-manager')]
    selects.forEach(sel => {
      if (!sel) return
      const current = sel.value
      sel.innerHTML = '<option value="">— None —</option>' +
        _managers.map(m => `<option value="${m.id}">${Utils.escapeHtml(m.name)} (${Utils.getRoleLabel(m.role)})</option>`).join('')
      if (current) sel.value = current
      if (targetId) sel.value = targetId
    })
  }

  function _bindInviteForm() {
    const btn = document.getElementById('ppl-invite-btn')
    if (!btn) return

    btn.addEventListener('click', async () => {
      const errEl  = document.getElementById('ppl-invite-err')
      const succEl = document.getElementById('ppl-invite-success')
      errEl.style.display  = 'none'
      succEl.style.display = 'none'

      const name      = document.getElementById('inv-name').value.trim()
      const email     = document.getElementById('inv-email').value.trim()
      const role      = document.getElementById('inv-role').value
      const dept      = document.getElementById('inv-dept').value
      const managerId = document.getElementById('inv-manager').value || null
      const joining   = document.getElementById('inv-joining').value || null

      if (!name || !email || !role || !dept) {
        errEl.textContent   = 'Name, email, role, and department are required.'
        errEl.style.display = 'block'
        return
      }

      btn.disabled    = true
      btn.textContent = 'Sending invite…'

      const { data: { session } } = await Config.supabase.auth.getSession()
      const token = session?.access_token

      const res = await fetch(`${Config.SUPABASE_URL}/functions/v1/invite-employee`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ name, email, role, department: dept, manager_id: managerId, joining_date: joining }),
      })

      const result = await res.json()
      btn.disabled    = false
      btn.textContent = 'Send Invite'

      if (!res.ok || result.error) {
        errEl.textContent   = result.error || 'Invite failed. Please try again.'
        errEl.style.display = 'block'
      } else {
        succEl.textContent   = `Invite sent to ${email}. They will appear in the employee list once they accept.`
        succEl.style.display = 'block'
        ;['inv-name','inv-email','inv-joining'].forEach(id => {
          const el = document.getElementById(id)
          if (el) el.value = ''
        })
        document.getElementById('inv-role').value    = ''
        document.getElementById('inv-dept').value    = ''
        document.getElementById('inv-manager').value = ''

        // Refresh employee list
        const { data } = await API.getAllEmployees()
        _employees = data || []
        _renderList()
      }
    })
  }

  // ── Edit Modal ────────────────────────────────────────────────

  function _openEditModal(empId) {
    const emp = _employees.find(e => e.id === empId)
    if (!emp) return

    const bg = document.getElementById('edit-emp-modal-bg')
    document.getElementById('edit-emp-id').value      = emp.id
    document.getElementById('edit-emp-role').value    = emp.role
    document.getElementById('edit-emp-dept').value    = emp.department || ''
    document.getElementById('edit-emp-err').style.display = 'none'
    _populateManagerSelects(emp.manager_id || '')
    bg.style.display = 'flex'
  }

  function _bindEditModal() {
    const bg      = document.getElementById('edit-emp-modal-bg')
    const saveBtn = document.getElementById('edit-emp-save')
    if (!bg) return

    const _close = () => { bg.style.display = 'none' }
    document.getElementById('edit-emp-x').addEventListener('click', _close)
    document.getElementById('edit-emp-cancel').addEventListener('click', _close)
    bg.addEventListener('click', e => { if (e.target === bg) _close() })

    saveBtn.addEventListener('click', async () => {
      const errEl   = document.getElementById('edit-emp-err')
      const empId   = document.getElementById('edit-emp-id').value
      const role    = document.getElementById('edit-emp-role').value
      const dept    = document.getElementById('edit-emp-dept').value
      const manager = document.getElementById('edit-emp-manager').value || null

      errEl.style.display = 'none'
      saveBtn.disabled    = true
      saveBtn.textContent = 'Saving…'

      const { error } = await Config.supabase
        .from('employees')
        .update({ role, department: dept, manager_id: manager, updated_at: new Date().toISOString() })
        .eq('id', empId)

      saveBtn.disabled    = false
      saveBtn.textContent = 'Save Changes'

      if (error) {
        errEl.textContent   = error.message
        errEl.style.display = 'block'
      } else {
        _close()
        Utils.showToast('Employee updated', 'success')
        const { data } = await API.getAllEmployees()
        _employees = data || []
        _renderList()
        // Close drawer too
        document.getElementById('ppl-drawer-bg').style.display = 'none'
        document.getElementById('ppl-drawer').style.display    = 'none'
      }
    })
  }

  // ── Deactivate Modal ──────────────────────────────────────────

  function _openDeactivateModal(empId, empName) {
    const bg = document.getElementById('deact-modal-bg')
    document.getElementById('deact-name-text').textContent = `Employee: ${empName}`
    bg.style.display = 'flex'

    const confirmBtn = document.getElementById('deact-confirm')
    const fresh = confirmBtn.cloneNode(true)
    confirmBtn.parentNode.replaceChild(fresh, confirmBtn)

    fresh.addEventListener('click', async () => {
      fresh.disabled    = true
      fresh.textContent = 'Deactivating…'

      // Deactivate employee
      const { error } = await Config.supabase
        .from('employees')
        .update({ status: 'inactive' })
        .eq('id', empId)

      if (error) {
        Utils.showToast('Failed to deactivate', 'error')
        fresh.disabled    = false
        fresh.textContent = 'Deactivate'
        return
      }

      // Auto-return all assets assigned to this employee
      await Config.supabase
        .from('assets')
        .update({ assigned_to: null, assigned_date: null, status: 'available', updated_at: new Date().toISOString() })
        .eq('assigned_to', empId)

      bg.style.display = 'none'
      document.getElementById('ppl-drawer-bg').style.display = 'none'
      document.getElementById('ppl-drawer').style.display    = 'none'

      Utils.showToast('Employee deactivated. Assets returned.', 'success')
      const { data } = await API.getAllEmployees()
      _employees = data || []
      _renderList()
    })
  }

  function _bindDeactivateModal() {
    const bg = document.getElementById('deact-modal-bg')
    if (!bg) return
    const _close = () => { bg.style.display = 'none' }
    document.getElementById('deact-modal-x').addEventListener('click', _close)
    document.getElementById('deact-cancel').addEventListener('click', _close)
    bg.addEventListener('click', e => { if (e.target === bg) _close() })
  }

  async function _reactivate(empId) {
    const { error } = await Config.supabase
      .from('employees')
      .update({ status: 'active' })
      .eq('id', empId)

    if (error) {
      Utils.showToast('Failed to reactivate', 'error')
    } else {
      Utils.showToast('Employee reactivated', 'success')
      document.getElementById('ppl-drawer-bg').style.display = 'none'
      document.getElementById('ppl-drawer').style.display    = 'none'
      const { data } = await API.getAllEmployees()
      _employees = data || []
      _renderList()
    }
  }

  return { render, init }
})()
