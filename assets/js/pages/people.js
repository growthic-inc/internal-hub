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
  let _empBadgeMap = {}   // employeeId → [{ name, icon, colour, category }]
  let _activeTab   = 'directory'

  /* ── Constants ─────────────────────────────────────────── */
  const ROLES = [
    { value: 'employee',   label: 'Employee' },
    { value: 'super_admin', label: 'Super Admin' },
  ]

  // Types shown in the ADD form (new hires only)
  const EMP_TYPES = [
    { value: 'full_time', label: 'Full Time' },
    { value: 'intern',    label: 'Intern' },
  ]
  // All types including legacy values — used for edit modal dropdowns and display labels
  const EMP_TYPES_ALL = [
    { value: 'full_time',  label: 'Full Time' },
    { value: 'intern',     label: 'Intern' },
    { value: 'part_time',  label: 'Part Time' },
    { value: 'freelancer', label: 'Freelancer' },
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
    const canManage = App.hasAccess('people_hrms', 'manage_employees', 'can_manage')
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
    _canManage = App.hasAccess('people_hrms', 'manage_employees', 'can_manage')

    const [empRes, deptRes, badgeRes] = await Promise.all([
      API.getEmployeesFull(),
      API.getDepartments(),
      API.getAllEmployeeBadgeSummary(),
    ])
    _employees   = empRes.data   || []
    _departments = deptRes.data  || []

    // Build badge lookup map — sort by sort_order so tenure comes first
    _empBadgeMap = {}
    ;(badgeRes.data || []).forEach(row => {
      if (!row.badge) return
      if (!_empBadgeMap[row.employee_id]) _empBadgeMap[row.employee_id] = []
      _empBadgeMap[row.employee_id].push(row.badge)
    })
    Object.values(_empBadgeMap).forEach(arr =>
      arr.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    )

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
            <!-- <th>Employee ID</th> TODO: unhide once ID generation is fixed -->
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
              <!-- <td class="text-sm text-muted">${Utils.escapeHtml(e.employee_id || '—')}</td> TODO: unhide once ID generation is fixed -->
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
                  <div>
                    <strong>${Utils.escapeHtml(e.name)}</strong>
                    ${(() => {
                      const badges = _empBadgeMap[e.id] || []
                      if (!badges.length) return ''
                      const shown = badges.slice(0, 4)
                      const extra = badges.length - shown.length
                      return `<div class="dir-badge-row">
                        ${shown.map(b => `<span class="dir-badge-icon" title="${Utils.escapeHtml(b.name)}" style="color:${b.colour || '#0F4799'};">${b.icon}</span>`).join('')}
                        ${extra > 0 ? `<span class="dir-badge-more">+${extra}</span>` : ''}
                      </div>`
                    })()}
                  </div>
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

  function _kycDocRow(icon, label, url) {
    if (url) {
      return `
        <a href="${Utils.escapeHtml(url)}" target="_blank" rel="noopener noreferrer"
           style="display:flex;align-items:center;gap:8px;padding:9px 12px;
                  border:1px solid var(--border);border-radius:7px;
                  font-size:12px;color:var(--primary);text-decoration:none;
                  transition:background 0.12s;"
           onmouseover="this.style.background='var(--surface)'"
           onmouseout="this.style.background=''">
          <span style="font-size:15px;">${icon}</span>
          <span style="font-weight:500;flex:1;">${label}</span>
          <span style="font-size:10px;color:var(--text-muted);">View ↗</span>
        </a>`
    }
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:9px 12px;
                  border:1px dashed var(--border);border-radius:7px;
                  font-size:12px;color:var(--text-muted);">
        <span style="font-size:15px;">${icon}</span>
        <span style="flex:1;">${label}</span>
        <span style="font-size:10px;">Not uploaded</span>
      </div>`
  }

  async function _showProfileView(emp) {
    const isActive   = emp.status === 'active'
    const avatarHtml = emp.profile_image_url
      ? `<img src="${Utils.escapeHtml(emp.profile_image_url)}" alt="" style="width:100%;height:100%;object-fit:cover;">`
      : `<span style="font-size:26px;font-weight:700;">${Utils.getInitials(emp.name)}</span>`

    // Tenure since joining date
    const tenure = (() => {
      if (!emp.joining_date) return null
      const start = new Date(emp.joining_date)
      const now   = new Date()
      const totalMonths = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
      const years  = Math.floor(totalMonths / 12)
      const months = totalMonths % 12
      if (totalMonths < 1) return 'New joiner'
      if (years === 0) return `${months}mo`
      return months === 0 ? `${years}yr` : `${years}yr ${months}mo`
    })()

    // Can this viewer award badges?
    const _canAwardBadge = _canManage || (_user && emp.manager_id === _user.id)

    // Fetch badges + KYC in parallel
    const [{ data: empBadges }, kycRes] = await Promise.all([
      API.getEmployeeBadges(emp.id),
      _canManage ? API.getEmployeeKyc(emp.id) : Promise.resolve({ data: null }),
    ])
    const kyc = kycRes?.data || {}

    const badgeChips = (empBadges || []).map(eb => {
      const b = eb.badge || {}
      const colour   = b.colour || '#0F4799'
      const awardedBy = eb.awarder?.name ? ` · Awarded by ${eb.awarder.name}` : ''
      const note      = eb.note ? ` — "${eb.note}"` : ''
      return `
        <div class="badge-chip badge-chip--${b.category || 'recognition'}"
             style="--badge-bg:${colour}18;--badge-text:${colour};--badge-border:${colour}40;"
             title="${Utils.escapeHtml((b.description || '') + awardedBy + note)}">
          <span class="badge-chip-icon">${b.icon || '🏅'}</span>
          <span class="badge-chip-name">${Utils.escapeHtml(b.name || '')}</span>
        </div>`
    }).join('')

    // Quick stat cell helper
    const _stat = (icon, label, value) => `
      <div style="padding:14px 10px;text-align:center;">
        <div style="font-size:18px;line-height:1;margin-bottom:4px;">${icon}</div>
        <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-muted);margin-bottom:3px;">${label}</div>
        <div style="font-size:12px;font-weight:500;color:var(--text);">${value}</div>
      </div>`

    // Section header helper
    const _sec = label => `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:var(--text-muted);margin-bottom:12px;">${label}</div>`

    Utils.openModal(`
      <div class="modal-body" style="padding:0;">

        <!-- ── Hero ──────────────────────────────────────────── -->
        <div style="background:linear-gradient(135deg,#0F4799 0%,#1a72c7 100%);
          padding:28px 24px 24px;text-align:center;position:relative;">
          <button class="modal-close" onclick="Utils.closeModal()"
            style="position:absolute;top:12px;right:12px;background:rgba(255,255,255,0.15);
              border:none;border-radius:6px;width:28px;height:28px;display:flex;align-items:center;
              justify-content:center;cursor:pointer;color:#fff;">${CLOSE_SVG}</button>

          <!-- Avatar -->
          <div style="width:88px;height:88px;border-radius:50%;background:var(--primary-light);
            color:var(--primary);display:flex;align-items:center;justify-content:center;
            overflow:hidden;margin:0 auto 14px;border:3px solid rgba(255,255,255,0.85);
            box-shadow:0 4px 16px rgba(0,0,0,0.25);">
            ${avatarHtml}
          </div>

          <div style="font-size:20px;font-weight:700;color:#fff;line-height:1.2;">${Utils.escapeHtml(emp.name)}</div>
          <div style="font-size:13px;color:rgba(255,255,255,0.75);margin-top:4px;">${Utils.escapeHtml(emp.designation || '—')}</div>

          <!-- Pills -->
          <div style="display:flex;align-items:center;justify-content:center;gap:6px;margin-top:12px;flex-wrap:wrap;">
            ${emp.department ? `<span style="background:rgba(255,255,255,0.18);color:#fff;font-size:11px;font-weight:600;padding:3px 10px;border-radius:99px;backdrop-filter:blur(4px);">${Utils.getDeptLabel(emp.department)}</span>` : ''}
            ${tenure ? `<span style="background:rgba(255,255,255,0.18);color:#fff;font-size:11px;font-weight:600;padding:3px 10px;border-radius:99px;">⏱ ${tenure}</span>` : ''}
            <span style="background:${isActive ? 'rgba(29,158,117,0.35)' : 'rgba(239,68,68,0.35)'};
              color:${isActive ? '#6ee7b7' : '#fca5a5'};font-size:11px;font-weight:600;
              padding:3px 10px;border-radius:99px;">
              ${isActive ? '● Active' : '● Inactive'}
            </span>
          </div>
        </div>

        <!-- ── Quick Stats ────────────────────────────────────── -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid var(--border);background:var(--surface);">
          <div style="border-right:1px solid var(--border);">
            ${_stat('💼', 'Type', _empTypeLabel(emp.employment_type))}
          </div>
          <div style="border-right:1px solid var(--border);">
            ${_stat('🏢', 'Location', _workLocationLabel(emp.work_location))}
          </div>
          <div style="border-right:1px solid var(--border);">
            ${_stat('📅', 'Joined', Utils.formatDate(emp.joining_date))}
          </div>
          <div>
            ${_stat('👤', 'Manager', emp.manager ? Utils.escapeHtml(emp.manager.name) : '—')}
          </div>
        </div>

        <!-- ── Badges ─────────────────────────────────────────── -->
        <div style="padding:16px 24px;border-bottom:1px solid var(--border);">
          ${_sec(`Badges${empBadges?.length ? ` (${empBadges.length})` : ''}`)}
          ${badgeChips
            ? `<div class="badge-chip-row">${badgeChips}</div>`
            : `<p style="font-size:13px;color:var(--text-muted);margin:0;">No badges yet.</p>`}
          ${_canAwardBadge ? `
            <button class="btn btn--ghost btn--sm" id="ppl-award-badge-btn"
              data-emp-id="${emp.id}" data-emp-name="${Utils.escapeHtml(emp.name)}"
              style="margin-top:10px;font-size:12px;">🏅 Award a Badge</button>` : ''}
        </div>

        <!-- ── Contact ────────────────────────────────────────── -->
        <div style="padding:16px 24px;border-bottom:1px solid var(--border);">
          ${_sec('Contact')}
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
            <div class="people-field">
              <div class="people-field-label">Work Email</div>
              <div class="people-field-value">
                ${emp.email ? `<a href="mailto:${Utils.escapeHtml(emp.email)}" style="color:var(--primary);text-decoration:none;">${Utils.escapeHtml(emp.email)}</a>` : '—'}
              </div>
            </div>
            <div class="people-field">
              <div class="people-field-label">Personal Email</div>
              <div class="people-field-value">
                ${emp.personal_email ? `<a href="mailto:${Utils.escapeHtml(emp.personal_email)}" style="color:var(--primary);text-decoration:none;">${Utils.escapeHtml(emp.personal_email)}</a>` : '—'}
              </div>
            </div>
            <div class="people-field">
              <div class="people-field-label">Phone</div>
              <div class="people-field-value">
                ${emp.phone_number ? `<a href="tel:${Utils.escapeHtml(emp.phone_number)}" style="color:var(--primary);text-decoration:none;">${Utils.escapeHtml(emp.phone_number)}</a>` : '—'}
              </div>
            </div>
            ${emp.linkedin_url ? `
            <div class="people-field">
              <div class="people-field-label">LinkedIn</div>
              <div class="people-field-value">
                <a href="${Utils.escapeHtml(emp.linkedin_url)}" target="_blank" rel="noopener" style="color:var(--primary);text-decoration:none;">View Profile →</a>
              </div>
            </div>` : ''}
          </div>
        </div>

        <!-- ── Personal ───────────────────────────────────────── -->
        <div style="padding:16px 24px;border-bottom:1px solid var(--border);">
          ${_sec('Personal')}
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
            <div class="people-field">
              <div class="people-field-label">Date of Birth</div>
              <div class="people-field-value">${Utils.formatDate(emp.date_of_birth)}</div>
            </div>
            <div class="people-field">
              <div class="people-field-label">Probation</div>
              <div class="people-field-value">
                ${emp.probation_completed
                  ? `<span style="color:var(--success);">✓ Completed${emp.probation_completed_date ? ' · ' + Utils.formatDate(emp.probation_completed_date) : ''}</span>`
                  : 'Ongoing'}
              </div>
            </div>

            <div class="people-field">
              <div class="people-field-label">Status</div>
              <div class="people-field-value">
                ${isActive
                  ? '<span class="badge badge--success">Active</span>'
                  : '<span class="badge badge--danger">Inactive</span>'}</div>
            </div>
          </div>
        </div>

        <!-- ── Emergency Contact ──────────────────────────────── -->
        <div style="padding:16px 24px;${_canManage ? 'border-bottom:1px solid var(--border);' : ''}">
          ${_sec('Emergency Contact')}
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;">
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

        ${_canManage ? `
        <!-- ── KYC Documents (HR / Super Admin only) ──────────── -->
        <div style="padding:16px 24px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
            ${_sec('KYC Documents')}
            ${kyc.kyc_submitted_at
              ? `<span style="font-size:11px;color:var(--success);font-weight:500;margin-bottom:12px;">✓ Submitted ${Utils.formatDate(kyc.kyc_submitted_at)}</span>`
              : `<span style="font-size:11px;color:var(--text-muted);margin-bottom:12px;">Not yet submitted</span>`}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            ${_kycDocRow('🪪', 'Aadhaar Card',  kyc.kyc_aadhar_url)}
            ${_kycDocRow('🏷️', 'PAN Card',      kyc.kyc_pan_url)}
            ${_kycDocRow('📘', 'Passport',       kyc.kyc_passport_url)}
            ${_kycDocRow('🖼️', 'Passport Photo', kyc.kyc_passport_photo_url)}
          </div>
        </div>` : ''}

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

    // Award Badge button — visible to HR or direct manager
    document.getElementById('ppl-award-badge-btn')?.addEventListener('click', () => {
      _openAwardBadgeModal(emp)
    })
  }

  /* ── Award Badge Modal ──────────────────────────────────── */

  async function _openAwardBadgeModal(emp) {
    const { data: allBadges } = await API.getBadges()
    const { data: existing }  = await API.getEmployeeBadges(emp.id)
    const existingIds = new Set((existing || []).map(eb => eb.badge_id))

    // Only show manual recognition badges; exclude already-earned ones
    const catalogue = (allBadges || []).filter(b => b.criteria_type === 'manual' && !existingIds.has(b.id))

    const catalogueHtml = catalogue.length
      ? catalogue.map(b => `
          <div class="badge-catalogue-item" data-badge-id="${b.id}" data-badge-name="${Utils.escapeHtml(b.name)}" data-badge-icon="${b.icon}">
            <span class="badge-catalogue-icon">${b.icon}</span>
            <div class="badge-catalogue-info">
              <div class="badge-catalogue-name">${Utils.escapeHtml(b.name)}</div>
              <div class="badge-catalogue-desc">${Utils.escapeHtml(b.description || '')}</div>
            </div>
          </div>`).join('')
      : `<p style="font-size:13px;color:var(--text-muted);grid-column:1/-1;">
           ${emp.name.split(' ')[0]} already has all available recognition badges!
         </p>`

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Award a Badge — ${Utils.escapeHtml(emp.name)}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">${CLOSE_SVG}</button>
      </div>
      <div class="modal-body" style="padding:20px 24px;display:flex;flex-direction:column;gap:16px;">
        <div id="award-badge-error" class="alert alert-danger" style="display:none;"></div>

        <div>
          <div style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;
            letter-spacing:0.05em;margin-bottom:10px;">Pick a badge</div>
          <div class="badge-catalogue-grid" id="badge-catalogue-grid">
            ${catalogueHtml}
          </div>
        </div>

        <div>
          <label class="form-label" for="award-badge-note">Add a note <span style="font-weight:400;color:var(--text-muted);">(optional)</span></label>
          <textarea class="form-textarea" id="award-badge-note" rows="2"
            placeholder="e.g. Nailed the Q2 client sprint — real team player."></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="award-badge-submit-btn" disabled>Award Badge</button>
      </div>
    `, 'award-badge-modal')

    let selectedBadgeId = null
    const submitBtn = document.getElementById('award-badge-submit-btn')
    const errEl     = document.getElementById('award-badge-error')

    // Badge selection
    document.getElementById('badge-catalogue-grid')?.addEventListener('click', (e) => {
      const item = e.target.closest('.badge-catalogue-item')
      if (!item) return
      document.querySelectorAll('.badge-catalogue-item').forEach(el => el.classList.remove('selected'))
      item.classList.add('selected')
      selectedBadgeId = item.dataset.badgeId
      submitBtn.disabled = false
      submitBtn.textContent = `Award ${item.dataset.badgeIcon} ${item.dataset.badgeName}`
    })

    submitBtn.addEventListener('click', async () => {
      if (!selectedBadgeId) return
      errEl.style.display = 'none'
      submitBtn.disabled    = true
      submitBtn.textContent = 'Awarding…'

      const note = document.getElementById('award-badge-note')?.value.trim() || null
      const badge = allBadges.find(b => b.id === selectedBadgeId)

      const { data: awarded, error } = await API.awardBadge({
        employee_id: emp.id,
        badge_id:    selectedBadgeId,
        awarded_by:  _user.id,
        note,
      })

      if (error) {
        errEl.textContent   = error.message || 'Failed to award badge. Please try again.'
        errEl.style.display = 'block'
        submitBtn.disabled    = false
        submitBtn.textContent = `Award ${badge?.icon} ${badge?.name}`
        return
      }

      // In-app notification to recipient
      API.createNotification({
        recipient_employee_id: emp.id,
        type:      'success',
        message:   `🎉 You earned the "${badge?.name}" badge!${note ? ` "${note}"` : ''}`,
        module:    'badges',
        record_id: awarded?.id || null,
      }).catch(() => {})

      // Post to announcements feed
      const firstName  = emp.name.split(' ')[0]
      const awardedByName = _user?.name || 'Management'
      const annTitle   = `${badge?.icon || '🏅'} ${emp.name} earned the "${badge?.name}" badge!`
      const annContent = `${awardedByName} awarded the "${badge?.name}" badge to ${firstName}. ${badge?.description || ''}${note ? `\n\n"${note}"` : ''}`

      API.createAnnouncement({
        title:      annTitle,
        content:    annContent,
        published:  true,
        created_by: _user.id,
      }).catch(() => {})

      Utils.closeModal()
      Utils.showToast(`🎉 Badge awarded to ${emp.name}!`, 'success')
    })
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

    // Use EMP_TYPES_ALL in the edit modal so existing employees with legacy
    // employment types (part_time, freelancer, probation) still show correctly
    const empTypeOptions = EMP_TYPES_ALL.map(t =>
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
        <div class="org-tree-center">
          <ul class="org-tree-level org-tree-level--root">
            ${roots.map(root => _buildOrgNodeHtml(root, visibleNodes)).join('')}
          </ul>
        </div>
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
          <p style="font-size:13px;color:var(--text-muted);margin-bottom:20px;line-height:1.6;">
            Create the employee's account. They'll receive login credentials and be prompted to complete their profile on first sign-in.
          </p>

          <div id="ppl-inv-err" class="alert alert--danger" style="display:none;"></div>
          <div id="ppl-inv-success" class="alert alert--success" style="display:none;"></div>

          <!-- Account credentials -->
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);margin-bottom:12px;">Account</div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Full Name <span class="required">*</span></label>
              <input class="form-input" id="ppl-inv-name" placeholder="e.g. Priya Sharma">
            </div>
            <div class="form-group">
              <label class="form-label">Work Email <span class="required">*</span></label>
              <input class="form-input" type="email" id="ppl-inv-email" placeholder="name@thegrowthic.com">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Temporary Password <span class="required">*</span></label>
              <input class="form-input" type="password" id="ppl-inv-password" placeholder="Min. 8 characters">
            </div>
            <div class="form-group">
              <label class="form-label">Confirm Password <span class="required">*</span></label>
              <input class="form-input" type="password" id="ppl-inv-confirm-password" placeholder="Min. 8 characters">
            </div>
          </div>

          <!-- Role & organisation -->
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);margin:20px 0 12px;">Role & Organisation</div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Designation <span class="required">*</span></label>
              <input class="form-input" id="ppl-inv-designation" placeholder="e.g. Content Strategist">
            </div>
            <div class="form-group">
              <label class="form-label">Department <span class="required">*</span></label>
              <select class="form-select" id="ppl-inv-dept">
                <option value="">— Select department —</option>
                ${deptOptions}
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Reporting Manager <span class="required">*</span></label>
              <select class="form-select" id="ppl-inv-manager">
                <option value="">— None —</option>
                ${mgrOptions}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Employment Type <span class="required">*</span></label>
              <select class="form-select" id="ppl-inv-emp-type">
                <option value="">— Select —</option>
                ${empTypeOptions}
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Joining Date <span class="required">*</span></label>
              <input class="form-input" type="date" id="ppl-inv-joining">
            </div>
            <div class="form-group">
              <label class="form-label">Work Location <span class="required">*</span></label>
              <select class="form-select" id="ppl-inv-location">
                <option value="">— Select —</option>
                ${locationOptions}
              </select>
            </div>
          </div>

          <div style="margin-top:24px;">
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
    const employment_type = document.getElementById('ppl-inv-emp-type')?.value
    const work_location   = document.getElementById('ppl-inv-location')?.value
    const joining_date    = document.getElementById('ppl-inv-joining')?.value
    const manager_id      = document.getElementById('ppl-inv-manager')?.value || null

    const missing = []
    if (!name)            missing.push('Full Name')
    if (!email)           missing.push('Work Email')
    if (!password)        missing.push('Temporary Password')
    if (!designation)     missing.push('Designation')
    if (!department)      missing.push('Department')
    if (!manager_id)      missing.push('Reporting Manager')
    if (!employment_type) missing.push('Employment Type')
    if (!work_location)   missing.push('Work Location')
    if (!joining_date)    missing.push('Joining Date')

    if (missing.length) {
      errEl.textContent   = `Please fill in: ${missing.join(', ')}.`
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
      role: 'employee',   // always employee — role changes are SQL-only
      employment_type,
      work_location,
      joining_date,
      manager_id,
    })

    submitBtn.disabled    = false
    submitBtn.textContent = 'Add Employee'

    if (result.error) {
      errEl.textContent   = result.error.message || 'Failed to create employee. Please try again.'
      errEl.style.display = 'block'
      return
    }

    successEl.textContent   = `${name} has been added. Share their login credentials and ask them to sign in and complete their profile.`
    successEl.style.display = 'block'

    // Reset form fields
    ;['ppl-inv-name', 'ppl-inv-email', 'ppl-inv-password', 'ppl-inv-confirm-password', 'ppl-inv-designation', 'ppl-inv-joining'].forEach(id => {
      const el = document.getElementById(id)
      if (el) el.value = ''
    })
    ;['ppl-inv-dept', 'ppl-inv-emp-type', 'ppl-inv-location', 'ppl-inv-manager'].forEach(id => {
      const el = document.getElementById(id)
      if (el) el.selectedIndex = 0
    })

    // Refresh employees list
    const { data } = await API.getEmployeesFull()
    _employees = data || []
    const _empById = Object.fromEntries(_employees.map(e => [e.id, e]))
    _employees.forEach(e => {
      e._managerName = e.manager?.name || (e.manager_id && _empById[e.manager_id]?.name) || null
    })
  }

  /* ── Label helpers ──────────────────────────────────────── */
  function _empTypeLabel(val) {
    const found = EMP_TYPES_ALL.find(t => t.value === val)
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
