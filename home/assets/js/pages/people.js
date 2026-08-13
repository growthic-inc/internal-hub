/* ============================================================
   PEOPLE — Directory, Org Chart, Invite / Add Employee
   Phase 7 — Growthic One
   ============================================================ */

const People = (() => {

  /* ── Module state ──────────────────────────────────────── */
  let _user        = null
  let _employees   = []
  let _departments = []
  let _empBadgeMap = {}   // employeeId → [{ name, icon, colour, category }]
  let _activeTab   = 'directory'

  /* ── Constants ─────────────────────────────────────────── */
  const ROLES = [
    { value: 'employee',   label: 'Employee' },
    { value: 'admin',      label: 'Admin' },
    { value: 'super_admin', label: 'Super Admin' },
  ]

  // Types shown in the ADD form (new hires only)
  const EMP_TYPES = [
    { value: 'full_time',  label: 'Full Time' },
    { value: 'intern',     label: 'Intern' },
    { value: 'probation',  label: 'Probation' },
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
    return `
      <div class="page-inner">
        <div class="page-toolbar">
          <div class="tabs" id="ppl-tabs">
            <button class="tab-btn tab-btn--active" data-tab="directory">Directory</button>
            <button class="tab-btn" data-tab="orgchart">Org Chart</button>
          </div>
          <div id="ppl-toolbar-actions"></div>
        </div>
        <div id="ppl-content" class="page-loading">Loading…</div>
      </div>
    `
  }

  /* ── init ───────────────────────────────────────────────── */
  async function init(user) {
    _user = user

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
    if (actions) actions.innerHTML = ''
    switch (tab) {
      case 'directory': return _renderDirectory()
      case 'orgchart':  return _renderOrgChart()
    }
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
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                      <strong>${Utils.escapeHtml(e.name)}</strong>
                      ${e.employment_type === 'probation' ? `<span class="badge badge--warning" style="font-size:10px;padding:1px 7px;">Probation</span>` : ''}
                    </div>
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

    // Award-badge stays a manager (Tier 2) action here — HR's blanket
    // award capability, and KYC/edit/deactivate, now live in /hrms.
    const _canAwardBadge = _user && emp.manager_id === _user.id

    const { data: empBadges } = await API.getEmployeeBadges(emp.id)

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
            ${emp.employment_type === 'probation' ? `<span style="background:rgba(180,83,9,0.35);color:#fcd34d;font-size:11px;font-weight:600;padding:3px 10px;border-radius:99px;">Probation</span>` : ''}
          </div>
        </div>

        <!-- ── Quick Stats ────────────────────────────────────── -->
        <div style="display:grid;grid-template-columns:repeat(${emp._managerName ? 4 : 3},1fr);border-bottom:1px solid var(--border);background:var(--surface);">
          <div style="border-right:1px solid var(--border);">
            ${_stat('💼', 'Type', _empTypeLabel(emp.employment_type))}
          </div>
          <div style="border-right:1px solid var(--border);">
            ${_stat('🏢', 'Location', _workLocationLabel(emp.work_location))}
          </div>
          <div${emp._managerName ? ' style="border-right:1px solid var(--border);"' : ''}>
            ${_stat('📅', 'Joined', Utils.formatDate(emp.joining_date))}
          </div>
          ${emp._managerName ? `
          <div>
            ${_stat('👤', 'Reporting Manager', Utils.escapeHtml(emp._managerName))}
          </div>` : ''}
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
            ${emp.bio_id != null ? `
            <div class="people-field">
              <div class="people-field-label">Bio ID</div>
              <div class="people-field-value">${emp.bio_id}</div>
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

        <!-- ── Address ───────────────────────────────────────── -->
        ${(emp.current_address_house_no || emp.address) ? `
        <div style="padding:16px 24px;border-bottom:1px solid var(--border);">
          ${_sec('Address')}
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
            <div>
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:8px;">Current Address</div>
              ${emp.current_address_house_no ? `
                <div style="font-size:13px;color:var(--text);line-height:1.7;">
                  ${[
                    emp.current_address_house_no,
                    emp.current_address_building,
                    emp.current_address_street,
                    emp.current_address_landmark,
                    emp.current_address_city,
                    emp.current_address_state,
                    emp.current_address_pincode
                  ].filter(Boolean).map(l => Utils.escapeHtml(l)).join('<br>')}
                  ${emp.current_address_type ? `<br><span style="font-size:11px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:1px 6px;color:var(--text-secondary);">${Utils.escapeHtml(emp.current_address_type)}</span>` : ''}
                </div>
              ` : `<div style="font-size:13px;color:var(--text);">${Utils.escapeHtml(emp.address || '—')}</div>`}
            </div>
            <div>
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:8px;">Permanent Address</div>
              ${emp.permanent_address_house_no ? `
                <div style="font-size:13px;color:var(--text);line-height:1.7;">
                  ${[
                    emp.permanent_address_house_no,
                    emp.permanent_address_building,
                    emp.permanent_address_street,
                    emp.permanent_address_landmark,
                    emp.permanent_address_city,
                    emp.permanent_address_state,
                    emp.permanent_address_pincode
                  ].filter(Boolean).map(l => Utils.escapeHtml(l)).join('<br>')}
                  ${emp.permanent_address_type ? `<br><span style="font-size:11px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:1px 6px;color:var(--text-secondary);">${Utils.escapeHtml(emp.permanent_address_type)}</span>` : ''}
                </div>
              ` : `<div style="font-size:13px;color:var(--text);">${Utils.escapeHtml(emp.permanent_address || emp.address || '—')}</div>`}
            </div>
          </div>
        </div>` : ''}

        <!-- ── Emergency Contact ──────────────────────────────── -->
        <div style="padding:16px 24px;">
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

      </div>

      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Close</button>
      </div>
    `, 'people-profile-modal')

    // Award Badge button — visible to direct manager only here (Tier 2);
    // HR's blanket award capability lives in /hrms alongside edit/KYC.
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
  key:       'people',
  routeId:   'people',
  label:     'People',
  order:     8,
  icon:      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`,
  getModule: () => People,
  features:  {
    view_employees: 'View Employees',
  },
})
