/* ============================================================
   PEOPLE — Directory, Org Chart, Invite / Add Employee
   Phase 7 — Growthic One
   ============================================================ */

const People = (() => {

  /* ── Module state ──────────────────────────────────────── */
  let _user        = null
  let _employees   = []
  let _departments = []
  let _canManage   = false
  let _activeTab   = 'directory'

  /* ── Constants ─────────────────────────────────────────── */
  const ROLES = [
    { value: 'employee',   label: 'Employee' },
    { value: 'super_admin', label: 'Super Admin' },
  ]

  const EMP_TYPES = [
    { value: 'full_time',  label: 'Full Time' },
    { value: 'part_time',  label: 'Part Time' },
    { value: 'freelancer', label: 'Freelancer' },
    { value: 'intern',     label: 'Intern' },
    { value: 'probation',  label: 'Probation' },
  ]

  const WORK_LOCATIONS = [
    { value: 'office', label: 'Office' },
    { value: 'remote', label: 'Remote' },
    { value: 'hybrid', label: 'Hybrid' },
  ]

  const CLOSE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"
    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
    stroke-linecap="round" stroke-linejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>`

  /* ── render ─────────────────────────────────────────────── */
  function render(user) {
    const canManage = App.hasAccess('people_hrms', 'create_employee', 'can_manage')
    return `
      <div class="page-inner">
        <div class="page-toolbar">
          <div class="tabs" id="ppl-tabs">
            <button class="tab-btn tab-btn--active" data-tab="directory">Directory</button>
            <button class="tab-btn" data-tab="orgchart">Org Chart</button>
            ${canManage ? `<button class="tab-btn" data-tab="invite">Add Employee</button>` : ''}
          </div>
          <div id="ppl-toolbar-actions"></div>
        </div>
        <div id="ppl-content" class="page-loading">Loading…</div>
      </div>
    `
  }

  /* ── init ───────────────────────────────────────────────── */
  async function init(user) {
    _user      = user
    _canManage = App.hasAccess('people_hrms', 'create_employee', 'can_manage')

    const [empRes, deptRes] = await Promise.all([
      API.getEmployeesFull(),
      API.getDepartments(),
    ])
    _employees   = empRes.data   || []
    _departments = deptRes.data  || []

    // Resolve manager names from the loaded array (fallback if PostgREST self-join misses)
    const _empById = Object.fromEntries(_employees.map(e => [e.id, e]))
    _employees.forEach(e => {
      e._managerName = e.manager?.name || (e.manager_id && _empById[e.manager_id]?.name) || null
    })

    _bindTabs()
    _loadTab('directory')
  }

  /* ── Tab binding ─────────────────────────────────────────── */
  function _bindTabs() {
    document.querySelectorAll('#ppl-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#ppl-tabs .tab-btn').forEach(b => b.classList.remove('tab-btn--active'))
        btn.classList.add('tab-btn--active')
        _activeTab = btn.dataset.tab
        _loadTab(_activeTab)
      })
    })
  }

  function _loadTab(tab) {
    const actions = document.getElementById('ppl-toolbar-actions')
    if (actions) {
      actions.innerHTML = (tab === 'directory' && _canManage)
        ? `<button class="btn btn--primary btn--sm" id="ppl-add-btn">+ Add Employee</button>`
        : ''
      if (tab === 'directory' && _canManage) {
        document.getElementById('ppl-add-btn')?.addEventListener('click', () => _switchToInviteTab())
      }
    }
    switch (tab) {
      case 'directory': return _renderDirectory()
      case 'orgchart':  return _renderOrgChart()
      case 'invite':    return _renderInvitePanel()
    }
  }

  function _switchToInviteTab() {
    document.querySelectorAll('#ppl-tabs .tab-btn').forEach(b => {
      b.classList.toggle('tab-btn--active', b.dataset.tab === 'invite')
    })
    _activeTab = 'invite'
    _loadTab('invite')
  }

  /* ══════════════════════════════════════════════════════════
     DIRECTORY TAB
  ══════════════════════════════════════════════════════════ */
  function _renderDirectory() {
    const content = document.getElementById('ppl-content')
    if (!content) return
    content.className = ''

    const deptOptions = _departments.map(d =>
      `<option value="${Utils.escapeHtml(d.slug)}">${Utils.escapeHtml(d.name)}</option>`
    ).join('')

    content.innerHTML = `
      <div class="section-card">
        <div class="section-card-header" style="padding-bottom:12px;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <div class="search-wrap">
              <span class="search-icon">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
              </span>
              <input class="form-input" id="ppl-dir-search" type="search"
                placeholder="Search by name or email…" style="padding-left:36px;">
            </div>
            <select class="form-select" id="ppl-dir-dept" style="width:auto;height:38px;">
              <option value="">All Departments</option>
              ${deptOptions}
            </select>
            <select class="form-select" id="ppl-dir-status" style="width:auto;height:38px;">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="">All</option>
            </select>
          </div>
        </div>
        <div class="section-card-body" style="padding-top:0;">
          <div id="ppl-dir-table"></div>
        </div>
      </div>
    `

    _renderDirectoryTable()

    document.getElementById('ppl-dir-search')?.addEventListener('input',
      Utils.debounce(() => _renderDirectoryTable(), 200))
    document.getElementById('ppl-dir-dept')?.addEventListener('change', () => _renderDirectoryTable())
    document.getElementById('ppl-dir-status')?.addEventListener('change', () => _renderDirectoryTable())
  }

  function _renderDirectoryTable() {
    const q      = (document.getElementById('ppl-dir-search')?.value || '').toLowerCase()
    const dept   = document.getElementById('ppl-dir-dept')?.value   || ''
    const status = document.getElementById('ppl-dir-status')?.value || ''

    const list = _employees.filter(e => {
      if (dept   && e.department !== dept)   return false
      if (status && e.status     !== status) return false
      if (q && !e.name.toLowerCase().includes(q) && !(e.email || '').toLowerCase().includes(q)) return false
      return true
    })

    const el = document.getElementById('ppl-dir-table')
    if (!el) return

    if (!list.length) {
      el.innerHTML = `<div class="empty-state"><h3>No employees found</h3><p>Adjust filters.</p></div>`
      return
    }

    el.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Employee ID</th>
            <th>Name</th>
            <th>Designation</th>
            <th>Department</th>
            <th>Employment Type</th>
            <th>Reporting Manager</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${list.map(e => `
            <tr class="row-clickable" data-id="${e.id}" style="cursor:pointer;">
              <td class="text-sm text-muted">${Utils.escapeHtml(e.employee_id || '—')}</td>
              <td>
                <div style="display:flex;align-items:center;gap:10px;">
                  <div class="people-avatar-sm" style="width:32px;height:32px;border-radius:50%;
                    background:var(--primary-light);color:var(--primary);display:flex;
                    align-items:center;justify-content:center;font-size:11px;font-weight:700;
                    flex-shrink:0;overflow:hidden;">
                    ${e.profile_image_url
                      ? `<img src="${Utils.escapeHtml(e.profile_image_url)}" alt=""
                           style="width:100%;height:100%;object-fit:cover;">`
                      : Utils.getInitials(e.name)}
                  </div>
                  <strong>${Utils.escapeHtml(e.name)}</strong>
                </div>
              </td>
              <td class="text-sm">${Utils.escapeHtml(e.designation || '—')}</td>
              <td><span class="dept-badge">${Utils.getDeptLabel(e.department)}</span></td>
              <td class="text-sm">${_empTypeLabel(e.employment_type)}</td>
              <td class="text-sm text-muted">
                ${e._managerName ? Utils.escapeHtml(e._managerName) : '—'}
              </td>
              <td>
                ${e.status === 'active'
                  ? '<span class="badge badge--success">Active</span>'
                  : '<span class="badge badge--danger">Inactive</span>'}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `

    el.querySelectorAll('tr[data-id]').forEach(row =>
      row.addEventListener('click', () => _openProfileModal(row.dataset.id))
    )
  }

  /* ══════════════════════════════════════════════════════════
     EMPLOYEE PROFILE MODAL
  ══════════════════════════════════════════════════════════ */
  function _openProfileModal(empId) {
    const emp = _employees.find(e => e.id === empId)
    if (!emp) return
    _showProfileView(emp)
  }

  function _showProfileView(emp) {
    const avatarHtml = emp.profile_image_url
      ? `<img src="${Utils.escapeHtml(emp.profile_image_url)}" alt=""
           style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
      : `<span style="font-size:22px;font-weight:700;">${Utils.getInitials(emp.name)}</span>`

    const statusBadge = emp.status === 'active'
      ? '<span class="badge badge--success">Active</span>'
      : '<span class="badge badge--danger">Inactive</span>'

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Employee Profile</h3>
        <button class="modal-close" onclick="Utils.closeModal()">${CLOSE_SVG}</button>
      </div>
      <div class="modal-body" style="padding:0;">

        <!-- Profile Header -->
        <div class="people-profile-header" style="display:flex;align-items:center;gap:16px;
          padding:20px 24px;background:var(--surface-alt);border-bottom:1px solid var(--border);">
          <div class="people-avatar-lg" style="width:72px;height:72px;border-radius:50%;
            background:var(--primary-light);color:var(--primary);display:flex;
            align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;">
            ${avatarHtml}
          </div>
          <div>
            <div style="font-size:18px;font-weight:700;color:var(--text);line-height:1.2;">
              ${Utils.escapeHtml(emp.name)}
            </div>
            <div style="font-size:13px;color:var(--text-muted);margin-top:3px;">
              ${Utils.escapeHtml(emp.designation || '—')}
              ${emp.department ? ` · <span class="dept-badge">${Utils.getDeptLabel(emp.department)}</span>` : ''}
            </div>
            <div style="margin-top:6px;display:flex;align-items:center;gap:8px;">
              <span style="font-size:12px;font-weight:600;color:var(--text-muted);">
                ${Utils.escapeHtml(emp.employee_id || '—')}
              </span>
              ${statusBadge}
            </div>
          </div>
        </div>

        <!-- Field Grid -->
        <div style="padding:20px 24px;">
          <div class="people-field-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">

            <div class="people-field">
              <div class="people-field-label">Work Email</div>
              <div class="people-field-value">${Utils.escapeHtml(emp.email || '—')}</div>
            </div>
            <div class="people-field">
              <div class="people-field-label">Personal Email</div>
              <div class="people-field-value">${Utils.escapeHtml(emp.personal_email || '—')}</div>
            </div>

            <div class="people-field">
              <div class="people-field-label">Phone</div>
              <div class="people-field-value">${Utils.escapeHtml(emp.phone_number || '—')}</div>
            </div>
            <div class="people-field">
              <div class="people-field-label">Date of Birth</div>
              <div class="people-field-value">${Utils.formatDate(emp.date_of_birth)}</div>
            </div>

            <div class="people-field">
              <div class="people-field-label">Employment Type</div>
              <div class="people-field-value">${_empTypeLabel(emp.employment_type)}</div>
            </div>
            <div class="people-field">
              <div class="people-field-label">Work Location</div>
              <div class="people-field-value">${_workLocationLabel(emp.work_location)}</div>
            </div>

            <div class="people-field">
              <div class="people-field-label">Joining Date</div>
              <div class="people-field-value">${Utils.formatDate(emp.joining_date)}</div>
            </div>
            <div class="people-field">
              <div class="people-field-label">Probation Status</div>
              <div class="people-field-value">
                ${emp.probation_completed
                  ? `Completed${emp.probation_completed_date ? ' · ' + Utils.formatDate(emp.probation_completed_date) : ''}`
                  : 'Ongoing'}
              </div>
            </div>

            <div class="people-field">
              <div class="people-field-label">Reporting Manager</div>
              <div class="people-field-value">
                ${emp.manager ? Utils.escapeHtml(emp.manager.name) : '—'}
              </div>
            </div>
            <div class="people-field">
              <div class="people-field-label">Status</div>
              <div class="people-field-value">${statusBadge}</div>
            </div>

          </div>

          <!-- Emergency Contact -->
          <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border);">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;
              color:var(--text-muted);margin-bottom:12px;">Emergency Contact</div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">
              <div class="people-field">
                <div class="people-field-label">Name</div>
                <div class="people-field-value">${Utils.escapeHtml(emp.emergency_contact_name || '—')}</div>
              </div>
              <div class="people-field">
                <div class="people-field-label">Relationship</div>
                <div class="people-field-value">${Utils.escapeHtml(emp.emergency_contact_relationship || '—')}</div>
              </div>
              <div class="people-field">
                <div class="people-field-label">Phone</div>
                <div class="people-field-value">${Utils.escapeHtml(emp.emergency_contact_phone || '—')}</div>
              </div>
            </div>
          </div>
        </div>

      </div>

      ${_canManage ? `
        <div class="modal-footer" style="gap:8px;">
          <button class="btn btn--ghost" onclick="Utils.closeModal()">Close</button>
          <button class="btn btn--ghost btn--sm" id="ppl-modal-deact-btn"
            data-id="${emp.id}" data-name="${Utils.escapeHtml(emp.name)}"
            data-status="${emp.status}">
            ${emp.status === 'active' ? 'Deactivate' : 'Reactivate'}
          </button>
          <button class="btn btn--primary" id="ppl-modal-edit-btn" data-id="${emp.id}">
            Edit Employee
          </button>
        </div>
      ` : `
        <div class="modal-footer">
          <button class="btn btn--ghost" onclick="Utils.closeModal()">Close</button>
        </div>
      `}
    `, 'people-profile-modal')

    if (_canManage) {
      document.getElementById('ppl-modal-edit-btn')?.addEventListener('click', () => {
        Utils.closeModal()
        _openEditModal(emp.id)
      })
      document.getElementById('ppl-modal-deact-btn')?.addEventListener('click', (e) => {
        const btn = e.currentTarget
        Utils.closeModal()
        if (btn.dataset.status === 'active') {
          _deactivateEmployee(btn.dataset.id, btn.dataset.name)
        } else {
          _reactivateEmployee(btn.dataset.id, btn.dataset.name)
        }
      })
    }
  }

  /* ══════════════════════════════════════════════════════════
     EDIT EMPLOYEE MODAL (HR only)
  ══════════════════════════════════════════════════════════ */
  function _openEditModal(empId) {
    const emp = _employees.find(e => e.id === empId)
    if (!emp) return

    const deptOptions = _departments.map(d =>
      `<option value="${Utils.escapeHtml(d.slug)}"${emp.department === d.slug ? ' selected' : ''}>
        ${Utils.escapeHtml(d.name)}
      </option>`
    ).join('')

    const mgrOptions = _employees
      .filter(e => e.id !== empId && e.status === 'active')
      .map(e =>
        `<option value="${e.id}"${emp.manager_id === e.id ? ' selected' : ''}>
          ${Utils.escapeHtml(e.name)}${e.designation ? ' — ' + Utils.escapeHtml(e.designation) : ''}
        </option>`
      ).join('')

    const roleOptions = ROLES.map(r =>
      `<option value="${r.value}"${emp.role === r.value ? ' selected' : ''}>${r.label}</option>`
    ).join('')

    const empTypeOptions = EMP_TYPES.map(t =>
      `<option value="${t.value}"${emp.employment_type === t.value ? ' selected' : ''}>${t.label}</option>`
    ).join('')

    const locationOptions = WORK_LOCATIONS.map(l =>
      `<option value="${l.value}"${emp.work_location === l.value ? ' selected' : ''}>${l.label}</option>`
    ).join('')

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Edit Employee — ${Utils.escapeHtml(emp.name)}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">${CLOSE_SVG}</button>
      </div>
      <div class="modal-body" style="max-height:70vh;overflow-y:auto;">
        <div id="ppl-edit-err" class="alert alert--danger" style="display:none;"></div>

        <!-- Profile Image -->
        <div class="form-group">
          <label class="form-label">Profile Image</label>
          ${emp.profile_image_url
            ? `<div style="margin-bottom:8px;">
                <img src="${Utils.escapeHtml(emp.profile_image_url)}" alt=""
                  style="width:60px;height:60px;border-radius:50%;object-fit:cover;">
               </div>`
            : ''}
          <input class="form-input" type="file" id="ppl-edit-img" accept="image/*">
          <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">
            Accepted: JPG, PNG, WEBP. Max 2MB.
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Full Name <span class="required">*</span></label>
            <input class="form-input" id="ppl-edit-name" value="${Utils.escapeHtml(emp.name)}">
          </div>
          <div class="form-group">
            <label class="form-label">Work Email <span style="font-size:11px;color:var(--text-muted);">(read-only)</span></label>
            <input class="form-input" id="ppl-edit-email" value="${Utils.escapeHtml(emp.email || '')}"
              readonly style="background:var(--surface-alt);cursor:not-allowed;">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Personal Email</label>
            <input class="form-input" type="email" id="ppl-edit-personal-email"
              value="${Utils.escapeHtml(emp.personal_email || '')}">
          </div>
          <div class="form-group">
            <label class="form-label">Phone</label>
            <input class="form-input" id="ppl-edit-phone"
              value="${Utils.escapeHtml(emp.phone_number || '')}">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Date of Birth</label>
            <input class="form-input" type="date" id="ppl-edit-dob"
              value="${emp.date_of_birth ? emp.date_of_birth.substring(0, 10) : ''}">
          </div>
          <div class="form-group">
            <label class="form-label">Designation</label>
            <input class="form-input" id="ppl-edit-designation"
              value="${Utils.escapeHtml(emp.designation || '')}">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Department</label>
            <select class="form-select" id="ppl-edit-dept">
              <option value="">— Select —</option>
              ${deptOptions}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Role</label>
            <select class="form-select" id="ppl-edit-role">
              ${roleOptions}
            </select>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Employment Type</label>
            <select class="form-select" id="ppl-edit-emp-type">
              <option value="">— Select —</option>
              ${empTypeOptions}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Work Location</label>
            <select class="form-select" id="ppl-edit-location">
              <option value="">— Select —</option>
              ${locationOptions}
            </select>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Joining Date</label>
            <input class="form-input" type="date" id="ppl-edit-joining"
              value="${emp.joining_date ? emp.joining_date.substring(0, 10) : ''}">
          </div>
          <div class="form-group">
            <label class="form-label">Reporting Manager</label>
            <select class="form-select" id="ppl-edit-manager">
              <option value="">— None —</option>
              ${mgrOptions}
            </select>
          </div>
        </div>

        <!-- Probation -->
        <div class="form-group">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="ppl-edit-probation-done"
              ${emp.probation_completed ? 'checked' : ''}>
            <span class="form-label" style="margin:0;">Probation Completed</span>
          </label>
        </div>
        <div class="form-group" id="ppl-edit-probation-date-wrap"
          style="display:${emp.probation_completed ? 'block' : 'none'};">
          <label class="form-label">Probation Completed Date</label>
          <input class="form-input" type="date" id="ppl-edit-probation-date"
            value="${emp.probation_completed_date ? emp.probation_completed_date.substring(0, 10) : ''}">
        </div>

        <!-- Emergency Contact -->
        <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;
            color:var(--text-muted);margin-bottom:12px;">Emergency Contact</div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Name</label>
              <input class="form-input" id="ppl-edit-ec-name"
                value="${Utils.escapeHtml(emp.emergency_contact_name || '')}">
            </div>
            <div class="form-group">
              <label class="form-label">Relationship</label>
              <input class="form-input" id="ppl-edit-ec-rel"
                value="${Utils.escapeHtml(emp.emergency_contact_relationship || '')}">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Phone</label>
            <input class="form-input" id="ppl-edit-ec-phone"
              value="${Utils.escapeHtml(emp.emergency_contact_phone || '')}">
          </div>
        </div>

      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="ppl-edit-save">Save Changes</button>
      </div>
    `, 'people-profile-modal')

    // Toggle probation date field
    document.getElementById('ppl-edit-probation-done')?.addEventListener('change', (e) => {
      const wrap = document.getElementById('ppl-edit-probation-date-wrap')
      if (wrap) wrap.style.display = e.target.checked ? 'block' : 'none'
    })

    document.getElementById('ppl-edit-save')?.addEventListener('click', () => _saveEditEmployee(empId))
  }

  async function _saveEditEmployee(empId) {
    const errEl   = document.getElementById('ppl-edit-err')
    const saveBtn = document.getElementById('ppl-edit-save')

    const name = document.getElementById('ppl-edit-name')?.value.trim()
    if (!name) {
      errEl.textContent   = 'Full name is required.'
      errEl.style.display = 'block'
      return
    }

    saveBtn.disabled    = true
    saveBtn.textContent = 'Saving…'
    errEl.style.display = 'none'

    let profileImageUrl = undefined

    // Handle profile image upload
    const imgInput = document.getElementById('ppl-edit-img')
    if (imgInput?.files?.[0]) {
      const file = imgInput.files[0]
      const ext  = file.name.split('.').pop().toLowerCase()
      const { error: uploadErr } = await Config.supabase.storage
        .from('employee-avatars')
        .upload(`${empId}.${ext}`, file, { upsert: true, contentType: file.type })
      if (uploadErr) {
        errEl.textContent   = 'Image upload failed: ' + uploadErr.message
        errEl.style.display = 'block'
        saveBtn.disabled    = false
        saveBtn.textContent = 'Save Changes'
        return
      }
      const { data: urlData } = Config.supabase.storage
        .from('employee-avatars')
        .getPublicUrl(`${empId}.${ext}`)
      profileImageUrl = urlData.publicUrl
    }

    const probationDone = document.getElementById('ppl-edit-probation-done')?.checked || false

    const payload = {
      name,
      personal_email:                  document.getElementById('ppl-edit-personal-email')?.value.trim() || null,
      phone_number:                    document.getElementById('ppl-edit-phone')?.value.trim()          || null,
      date_of_birth:                   document.getElementById('ppl-edit-dob')?.value                  || null,
      designation:                     document.getElementById('ppl-edit-designation')?.value.trim()    || null,
      department:                      document.getElementById('ppl-edit-dept')?.value                  || null,
      role:                            document.getElementById('ppl-edit-role')?.value                  || null,
      employment_type:                 document.getElementById('ppl-edit-emp-type')?.value              || null,
      work_location:                   document.getElementById('ppl-edit-location')?.value              || null,
      joining_date:                    document.getElementById('ppl-edit-joining')?.value               || null,
      manager_id:                      document.getElementById('ppl-edit-manager')?.value               || null,
      probation_completed:             probationDone,
      probation_completed_date:        probationDone
        ? (document.getElementById('ppl-edit-probation-date')?.value || null)
        : null,
      emergency_contact_name:          document.getElementById('ppl-edit-ec-name')?.value.trim()  || null,
      emergency_contact_relationship:  document.getElementById('ppl-edit-ec-rel')?.value.trim()   || null,
      emergency_contact_phone:         document.getElementById('ppl-edit-ec-phone')?.value.trim() || null,
    }

    if (profileImageUrl !== undefined) {
      payload.profile_image_url = profileImageUrl
    }

    const { error } = await API.updateEmployeeFull(empId, payload)

    saveBtn.disabled    = false
    saveBtn.textContent = 'Save Changes'

    if (error) {
      errEl.textContent   = error.message
      errEl.style.display = 'block'
      return
    }

    // Refresh local data
    const { data } = await API.getEmployeesFull()
    _employees = data || []

    Utils.closeModal()
    Utils.showToast('Employee updated successfully.', 'success')

    // Re-open profile modal with fresh data
    _openProfileModal(empId)
  }

  /* ══════════════════════════════════════════════════════════
     DEACTIVATE / REACTIVATE
  ══════════════════════════════════════════════════════════ */
  function _deactivateEmployee(empId, empName) {
    const directReports = _employees.filter(e => e.manager_id === empId)
    if (directReports.length > 0) {
      Utils.showToast(
        `Please reassign ${directReports.length} direct report(s) before deactivating.`,
        'error'
      )
      return
    }

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Deactivate Employee</h3>
        <button class="modal-close" onclick="Utils.closeModal()">${CLOSE_SVG}</button>
      </div>
      <div class="modal-body">
        <div class="alert alert--warning" style="margin-bottom:12px;">
          This will deactivate the employee's account. They will no longer be able to log in.
          Any assets assigned to them will be automatically unassigned.
        </div>
        <p style="font-size:14px;font-weight:600;color:var(--text);">
          Deactivate: ${Utils.escapeHtml(empName)}?
        </p>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--danger" id="ppl-deact-confirm">Deactivate</button>
      </div>
    `)

    document.getElementById('ppl-deact-confirm')?.addEventListener('click', async () => {
      const btn = document.getElementById('ppl-deact-confirm')
      btn.disabled    = true
      btn.textContent = 'Deactivating…'

      const { error: empErr } = await Config.supabase
        .from('employees')
        .update({ status: 'inactive' })
        .eq('id', empId)

      if (empErr) {
        Utils.showToast('Failed to deactivate employee.', 'error')
        btn.disabled    = false
        btn.textContent = 'Deactivate'
        return
      }

      await Config.supabase
        .from('assets')
        .update({ assigned_to: null, assigned_date: null, status: 'available' })
        .eq('assigned_to', empId)

      // Refresh data
      const { data } = await API.getEmployeesFull()
      _employees = data || []

      Utils.closeModal()
      Utils.showToast(`${empName} has been deactivated.`, 'success')
      _renderDirectoryTable()
    })
  }

  async function _reactivateEmployee(empId, empName) {
    const { error } = await Config.supabase
      .from('employees')
      .update({ status: 'active' })
      .eq('id', empId)

    if (error) {
      Utils.showToast('Failed to reactivate employee.', 'error')
      return
    }

    const { data } = await API.getEmployeesFull()
    _employees = data || []

    Utils.showToast(`${empName} has been reactivated.`, 'success')
    _renderDirectoryTable()
  }

  /* ══════════════════════════════════════════════════════════
     ORG CHART TAB
  ══════════════════════════════════════════════════════════ */
  async function _renderOrgChart() {
    const content = document.getElementById('ppl-content')
    if (!content) return

    content.className = 'page-loading'
    content.innerHTML = 'Loading org chart…'

    const { data: orgData, error } = await API.getOrgChart()
    if (error) {
      content.className = ''
      content.innerHTML = `<div class="empty-state"><h3>Failed to load org chart</h3>
        <p>${Utils.escapeHtml(error.message)}</p></div>`
      return
    }

    const nodes = orgData || []
    content.className = ''

    const deptOptions = _departments.map(d =>
      `<option value="${Utils.escapeHtml(d.slug)}">${Utils.escapeHtml(d.name)}</option>`
    ).join('')

    content.innerHTML = `
      <div class="section-card">
        <div class="section-card-header" style="padding-bottom:12px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <select class="form-select" id="ppl-org-dept" style="width:auto;height:38px;">
              <option value="">All Departments</option>
              ${deptOptions}
            </select>
          </div>
        </div>
        <div class="section-card-body" style="padding-top:0;">
          <div class="org-tree" id="ppl-org-tree"></div>
        </div>
      </div>
    `

    _renderOrgTree(nodes, '')

    document.getElementById('ppl-org-dept')?.addEventListener('change', () => {
      const dept = document.getElementById('ppl-org-dept')?.value || ''
      _renderOrgTree(nodes, dept)
    })
  }

  function _renderOrgTree(nodes, deptFilter) {
    const treeEl = document.getElementById('ppl-org-tree')
    if (!treeEl) return

    // Only show active employees who have completed their profile
    let visibleNodes = nodes.filter(n => n.status === 'active' && n.profile_completed !== false)

    // Filter by department if needed
    if (deptFilter) {
      // Keep nodes in selected dept AND their ancestors (to preserve hierarchy context)
      const inDept  = new Set(visibleNodes.filter(n => n.department === deptFilter).map(n => n.id))
      const visible = new Set(inDept)
      // Walk up manager chain to include ancestors
      visibleNodes.forEach(n => {
        if (inDept.has(n.id)) {
          let parentId = n.manager_id
          while (parentId) {
            visible.add(parentId)
            const parent = visibleNodes.find(p => p.id === parentId)
            parentId = parent?.manager_id || null
          }
        }
      })
      visibleNodes = visibleNodes.filter(n => visible.has(n.id))
    }

    const roots = visibleNodes.filter(n => !n.manager_id || !visibleNodes.find(p => p.id === n.manager_id))

    if (!roots.length) {
      treeEl.innerHTML = `<div class="empty-state"><h3>No employees found</h3><p>Adjust filters.</p></div>`
      return
    }

    treeEl.innerHTML = `
      <div class="org-chart-wrap">
        <ul class="org-tree-level org-tree-level--root">
          ${roots.map(root => _buildOrgNodeHtml(root, visibleNodes)).join('')}
        </ul>
      </div>
    `

    treeEl.querySelectorAll('.org-card').forEach(node => {
      node.addEventListener('click', () => _openProfileModal(node.dataset.id))
    })
  }

  function _buildOrgNodeHtml(node, allNodes) {
    const children = allNodes.filter(n => n.manager_id === node.id)
    const initials  = Utils.getInitials(node.name)
    const avatarHtml = node.profile_image_url
      ? `<img src="${Utils.escapeHtml(node.profile_image_url)}" alt=""
           style="width:100%;height:100%;object-fit:cover;">`
      : `<span>${initials}</span>`

    return `
      <li class="org-tree-item">
        <div class="org-card" data-id="${node.id}">
          <div class="org-card-photo">
            ${avatarHtml}
          </div>
          <div class="org-card-name">${Utils.escapeHtml(node.name)}</div>
          <div class="org-card-designation">${Utils.escapeHtml(node.designation || '—')}</div>
          <span class="dept-badge">${Utils.getDeptLabel(node.department)}</span>
        </div>
        ${children.length ? `
          <ul class="org-tree-level">
            ${children.map(child => _buildOrgNodeHtml(child, allNodes)).join('')}
          </ul>
        ` : ''}
      </li>
    `
  }

  /* ══════════════════════════════════════════════════════════
     INVITE / ADD EMPLOYEE TAB (HR only)
  ══════════════════════════════════════════════════════════ */
  function _renderInvitePanel() {
    const content = document.getElementById('ppl-content')
    if (!content) return
    content.className = ''

    if (!_canManage) {
      content.innerHTML = App.renderAccessDenied('Add Employee')
      return
    }

    const deptOptions = _departments.map(d =>
      `<option value="${Utils.escapeHtml(d.slug)}">${Utils.escapeHtml(d.name)}</option>`
    ).join('')

    const mgrOptions = _employees
      .filter(e => e.status === 'active')
      .map(e =>
        `<option value="${e.id}">${Utils.escapeHtml(e.name)}${e.designation ? ' — ' + Utils.escapeHtml(e.designation) : ''}</option>`
      ).join('')

    const roleOptions = ROLES.map(r =>
      `<option value="${r.value}">${r.label}</option>`
    ).join('')

    const empTypeOptions = EMP_TYPES.map(t =>
      `<option value="${t.value}">${t.label}</option>`
    ).join('')

    const locationOptions = WORK_LOCATIONS.map(l =>
      `<option value="${l.value}">${l.label}</option>`
    ).join('')

    content.innerHTML = `
      <div class="section-card">
        <div class="section-card-header">
          <h3>Add New Employee</h3>
        </div>
        <div class="section-card-body" style="max-width:680px;">
          <p style="font-size:13px;color:var(--text-muted);margin-bottom:20px;">
            Create the employee account directly. Set a temporary password they can change after first login.
          </p>

          <div id="ppl-inv-err" class="alert alert--danger" style="display:none;"></div>
          <div id="ppl-inv-success" class="alert alert--success" style="display:none;"></div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Full Name <span class="required">*</span></label>
              <input class="form-input" id="ppl-inv-name" placeholder="e.g. Priya Sharma">
            </div>
            <div class="form-group">
              <label class="form-label">Work Email <span class="required">*</span></label>
              <input class="form-input" type="email" id="ppl-inv-email"
                placeholder="name@thegrowthic.com">
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Temporary Password <span class="required">*</span></label>
              <input class="form-input" type="password" id="ppl-inv-password"
                placeholder="Min. 8 characters">
            </div>
            <div class="form-group">
              <label class="form-label">Confirm Password <span class="required">*</span></label>
              <input class="form-input" type="password" id="ppl-inv-confirm-password"
                placeholder="Min. 8 characters">
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Personal Email</label>
              <input class="form-input" type="email" id="ppl-inv-personal-email"
                placeholder="personal@email.com">
            </div>
            <div class="form-group">
              <label class="form-label">Phone</label>
              <input class="form-input" id="ppl-inv-phone" placeholder="+91 98765 43210">
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Date of Birth</label>
              <input class="form-input" type="date" id="ppl-inv-dob">
            </div>
            <div class="form-group">
              <label class="form-label">Designation <span class="required">*</span></label>
              <input class="form-input" id="ppl-inv-designation" placeholder="e.g. Content Strategist">
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Department <span class="required">*</span></label>
              <select class="form-select" id="ppl-inv-dept">
                <option value="">— Select department —</option>
                ${deptOptions}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Role <span class="required">*</span></label>
              <select class="form-select" id="ppl-inv-role">
                <option value="">— Select role —</option>
                ${roleOptions}
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Employment Type <span class="required">*</span></label>
              <select class="form-select" id="ppl-inv-emp-type">
                <option value="">— Select —</option>
                ${empTypeOptions}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Work Location <span class="required">*</span></label>
              <select class="form-select" id="ppl-inv-location">
                <option value="">— Select —</option>
                ${locationOptions}
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Joining Date <span class="required">*</span></label>
              <input class="form-input" type="date" id="ppl-inv-joining">
            </div>
            <div class="form-group">
              <label class="form-label">Reporting Manager</label>
              <select class="form-select" id="ppl-inv-manager">
                <option value="">— None —</option>
                ${mgrOptions}
              </select>
            </div>
          </div>

          <!-- Emergency Contact -->
          <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;
              color:var(--text-muted);margin-bottom:12px;">Emergency Contact</div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Name</label>
                <input class="form-input" id="ppl-inv-ec-name" placeholder="Contact name">
              </div>
              <div class="form-group">
                <label class="form-label">Relationship</label>
                <input class="form-input" id="ppl-inv-ec-rel" placeholder="e.g. Spouse">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Phone</label>
              <input class="form-input" id="ppl-inv-ec-phone" placeholder="+91 98765 43210">
            </div>
          </div>

          <div style="margin-top:20px;">
            <button class="btn btn--primary" id="ppl-inv-submit">Add Employee</button>
          </div>
        </div>
      </div>
    `

    document.getElementById('ppl-inv-submit')?.addEventListener('click', _submitInvite)
  }

  async function _submitInvite() {
    const errEl     = document.getElementById('ppl-inv-err')
    const successEl = document.getElementById('ppl-inv-success')
    const submitBtn = document.getElementById('ppl-inv-submit')

    errEl.style.display     = 'none'
    successEl.style.display = 'none'

    const name            = document.getElementById('ppl-inv-name')?.value.trim()
    const email           = document.getElementById('ppl-inv-email')?.value.trim()
    const password        = document.getElementById('ppl-inv-password')?.value
    const confirmPassword = document.getElementById('ppl-inv-confirm-password')?.value
    const designation     = document.getElementById('ppl-inv-designation')?.value.trim()
    const department      = document.getElementById('ppl-inv-dept')?.value
    const role            = document.getElementById('ppl-inv-role')?.value
    const employment_type = document.getElementById('ppl-inv-emp-type')?.value
    const work_location   = document.getElementById('ppl-inv-location')?.value
    const joining_date    = document.getElementById('ppl-inv-joining')?.value
    const manager_id      = document.getElementById('ppl-inv-manager')?.value               || null
    const personal_email  = document.getElementById('ppl-inv-personal-email')?.value.trim() || null
    const phone_number    = document.getElementById('ppl-inv-phone')?.value.trim()          || null
    const date_of_birth   = document.getElementById('ppl-inv-dob')?.value                   || null
    const emergency_contact_name         = document.getElementById('ppl-inv-ec-name')?.value.trim()  || null
    const emergency_contact_relationship = document.getElementById('ppl-inv-ec-rel')?.value.trim()   || null
    const emergency_contact_phone        = document.getElementById('ppl-inv-ec-phone')?.value.trim() || null

    const missing = []
    if (!name)            missing.push('Full Name')
    if (!email)           missing.push('Work Email')
    if (!password)        missing.push('Temporary Password')
    if (!designation)     missing.push('Designation')
    if (!department)      missing.push('Department')
    if (!role)            missing.push('Role')
    if (!employment_type) missing.push('Employment Type')
    if (!work_location)   missing.push('Work Location')
    if (!joining_date)    missing.push('Joining Date')

    if (missing.length) {
      errEl.textContent   = `Please fill in required fields: ${missing.join(', ')}.`
      errEl.style.display = 'block'
      return
    }

    if (password.length < 8) {
      errEl.textContent   = 'Password must be at least 8 characters.'
      errEl.style.display = 'block'
      return
    }

    if (password !== confirmPassword) {
      errEl.textContent   = 'Passwords do not match.'
      errEl.style.display = 'block'
      return
    }

    submitBtn.disabled    = true
    submitBtn.textContent = 'Adding employee…'

    const result = await API.createEmployee({
      name,
      email,
      password,
      designation,
      department,
      role,
      employment_type,
      work_location,
      joining_date,
      manager_id,
      personal_email,
      phone_number,
      date_of_birth,
      emergency_contact_name,
      emergency_contact_relationship,
      emergency_contact_phone,
    })

    submitBtn.disabled    = false
    submitBtn.textContent = 'Add Employee'

    if (result.error) {
      errEl.textContent   = result.error.message || 'Failed to create employee. Please try again.'
      errEl.style.display = 'block'
      return
    }

    successEl.textContent   = 'Employee added successfully. They can now log in with the provided password.'
    successEl.style.display = 'block'

    // Reset form
    ;[
      'ppl-inv-name', 'ppl-inv-email', 'ppl-inv-password', 'ppl-inv-confirm-password',
      'ppl-inv-personal-email', 'ppl-inv-phone', 'ppl-inv-dob', 'ppl-inv-designation',
      'ppl-inv-joining', 'ppl-inv-ec-name', 'ppl-inv-ec-rel', 'ppl-inv-ec-phone',
    ].forEach(id => {
      const el = document.getElementById(id)
      if (el) el.value = ''
    })
    ;['ppl-inv-dept', 'ppl-inv-role', 'ppl-inv-emp-type', 'ppl-inv-location', 'ppl-inv-manager'].forEach(id => {
      const el = document.getElementById(id)
      if (el) el.selectedIndex = 0
    })

    // Reload employees list and re-resolve manager names
    const { data } = await API.getEmployeesFull()
    _employees = data || []
    const _empById = Object.fromEntries(_employees.map(e => [e.id, e]))
    _employees.forEach(e => {
      e._managerName = e.manager?.name || (e.manager_id && _empById[e.manager_id]?.name) || null
    })
  }

  /* ── Label helpers ──────────────────────────────────────── */
  function _empTypeLabel(val) {
    const found = EMP_TYPES.find(t => t.value === val)
    return found ? found.label : (val || '—')
  }

  function _workLocationLabel(val) {
    const found = WORK_LOCATIONS.find(l => l.value === val)
    return found ? found.label : (val || '—')
  }

  return { render, init }
})()

ModuleRegistry.register({
  key:       'people_hrms',
  routeId:   'people',
  label:     'People & HRMS',
  order:     8,
  icon:      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`,
  getModule: () => People,
  features:  {
    view_employees:   'View Employees',
    manage_employees: 'Manage Employees (edit/deactivate)',
    invite_employee:  'Invite New Employee',
    manage_access:    'Manage Access Control',
  },
})
