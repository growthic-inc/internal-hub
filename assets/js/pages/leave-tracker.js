/* ============================================================
   LEAVE TRACKER — Phase 7
   Tabs: My Leaves | My WFH | Pending Approvals | Team Overview | Settings
   Sandwich policy: calendar days inclusive (weekends + holidays count).
   ============================================================ */

const LeaveTracker = (() => {

  /* ── Module state ───────────────────────────────────────── */
  let _user            = null
  let _activeTab       = 'my-leaves'
  let _calMonth        = null   // Date set to 1st of displayed month
  let _employees       = []
  let _leaveTypes      = []
  let _leaveRequests   = []
  let _wfhRequests     = []
  let _leaveCredits    = []
  let _holidays        = []
  let _events          = []
  let _pendingApprovals = []
  let _pendingWfh      = []
  let _isManager       = false
  let _isHR            = false

  const currentYear = new Date().getFullYear()

  /* ── Status badge map ───────────────────────────────────── */
  const STATUS_BADGE = {
    pending:              '<span class="badge badge--warning">Pending</span>',
    approved:             '<span class="badge badge--success">Approved</span>',
    rejected:             '<span class="badge badge--danger">Rejected</span>',
    cancelled:            '<span class="badge badge--muted">Cancelled</span>',
    cancellation_pending: '<span class="badge badge--warning">Cancel Pending</span>',
  }

  /* ── SVG icons (inline, no external deps) ──────────────── */
  const CLOSE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
  const CHEVRON_L = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`
  const CHEVRON_R = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`

  /* ══════════════════════════════════════════════════════════
     HELPERS
  ══════════════════════════════════════════════════════════ */

  // Sandwich policy: calendar days inclusive, no exclusions
  function _calcLeaveDays(startDate, endDate, isHalfDay) {
    if (isHalfDay) return 0.5
    const start = new Date(startDate)
    const end   = new Date(endDate)
    return Math.max(0, Math.round((end - start) / 86400000) + 1)
  }

  // Leave balance for a leave type in a given year
  function _getBalance(leaveTypeId, year) {
    const credited = _leaveCredits
      .filter(c => c.leave_type_id === leaveTypeId && c.year === year)
      .reduce((sum, c) => sum + Number(c.credited_days), 0)
    const taken = _leaveRequests
      .filter(r => r.leave_type_id === leaveTypeId && r.status === 'approved'
                && new Date(r.start_date).getFullYear() === year)
      .reduce((sum, r) => sum + Number(r.days), 0)
    return credited - taken
  }

  // ISO date string (YYYY-MM-DD) without timezone shift
  function _toISO(date) {
    const d = new Date(date)
    return d.toISOString().split('T')[0]
  }

  // Parse "YYYY-MM-DD" to a local Date at midnight
  function _parseLocal(iso) {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, m - 1, d)
  }

  // Build a Set of ISO dates that fall in a date range [startISO, endISO]
  function _dateRange(startISO, endISO) {
    const set = new Set()
    const cur = _parseLocal(startISO)
    const end = _parseLocal(endISO)
    while (cur <= end) {
      set.add(_toISO(cur))
      cur.setDate(cur.getDate() + 1)
    }
    return set
  }

  // Resolve approver_id from the current user's manager
  function _resolveApproverId() {
    return _user.manager_id || null
  }

  // WFH days used for user in a given month/year
  function _wfhUsed(month, year) {
    return _wfhRequests
      .filter(r => r.status === 'approved') // only approved WFH
      .reduce((sum, r) => {
        const startYear  = new Date(r.start_date).getFullYear()
        const startMonth = new Date(r.start_date).getMonth() + 1
        if (startYear === year && startMonth === month) {
          return sum + Number(r.days)
        }
        return sum
      }, 0)
  }

  // Resolve WFH quota max for user in month/year (individual > department > unlimited)
  function _resolveWfhQuota(quotas, month, year) {
    const individual = quotas.find(q =>
      q.scope === 'individual' &&
      q.employee_id === _user.id &&
      q.month === month &&
      q.year === year
    )
    if (individual) return individual.max_days

    const dept = quotas.find(q =>
      q.scope === 'department' &&
      q.department === _user.department &&
      q.month === month &&
      q.year === year
    )
    if (dept) return dept.max_days

    return null // unlimited
  }

  /* ══════════════════════════════════════════════════════════
     RENDER — initial HTML shell
  ══════════════════════════════════════════════════════════ */
  function render(user) {
    const isHR       = user.role === 'super_admin' || user.department === 'people_culture'
    const tabs = [
      { id: 'my-leaves',          label: 'My Leaves' },
      { id: 'my-wfh',             label: 'My WFH' },
      { id: 'pending-approvals',  label: 'Pending Approvals', conditional: true },
      { id: 'team-overview',      label: 'Team Overview',     hrOnly: true },
      { id: 'settings',           label: 'Settings',          hrOnly: true },
    ]

    return `
      <div class="page-inner">
        <div class="page-toolbar">
          <div class="tabs" id="lt-tabs">
            ${tabs.map(t => `
              <button
                class="tab-btn${t.id === 'my-leaves' ? ' tab-btn--active' : ''}"
                data-tab="${t.id}"
                id="lt-tab-${t.id}"
                ${(t.hrOnly && !isHR) ? 'style="display:none;"' : ''}
                ${(t.conditional && !isHR) ? '' : ''}
              >
                ${Utils.escapeHtml(t.label)}
                ${t.id === 'pending-approvals' ? '<span id="lt-approval-badge" class="badge badge--danger" style="display:none;margin-left:4px;font-size:11px;"></span>' : ''}
              </button>
            `).join('')}
          </div>
          <div id="lt-toolbar-actions"></div>
        </div>
        <div id="lt-content" class="mt-4"></div>
      </div>
    `
  }

  /* ══════════════════════════════════════════════════════════
     INIT — fetch data, bind tabs
  ══════════════════════════════════════════════════════════ */
  async function init(user) {
    _user      = user
    _isHR      = user.role === 'super_admin' || user.department === 'people_culture'
    _calMonth  = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    _activeTab = 'my-leaves'

    // Fetch all employees to determine manager status
    const empRes = await API.getAllEmployees()
    _employees = empRes.data || []
    _isManager = _employees.some(e => e.manager_id === _user.id)

    // Show/hide conditional tab
    const approvalTab = document.getElementById('lt-tab-pending-approvals')
    if (approvalTab) {
      approvalTab.style.display = (_isManager || _isHR) ? '' : 'none'
    }

    // Fetch core data in parallel
    const [ltRes, lrRes, wfhRes, lcRes, holRes, evtRes] = await Promise.all([
      API.getLeaveTypes(true),
      API.getMyLeaveRequests(_user.id),
      API.getMyWfhRequests(_user.id),
      API.getLeaveCredits(_user.id, currentYear),
      API.getCompanyHolidays(currentYear),
      API.getCompanyEvents(currentYear),
    ])

    _leaveTypes    = ltRes.data  || []
    _leaveRequests = lrRes.data  || []
    _wfhRequests   = wfhRes.data || []
    _leaveCredits  = lcRes.data  || []
    _holidays      = holRes.data || []
    _events        = evtRes.data || []

    // Fetch pending approvals if manager or HR
    if (_isManager || _isHR) {
      const [paRes, pwRes] = await Promise.all([
        API.getPendingLeaveApprovals(_user.id),
        API.getPendingWfhApprovals(_user.id),
      ])
      _pendingApprovals = paRes.data || []
      _pendingWfh       = pwRes.data || []

      if (_isHR) {
        const [hrLRes, hrWRes] = await Promise.all([
          API.getHRLeaveQueue(),
          API.getHRWfhQueue(),
        ])
        // Merge HR queue — deduplicate by id
        const hrLeaves = (hrLRes.data || []).filter(r => !_pendingApprovals.some(p => p.id === r.id))
        const hrWfh    = (hrWRes.data || []).filter(r => !_pendingWfh.some(p => p.id === r.id))
        _pendingApprovals = [..._pendingApprovals, ...hrLeaves]
        _pendingWfh       = [..._pendingWfh, ...hrWfh]
      }

      _updateApprovalBadge()
    }

    _bindTabs()
    _loadTab('my-leaves')
  }

  function _updateApprovalBadge() {
    const badge = document.getElementById('lt-approval-badge')
    if (!badge) return
    const count = _pendingApprovals.length + _pendingWfh.length
    if (count > 0) {
      badge.textContent   = count > 99 ? '99+' : String(count)
      badge.style.display = 'inline-flex'
    } else {
      badge.style.display = 'none'
    }
  }

  function _bindTabs() {
    document.querySelectorAll('#lt-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#lt-tabs .tab-btn').forEach(b => b.classList.remove('tab-btn--active'))
        btn.classList.add('tab-btn--active')
        _activeTab = btn.dataset.tab
        _loadTab(_activeTab)
      })
    })
  }

  function _loadTab(tab) {
    const toolbar = document.getElementById('lt-toolbar-actions')
    if (toolbar) toolbar.innerHTML = ''
    switch (tab) {
      case 'my-leaves':         return _loadMyLeavesTab()
      case 'my-wfh':            return _loadMyWfhTab()
      case 'pending-approvals': return _loadPendingApprovalsTab()
      case 'team-overview':     return _loadTeamOverviewTab()
      case 'settings':          return _loadSettingsTab()
    }
  }

  /* ══════════════════════════════════════════════════════════
     TAB: MY LEAVES
  ══════════════════════════════════════════════════════════ */
  function _loadMyLeavesTab() {
    const toolbar = document.getElementById('lt-toolbar-actions')
    if (toolbar) {
      toolbar.innerHTML = `<button class="btn btn--primary btn--sm" id="lt-apply-leave-btn">+ Apply Leave</button>`
      document.getElementById('lt-apply-leave-btn').addEventListener('click', _openApplyLeaveModal)
    }

    const content = document.getElementById('lt-content')
    if (!content) return

    // Compute summary stats
    const totalCredited = _leaveCredits.reduce((s, c) => s + Number(c.credited_days), 0)
    const leavesTaken   = _leaveRequests
      .filter(r => r.status === 'approved' && new Date(r.start_date).getFullYear() === currentYear)
      .reduce((s, r) => s + Number(r.days), 0)
    const remaining     = totalCredited - leavesTaken
    const pendingCount  = _leaveRequests.filter(r => r.status === 'pending').length

    content.innerHTML = `
      <div class="lt-summary-cards mb-4">
        <div class="lt-stat-card section-card">
          <div class="lt-stat-value">${totalCredited}</div>
          <div class="lt-stat-label">Total Credited</div>
        </div>
        <div class="lt-stat-card section-card">
          <div class="lt-stat-value">${leavesTaken}</div>
          <div class="lt-stat-label">Leaves Taken</div>
        </div>
        <div class="lt-stat-card section-card">
          <div class="lt-stat-value ${remaining < 0 ? 'lt-stat-value--warning' : ''}">${remaining}</div>
          <div class="lt-stat-label">Remaining</div>
        </div>
        <div class="lt-stat-card section-card">
          <div class="lt-stat-value">${pendingCount}</div>
          <div class="lt-stat-label">Pending</div>
        </div>
      </div>

      <div style="display:flex;gap:16px;align-items:flex-start;" class="mb-4">
        <div style="flex:1;min-width:0;">
          ${_renderCalendar()}
        </div>
        <div style="width:260px;flex-shrink:0;">
          ${_renderUpcomingPanel()}
        </div>
      </div>

      <div class="section-card">
        <div class="section-card-header">
          <h3>Leave History</h3>
        </div>
        <div class="section-card-body" style="padding:0;">
          ${_renderLeaveHistoryTable()}
        </div>
      </div>
    `

    _bindCalendarNav()
    _bindLeaveHistoryActions()
  }

  /* ── Calendar ─────────────────────────────────────────── */
  function _renderCalendar() {
    const today      = new Date()
    const year       = _calMonth.getFullYear()
    const month      = _calMonth.getMonth() // 0-indexed
    const monthLabel = _calMonth.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

    // Build lookup maps for fast day cell rendering
    const holidayMap = {}
    _holidays.forEach(h => { holidayMap[h.date] = h.name })

    const eventDates = new Set()
    _events.forEach(ev => {
      _dateRange(ev.start_date, ev.end_date || ev.start_date).forEach(d => eventDates.add(d))
    })

    // Birthdays and work anniversaries (match month/day for current calendar year)
    const birthdayMap    = {}   // dateISO → [name, …]
    const anniversaryMap = {}
    _employees.filter(e => e.status === 'active').forEach(e => {
      if (e.date_of_birth) {
        const dob    = e.date_of_birth.slice(5)  // MM-DD
        const key    = `${year}-${dob}`
        if (!birthdayMap[key]) birthdayMap[key] = []
        birthdayMap[key].push(e.name)
      }
      if (e.joining_date) {
        const joined     = new Date(e.joining_date)
        const yearsIn    = year - joined.getFullYear()
        if (yearsIn > 0) {
          const annvISO = `${year}-${e.joining_date.slice(5)}`
          if (!anniversaryMap[annvISO]) anniversaryMap[annvISO] = []
          anniversaryMap[annvISO].push({ name: e.name, years: yearsIn })
        }
      }
    })

    const approvedLeaveMap  = {}   // date → { type, days }
    const pendingLeaveMap   = {}
    const approvedWfhMap    = {}

    _leaveRequests.forEach(r => {
      if (!['approved', 'pending'].includes(r.status)) return
      _dateRange(r.start_date, r.end_date).forEach(d => {
        if (r.status === 'approved') {
          approvedLeaveMap[d] = { typeName: r.leave_types?.name || '', request: r }
        } else {
          pendingLeaveMap[d] = { typeName: r.leave_types?.name || '', request: r }
        }
      })
    })

    _wfhRequests.forEach(r => {
      if (r.status !== 'approved') return
      _dateRange(r.start_date, r.end_date).forEach(d => {
        approvedWfhMap[d] = r
      })
    })

    // First day of month and grid padding
    const firstDow   = new Date(year, month, 1).getDay() // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    // Shift so Mon=0
    const startPad   = (firstDow === 0) ? 6 : firstDow - 1

    const dayHeaders = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    const todayISO   = _toISO(today)

    let cells = ''
    // Empty padding cells
    for (let i = 0; i < startPad; i++) {
      cells += `<div class="lt-cal-day lt-cal-day--empty"></div>`
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateISO = `${year}-${String(month + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
      const dow     = new Date(year, month, day).getDay() // 0=Sun,6=Sat
      const isWeekend = dow === 0 || dow === 6
      const isToday   = dateISO === todayISO

      const classes = [
        'lt-cal-day',
        isWeekend ? 'lt-cal-day--weekend' : '',
        isToday   ? 'lt-cal-day--today'   : '',
      ].filter(Boolean).join(' ')

      let dots = ''
      let title = ''

      if (approvedLeaveMap[dateISO]) {
        const info = approvedLeaveMap[dateISO]
        dots += `<span class="lt-cal-dot lt-cal-dot--leave" title="${Utils.escapeHtml(info.typeName)}">${(info.typeName || 'L')[0].toUpperCase()}</span>`
        title = info.typeName
      } else if (pendingLeaveMap[dateISO]) {
        dots += `<span class="lt-cal-dot lt-cal-dot--pending" title="Pending leave"></span>`
      }

      if (approvedWfhMap[dateISO]) {
        dots += `<span class="lt-cal-dot lt-cal-dot--wfh" title="WFH">W</span>`
      }

      if (holidayMap[dateISO]) {
        dots += `<span class="lt-cal-dot lt-cal-dot--holiday" title="${Utils.escapeHtml(holidayMap[dateISO])}">${Utils.escapeHtml(holidayMap[dateISO][0])}</span>`
        title = title || holidayMap[dateISO]
      } else if (eventDates.has(dateISO)) {
        dots += `<span class="lt-cal-dot lt-cal-dot--event" title="Event"></span>`
      }

      if (birthdayMap[dateISO]) {
        const names = birthdayMap[dateISO].join(', ')
        dots += `<span class="lt-cal-dot lt-cal-dot--birthday" title="🎂 ${Utils.escapeHtml(names)}">🎂</span>`
        title = title || names
      }

      if (anniversaryMap[dateISO]) {
        const annvLabel = anniversaryMap[dateISO].map(a => `${a.name} (${a.years}yr)`).join(', ')
        dots += `<span class="lt-cal-dot lt-cal-dot--anniversary" title="🎉 ${Utils.escapeHtml(annvLabel)}">🎉</span>`
        title = title || annvLabel
      }

      const isHRClickable = _isHR
      cells += `
        <div class="${classes}" data-date="${dateISO}" title="${Utils.escapeHtml(title)}"
          style="cursor:${isHRClickable ? 'pointer' : (title ? 'pointer' : 'default')};"
          ${isHRClickable ? `data-hr-add="${dateISO}"` : ''}>
          <span class="lt-cal-day-num">${day}</span>
          <div class="lt-cal-dots">${dots}</div>
        </div>
      `
    }

    return `
      <div class="lt-calendar section-card">
        <div class="lt-cal-header section-card-header" style="padding:12px 16px;">
          <button class="btn btn--ghost btn--sm" id="lt-cal-prev">${CHEVRON_L}</button>
          <span style="font-weight:600;font-size:14px;">${monthLabel}</span>
          <button class="btn btn--ghost btn--sm" id="lt-cal-next">${CHEVRON_R}</button>
        </div>
        <div class="section-card-body" style="padding:8px 12px 12px;">
          <div class="lt-cal-grid" style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;">
            ${dayHeaders.map(h => `<div class="lt-cal-header-cell" style="text-align:center;font-size:11px;font-weight:600;color:var(--text-muted);padding:4px 0;">${h}</div>`).join('')}
            ${cells}
          </div>
        </div>
        <div style="padding:8px 16px 12px;display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--text-muted);align-items:center;">
          <span><span class="lt-cal-dot lt-cal-dot--leave" style="display:inline-block;margin-right:3px;"></span>Approved Leave</span>
          <span><span class="lt-cal-dot lt-cal-dot--pending" style="display:inline-block;margin-right:3px;"></span>Pending</span>
          <span><span class="lt-cal-dot lt-cal-dot--wfh" style="display:inline-block;margin-right:3px;"></span>WFH</span>
          <span><span class="lt-cal-dot lt-cal-dot--holiday" style="display:inline-block;margin-right:3px;"></span>Holiday</span>
          <span><span class="lt-cal-dot lt-cal-dot--event" style="display:inline-block;margin-right:3px;"></span>Event</span>
          <span>🎂 Birthday</span>
          <span>🎉 Work Anniversary</span>
          ${_isHR ? `<span style="margin-left:auto;font-size:11px;color:var(--text-muted);">Click any date to add</span>` : ''}
        </div>
      </div>
    `
  }

  function _bindCalendarNav() {
    document.getElementById('lt-cal-prev')?.addEventListener('click', () => {
      _calMonth.setMonth(_calMonth.getMonth() - 1)
      _loadMyLeavesTab()
    })
    document.getElementById('lt-cal-next')?.addEventListener('click', () => {
      _calMonth.setMonth(_calMonth.getMonth() + 1)
      _loadMyLeavesTab()
    })

    if (_isHR) {
      document.querySelectorAll('[data-hr-add]').forEach(cell => {
        cell.addEventListener('click', () => _openCalendarAddModal(cell.dataset.hrAdd))
      })
    }
  }

  function _openCalendarAddModal(dateISO) {
    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Add to ${Utils.formatDate(dateISO)}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">${CLOSE_SVG}</button>
      </div>
      <div class="modal-body">
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">
          <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;cursor:pointer;">
            <input type="radio" name="cal-add-type" value="holiday" checked style="accent-color:var(--accent);" />
            <div>
              <div style="font-size:13px;font-weight:600;">National Holiday / Company Holiday</div>
              <div style="font-size:12px;color:var(--text-muted);">Marks the day as a holiday for everyone</div>
            </div>
          </label>
          <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;cursor:pointer;">
            <input type="radio" name="cal-add-type" value="event" style="accent-color:var(--accent);" />
            <div>
              <div style="font-size:13px;font-weight:600;">Company Event</div>
              <div style="font-size:12px;color:var(--text-muted);">Team celebration, offsite, or any other event</div>
            </div>
          </label>
        </div>

        <div id="cal-add-err" class="alert alert--danger" style="display:none;"></div>

        <div id="cal-holiday-fields">
          <div class="form-group">
            <label class="form-label">Holiday Name <span class="required">*</span></label>
            <input class="form-input" type="text" id="cal-hol-name" placeholder="e.g. Diwali, Republic Day…" />
          </div>
        </div>

        <div id="cal-event-fields" style="display:none;">
          <div class="form-group">
            <label class="form-label">Event Title <span class="required">*</span></label>
            <input class="form-input" type="text" id="cal-evt-title" placeholder="e.g. Team Offsite, Diwali Party…" />
          </div>
          <div class="form-group">
            <label class="form-label">End Date</label>
            <input class="form-input" type="date" id="cal-evt-end" value="${dateISO}" min="${dateISO}" />
          </div>
          <div class="form-group">
            <label class="form-label">Description</label>
            <textarea class="form-input" id="cal-evt-desc" rows="2" style="resize:vertical;" placeholder="Optional details…"></textarea>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="cal-add-save-btn">Add</button>
      </div>
    `)

    // Toggle field sections based on radio
    document.querySelectorAll('[name="cal-add-type"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const isHoliday = radio.value === 'holiday'
        document.getElementById('cal-holiday-fields').style.display = isHoliday ? 'block' : 'none'
        document.getElementById('cal-event-fields').style.display   = isHoliday ? 'none' : 'block'
      })
    })

    document.getElementById('cal-add-save-btn').addEventListener('click', async () => {
      const errEl    = document.getElementById('cal-add-err')
      const btn      = document.getElementById('cal-add-save-btn')
      const addType  = document.querySelector('[name="cal-add-type"]:checked')?.value

      errEl.style.display = 'none'
      btn.disabled    = true
      btn.textContent = 'Saving…'

      let error
      if (addType === 'holiday') {
        const name = document.getElementById('cal-hol-name').value.trim()
        if (!name) { errEl.textContent = 'Please enter a holiday name.'; errEl.style.display = 'block'; btn.disabled = false; btn.textContent = 'Add'; return }
        ;({ error } = await API.addCompanyHoliday({ date: dateISO, name }))
      } else {
        const title = document.getElementById('cal-evt-title').value.trim()
        const end   = document.getElementById('cal-evt-end').value || dateISO
        const desc  = document.getElementById('cal-evt-desc').value.trim()
        if (!title) { errEl.textContent = 'Please enter an event title.'; errEl.style.display = 'block'; btn.disabled = false; btn.textContent = 'Add'; return }
        ;({ error } = await API.createCompanyEvent({ title, start_date: dateISO, end_date: end, description: desc || null, created_by: _user.id }))
      }

      btn.disabled    = false
      btn.textContent = 'Add'

      if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return }

      Utils.closeModal()
      Utils.showToast(`${addType === 'holiday' ? 'Holiday' : 'Event'} added.`, 'success')
      // Refresh data and re-render
      const [holRes, evtRes] = await Promise.all([
        API.getCompanyHolidays(_calMonth.getFullYear()),
        API.getCompanyEvents(_calMonth.getFullYear()),
      ])
      _holidays = holRes.data || []
      _events   = evtRes.data || []
      _loadMyLeavesTab()
    })
  }

  /* ── Upcoming panel ───────────────────────────────────── */
  function _renderUpcomingPanel() {
    const today      = _toISO(new Date())
    const upHolidays = _holidays
      .filter(h => h.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 3)

    const upLeaves = _leaveRequests
      .filter(r => r.status === 'approved' && r.end_date >= today)
      .sort((a, b) => a.start_date.localeCompare(b.start_date))
      .slice(0, 5)

    return `
      <div class="lt-upcoming section-card">
        <div class="section-card-header" style="padding:12px 16px;">
          <h4 style="margin:0;font-size:13px;font-weight:600;">Upcoming</h4>
        </div>
        <div class="section-card-body" style="padding:12px 16px;">
          <div style="margin-bottom:12px;">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);letter-spacing:.5px;margin-bottom:6px;">Holidays</div>
            ${upHolidays.length
              ? upHolidays.map(h => `
                  <div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid var(--border);">
                    <span>${Utils.escapeHtml(h.name)}</span>
                    <span style="color:var(--text-muted);">${Utils.formatDate(h.date)}</span>
                  </div>
                `).join('')
              : '<p style="font-size:12px;color:var(--text-muted);">No upcoming holidays.</p>'
            }
          </div>
          <div>
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);letter-spacing:.5px;margin-bottom:6px;">My Approved Leaves</div>
            ${upLeaves.length
              ? upLeaves.map(r => `
                  <div style="font-size:12px;padding:4px 0;border-bottom:1px solid var(--border);">
                    <div style="font-weight:500;">${Utils.escapeHtml(r.leave_types?.name || '—')}</div>
                    <div style="color:var(--text-muted);">${Utils.formatDate(r.start_date)}${r.start_date !== r.end_date ? ' – ' + Utils.formatDate(r.end_date) : ''}</div>
                  </div>
                `).join('')
              : '<p style="font-size:12px;color:var(--text-muted);">No upcoming leaves.</p>'
            }
          </div>
        </div>
      </div>
    `
  }

  /* ── Leave History Table ──────────────────────────────── */
  function _renderLeaveHistoryTable() {
    if (!_leaveRequests.length) return '<p class="empty-state">No leave requests yet.</p>'

    return `
      <table class="data-table">
        <thead><tr>
          <th>Type</th>
          <th>Dates</th>
          <th>Days</th>
          <th>Status</th>
          <th>Reason</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${_leaveRequests.map(r => `
            <tr>
              <td>${Utils.escapeHtml(r.leave_types?.name || '—')}</td>
              <td style="white-space:nowrap;font-size:12px;">
                ${Utils.formatDate(r.start_date)}
                ${r.start_date !== r.end_date ? ' – ' + Utils.formatDate(r.end_date) : ''}
                ${r.is_half_day ? `<span class="badge badge--muted" style="font-size:10px;margin-left:4px;">Half-day ${r.half_day_period || ''}</span>` : ''}
              </td>
              <td>${r.days}</td>
              <td>
                ${STATUS_BADGE[r.status] || r.status}
                ${r.approver_comment ? `<div class="text-sm text-muted" style="margin-top:2px;">${Utils.escapeHtml(Utils.truncate(r.approver_comment, 40))}</div>` : ''}
              </td>
              <td class="text-muted" style="font-size:12px;">${Utils.escapeHtml(Utils.truncate(r.reason || '—', 50))}</td>
              <td style="white-space:nowrap;">
                ${r.status === 'pending' ? `<button class="btn btn--xs btn--ghost" data-cancel-leave="${r.id}" style="color:var(--danger);">Cancel</button>` : ''}
                ${r.status === 'approved' ? `<button class="btn btn--xs btn--ghost" data-cancel-request="${r.id}" style="color:var(--warning);">Request Cancel</button>` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `
  }

  function _bindLeaveHistoryActions() {
    document.querySelectorAll('[data-cancel-leave]').forEach(btn => {
      btn.addEventListener('click', () => _cancelLeave(btn.dataset.cancelLeave))
    })
    document.querySelectorAll('[data-cancel-request]').forEach(btn => {
      btn.addEventListener('click', () => _requestCancellation(btn.dataset.cancelRequest))
    })
  }

  async function _cancelLeave(id) {
    if (!confirm('Cancel this leave request?')) return
    const { error } = await API.updateLeaveRequest(id, { status: 'cancelled' })
    if (error) {
      Utils.showToast('Failed to cancel: ' + error.message, 'error')
    } else {
      Utils.showToast('Leave request cancelled.', 'success')
      await _refreshMyLeaveData()
      _loadTab(_activeTab)
    }
  }

  async function _requestCancellation(id) {
    const reason = prompt('Reason for cancellation request (optional):')
    if (reason === null) return // user clicked Cancel
    const { error } = await API.updateLeaveRequest(id, {
      status:              'cancellation_pending',
      cancellation_reason: reason || null,
    })
    if (error) {
      Utils.showToast('Failed: ' + error.message, 'error')
    } else {
      Utils.showToast('Cancellation request sent.', 'success')
      await _refreshMyLeaveData()
      _loadTab(_activeTab)
    }
  }

  async function _refreshMyLeaveData() {
    const [lrRes, wfhRes] = await Promise.all([
      API.getMyLeaveRequests(_user.id),
      API.getMyWfhRequests(_user.id),
    ])
    _leaveRequests = lrRes.data  || []
    _wfhRequests   = wfhRes.data || []
  }

  /* ── Apply Leave Modal ────────────────────────────────── */
  function _openApplyLeaveModal() {
    const typeOptions = _leaveTypes.map(t =>
      `<option value="${t.id}">${Utils.escapeHtml(t.name)}</option>`
    ).join('')

    const todayISO = _toISO(new Date())

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Apply for Leave</h3>
        <button class="modal-close" onclick="Utils.closeModal()">${CLOSE_SVG}</button>
      </div>
      <div class="modal-body">
        <div id="lt-leave-modal-err" class="alert alert--danger" style="display:none;"></div>

        <div class="form-group">
          <label class="form-label">Leave Type <span class="required">*</span></label>
          <select class="form-select" id="lt-f-leave-type">
            <option value="">— Select type —</option>
            ${typeOptions}
          </select>
          <div id="lt-balance-display" class="lt-balance-pill" style="margin-top:6px;display:none;font-size:12px;"></div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Start Date <span class="required">*</span></label>
            <input class="form-input" type="date" id="lt-f-start" value="${todayISO}" />
          </div>
          <div class="form-group">
            <label class="form-label">End Date <span class="required">*</span></label>
            <input class="form-input" type="date" id="lt-f-end" value="${todayISO}" />
          </div>
        </div>

        <div class="form-group" style="display:flex;align-items:center;gap:10px;">
          <input type="checkbox" id="lt-f-half-day" style="width:16px;height:16px;cursor:pointer;" />
          <label for="lt-f-half-day" class="form-label" style="margin:0;cursor:pointer;">Half day</label>
        </div>

        <div id="lt-half-day-period-wrap" style="display:none;" class="form-group">
          <label class="form-label">Period</label>
          <div style="display:flex;gap:16px;">
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;">
              <input type="radio" name="lt-half-period" value="morning" checked /> Morning
            </label>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;">
              <input type="radio" name="lt-half-period" value="afternoon" /> Afternoon
            </label>
          </div>
        </div>

        <div class="form-group">
          <div id="lt-day-count-display" style="font-size:13px;color:var(--text-muted);margin-bottom:8px;"></div>
        </div>

        <div class="form-group">
          <label class="form-label">Reason <span class="required">*</span></label>
          <textarea class="form-input" id="lt-f-reason" rows="3"
            placeholder="Briefly describe the reason…" style="resize:vertical;"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="lt-submit-leave-btn">Submit</button>
      </div>
    `)

    // Live day count update
    const _updateDayCount = () => {
      const start   = document.getElementById('lt-f-start')?.value
      const end     = document.getElementById('lt-f-end')?.value
      const isHalf  = document.getElementById('lt-f-half-day')?.checked
      const countEl = document.getElementById('lt-day-count-display')
      if (!countEl) return
      if (isHalf) {
        countEl.textContent = '0.5 days'
      } else if (start && end) {
        const days = _calcLeaveDays(start, end, false)
        countEl.textContent = `${days} calendar day${days === 1 ? '' : 's'}`
      } else {
        countEl.textContent = ''
      }
    }

    // Balance display on type change
    const _updateBalance = () => {
      const typeId  = document.getElementById('lt-f-leave-type')?.value
      const el      = document.getElementById('lt-balance-display')
      if (!el) return
      if (!typeId) { el.style.display = 'none'; return }
      const balance = _getBalance(typeId, currentYear)
      el.style.display     = 'block'
      el.style.color       = balance < 0 ? 'var(--warning)' : 'var(--success)'
      el.textContent       = `${balance} day${Math.abs(balance) === 1 ? '' : 's'} remaining this year`
    }

    // Half-day toggle
    const _toggleHalfDay = () => {
      const isHalf   = document.getElementById('lt-f-half-day')?.checked
      const endEl    = document.getElementById('lt-f-end')
      const periodEl = document.getElementById('lt-half-day-period-wrap')
      if (isHalf) {
        const startVal = document.getElementById('lt-f-start')?.value
        if (endEl) { endEl.value = startVal; endEl.disabled = true }
        if (periodEl) periodEl.style.display = 'block'
      } else {
        if (endEl) endEl.disabled = false
        if (periodEl) periodEl.style.display = 'none'
      }
      _updateDayCount()
    }

    document.getElementById('lt-f-leave-type')?.addEventListener('change', _updateBalance)
    document.getElementById('lt-f-start')?.addEventListener('change', () => {
      const start = document.getElementById('lt-f-start')?.value
      const endEl = document.getElementById('lt-f-end')
      const isHalf = document.getElementById('lt-f-half-day')?.checked
      if (endEl && (isHalf || !endEl.value || endEl.value < start)) endEl.value = start
      _updateDayCount()
    })
    document.getElementById('lt-f-end')?.addEventListener('change', _updateDayCount)
    document.getElementById('lt-f-half-day')?.addEventListener('change', _toggleHalfDay)

    _updateDayCount()

    document.getElementById('lt-submit-leave-btn')?.addEventListener('click', async () => {
      const errEl    = document.getElementById('lt-leave-modal-err')
      const btn      = document.getElementById('lt-submit-leave-btn')
      const typeId   = document.getElementById('lt-f-leave-type').value
      const start    = document.getElementById('lt-f-start').value
      const end      = document.getElementById('lt-f-end').value
      const isHalf   = document.getElementById('lt-f-half-day').checked
      const period   = document.querySelector('input[name="lt-half-period"]:checked')?.value || 'morning'
      const reason   = document.getElementById('lt-f-reason').value.trim()

      errEl.style.display = 'none'
      if (!typeId) { errEl.textContent = 'Please select a leave type.';      errEl.style.display = 'block'; return }
      if (!start)  { errEl.textContent = 'Please select a start date.';      errEl.style.display = 'block'; return }
      if (!end)    { errEl.textContent = 'Please select an end date.';        errEl.style.display = 'block'; return }
      if (!isHalf && end < start) { errEl.textContent = 'End date cannot be before start date.'; errEl.style.display = 'block'; return }
      if (!reason) { errEl.textContent = 'Please provide a reason.';          errEl.style.display = 'block'; return }

      const days       = _calcLeaveDays(start, isHalf ? start : end, isHalf)
      const approverId = _resolveApproverId()

      btn.disabled    = true
      btn.textContent = 'Submitting…'

      const { error } = await API.createLeaveRequest({
        employee_id:      _user.id,
        leave_type_id:    typeId,
        start_date:       start,
        end_date:         isHalf ? start : end,
        days,
        is_half_day:      isHalf,
        half_day_period:  isHalf ? period : null,
        reason,
        status:           'pending',
        approver_id:      approverId,
      })

      btn.disabled    = false
      btn.textContent = 'Submit'

      if (error) {
        errEl.textContent   = error.message
        errEl.style.display = 'block'
        return
      }

      if (approverId) {
        API.createNotification({
          recipient_employee_id: approverId,
          type: 'info',
          message: `${_user.name} submitted a leave request.`,
          module: 'leave_tracker',
        })
      } else {
        _employees
          .filter(e => (e.role === 'super_admin' || e.department === 'people_culture') && e.id !== _user.id)
          .forEach(hr => API.createNotification({
            recipient_employee_id: hr.id,
            type: 'info',
            message: `${_user.name} submitted a leave request (no manager assigned).`,
            module: 'leave_tracker',
          }))
      }
      Utils.closeModal()
      Utils.showToast('Leave request submitted.', 'success')
      await _refreshMyLeaveData()
      _loadTab('my-leaves')
    })
  }

  /* ══════════════════════════════════════════════════════════
     TAB: MY WFH
  ══════════════════════════════════════════════════════════ */
  function _loadMyWfhTab() {
    const toolbar = document.getElementById('lt-toolbar-actions')
    if (toolbar) {
      toolbar.innerHTML = `<button class="btn btn--primary btn--sm" id="lt-apply-wfh-btn">+ Apply WFH</button>`
      document.getElementById('lt-apply-wfh-btn').addEventListener('click', _openApplyWfhModal)
    }

    const content = document.getElementById('lt-content')
    if (!content) return

    content.innerHTML = `
      <div class="section-card">
        <div class="section-card-header">
          <h3>WFH History</h3>
        </div>
        <div class="section-card-body" style="padding:0;">
          ${_renderWfhHistoryTable()}
        </div>
      </div>
    `

    _bindWfhHistoryActions()
  }

  function _renderWfhHistoryTable() {
    if (!_wfhRequests.length) return '<p class="empty-state">No WFH requests yet.</p>'

    return `
      <table class="data-table">
        <thead><tr>
          <th>Dates</th>
          <th>Days</th>
          <th>Status</th>
          <th>Reason</th>
          <th>Work Plan</th>
          <th>Approver</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${_wfhRequests.map(r => `
            <tr>
              <td style="white-space:nowrap;font-size:12px;">
                ${Utils.formatDate(r.start_date)}${r.start_date !== r.end_date ? ' – ' + Utils.formatDate(r.end_date) : ''}
              </td>
              <td>${r.days}</td>
              <td>
                ${STATUS_BADGE[r.status] || r.status}
                ${r.approver_comment ? `<div class="text-sm text-muted" style="margin-top:2px;">${Utils.escapeHtml(Utils.truncate(r.approver_comment, 40))}</div>` : ''}
              </td>
              <td class="text-muted" style="font-size:12px;">${Utils.escapeHtml(Utils.truncate(r.reason || '—', 50))}</td>
              <td style="font-size:12px;max-width:200px;">${r.work_plan ? Utils.escapeHtml(Utils.truncate(r.work_plan, 80)) : '<span class="text-muted">—</span>'}</td>
              <td style="font-size:12px;">${Utils.escapeHtml(r.approver?.name || '—')}</td>
              <td style="white-space:nowrap;">
                ${r.status === 'pending' ? `<button class="btn btn--xs btn--ghost" data-cancel-wfh="${r.id}" style="color:var(--danger);">Cancel</button>` : ''}
                ${r.status === 'approved' ? `<button class="btn btn--xs btn--ghost" data-cancel-wfh-request="${r.id}" style="color:var(--warning);">Request Cancel</button>` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `
  }

  function _bindWfhHistoryActions() {
    document.querySelectorAll('[data-cancel-wfh]').forEach(btn => {
      btn.addEventListener('click', () => _cancelWfh(btn.dataset.cancelWfh))
    })
    document.querySelectorAll('[data-cancel-wfh-request]').forEach(btn => {
      btn.addEventListener('click', () => _requestWfhCancellation(btn.dataset.cancelWfhRequest))
    })
  }

  async function _cancelWfh(id) {
    if (!confirm('Cancel this WFH request?')) return
    const { error } = await API.updateWfhRequest(id, { status: 'cancelled' })
    if (error) {
      Utils.showToast('Failed to cancel: ' + error.message, 'error')
    } else {
      Utils.showToast('WFH request cancelled.', 'success')
      await _refreshMyLeaveData()
      _loadTab(_activeTab)
    }
  }

  async function _requestWfhCancellation(id) {
    const reason = prompt('Reason for cancellation request (optional):')
    if (reason === null) return
    const { error } = await API.updateWfhRequest(id, {
      status:              'cancellation_pending',
      cancellation_reason: reason || null,
    })
    if (error) {
      Utils.showToast('Failed: ' + error.message, 'error')
    } else {
      Utils.showToast('Cancellation request sent.', 'success')
      await _refreshMyLeaveData()
      _loadTab(_activeTab)
    }
  }

  /* ── Apply WFH Modal ──────────────────────────────────── */
  async function _openApplyWfhModal() {
    const todayISO  = _toISO(new Date())
    const now       = new Date()
    const curMonth  = now.getMonth() + 1
    const curYear   = now.getFullYear()

    // Fetch quotas for current month
    const quotaRes  = await API.getWfhQuotas(curMonth, curYear)
    const quotas    = quotaRes.data || []
    const maxDays   = _resolveWfhQuota(quotas, curMonth, curYear)
    const usedDays  = _wfhUsed(curMonth, curYear)

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Apply for WFH</h3>
        <button class="modal-close" onclick="Utils.closeModal()">${CLOSE_SVG}</button>
      </div>
      <div class="modal-body">
        <div id="lt-wfh-modal-err" class="alert alert--danger" style="display:none;"></div>

        <div class="form-group" style="font-size:13px;padding:8px 12px;background:var(--bg-muted,#f8f9fa);border-radius:6px;margin-bottom:12px;">
          ${maxDays !== null
            ? `WFH this month: <strong>${usedDays} / ${maxDays}</strong> days used`
            : `WFH this month: <strong>${usedDays}</strong> days used (no quota limit)`
          }
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Start Date <span class="required">*</span></label>
            <input class="form-input" type="date" id="lt-f-wfh-start" value="${todayISO}" />
          </div>
          <div class="form-group">
            <label class="form-label">End Date <span class="required">*</span></label>
            <input class="form-input" type="date" id="lt-f-wfh-end" value="${todayISO}" />
          </div>
        </div>

        <div class="form-group">
          <div id="lt-wfh-day-count" style="font-size:13px;color:var(--text-muted);"></div>
        </div>

        <div class="form-group">
          <label class="form-label">Reason</label>
          <textarea class="form-input" id="lt-f-wfh-reason" rows="2"
            placeholder="Reason for WFH…" style="resize:vertical;"></textarea>
        </div>

        <div class="form-group">
          <label class="form-label">Work Plan <span class="required">*</span></label>
          <textarea class="form-input" id="lt-f-wfh-work-plan" rows="4"
            placeholder="What will you wrap up today? List your tasks for the day…"
            style="resize:vertical;"></textarea>
          <div class="form-hint">Visible to your manager and HR.</div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="lt-submit-wfh-btn">Submit</button>
      </div>
    `)

    const _updateWfhCount = () => {
      const start = document.getElementById('lt-f-wfh-start')?.value
      const end   = document.getElementById('lt-f-wfh-end')?.value
      const el    = document.getElementById('lt-wfh-day-count')
      if (!el) return
      if (start && end && end >= start) {
        const days = _calcLeaveDays(start, end, false)
        el.textContent = `${days} calendar day${days === 1 ? '' : 's'}`
      } else {
        el.textContent = ''
      }
    }

    document.getElementById('lt-f-wfh-start')?.addEventListener('change', () => {
      const start = document.getElementById('lt-f-wfh-start')?.value
      const endEl = document.getElementById('lt-f-wfh-end')
      if (endEl && endEl.value < start) endEl.value = start
      _updateWfhCount()
    })
    document.getElementById('lt-f-wfh-end')?.addEventListener('change', _updateWfhCount)
    _updateWfhCount()

    document.getElementById('lt-submit-wfh-btn')?.addEventListener('click', async () => {
      const errEl    = document.getElementById('lt-wfh-modal-err')
      const btn      = document.getElementById('lt-submit-wfh-btn')
      const start    = document.getElementById('lt-f-wfh-start').value
      const end      = document.getElementById('lt-f-wfh-end').value
      const reason   = document.getElementById('lt-f-wfh-reason').value.trim()
      const workPlan = document.getElementById('lt-f-wfh-work-plan').value.trim()

      errEl.style.display = 'none'
      if (!start) { errEl.textContent = 'Please select a start date.'; errEl.style.display = 'block'; return }
      if (!end)   { errEl.textContent = 'Please select an end date.';   errEl.style.display = 'block'; return }
      if (end < start) { errEl.textContent = 'End date cannot be before start date.'; errEl.style.display = 'block'; return }
      if (!workPlan) { errEl.textContent = 'Please describe your work plan for the day.'; errEl.style.display = 'block'; return }

      const days = _calcLeaveDays(start, end, false)

      // Check quota
      const reqMonth = new Date(start).getMonth() + 1
      const reqYear  = new Date(start).getFullYear()
      if (maxDays !== null) {
        const projectedUsed = usedDays + days
        if (projectedUsed > maxDays) {
          errEl.textContent   = `WFH quota exceeded. Max ${maxDays} days/month. You've used ${usedDays}.`
          errEl.style.display = 'block'
          return
        }
      }

      const approverId = _resolveApproverId()

      btn.disabled    = true
      btn.textContent = 'Submitting…'

      const { error } = await API.createWfhRequest({
        employee_id:  _user.id,
        start_date:   start,
        end_date:     end,
        days,
        reason:       reason || null,
        work_plan:    workPlan,
        status:       'pending',
        approver_id:  approverId,
      })

      btn.disabled    = false
      btn.textContent = 'Submit'

      if (error) {
        errEl.textContent   = error.message
        errEl.style.display = 'block'
        return
      }

      if (approverId) {
        API.createNotification({
          recipient_employee_id: approverId,
          type: 'info',
          message: `${_user.name} submitted a WFH request.`,
          module: 'leave_tracker',
        })
      } else {
        _employees
          .filter(e => (e.role === 'super_admin' || e.department === 'people_culture') && e.id !== _user.id)
          .forEach(hr => API.createNotification({
            recipient_employee_id: hr.id,
            type: 'info',
            message: `${_user.name} submitted a WFH request (no manager assigned).`,
            module: 'leave_tracker',
          }))
      }
      Utils.closeModal()
      Utils.showToast('WFH request submitted.', 'success')
      await _refreshMyLeaveData()
      _loadTab('my-wfh')
    })
  }

  /* ══════════════════════════════════════════════════════════
     TAB: PENDING APPROVALS
  ══════════════════════════════════════════════════════════ */
  function _loadPendingApprovalsTab() {
    const content = document.getElementById('lt-content')
    if (!content) return

    content.innerHTML = `
      <div class="section-card mb-4">
        <div class="section-card-header">
          <h3>Leave Approvals</h3>
          <span class="badge badge--warning">${_pendingApprovals.length}</span>
        </div>
        <div class="section-card-body" id="lt-leave-approvals-body">
          ${_renderApprovalCards(_pendingApprovals, 'leave')}
        </div>
      </div>

      <div class="section-card">
        <div class="section-card-header">
          <h3>WFH Approvals</h3>
          <span class="badge badge--warning">${_pendingWfh.length}</span>
        </div>
        <div class="section-card-body" id="lt-wfh-approvals-body">
          ${_renderApprovalCards(_pendingWfh, 'wfh')}
        </div>
      </div>
    `

    _bindApprovalCardActions()
  }

  function _renderApprovalCards(requests, type) {
    if (!requests.length) return '<p class="empty-state">No pending approvals.</p>'

    return requests.map(r => {
      const emp         = r.employee || {}
      const initials    = Utils.getInitials(emp.name || '?')
      const isCancPend  = r.status === 'cancellation_pending'
      const typeName    = type === 'leave' ? (r.leave_types?.name || 'Leave') : 'WFH'
      const dateRange   = r.start_date === r.end_date
        ? Utils.formatDate(r.start_date)
        : `${Utils.formatDate(r.start_date)} – ${Utils.formatDate(r.end_date)}`

      return `
        <div class="lt-approval-card section-card" style="margin-bottom:12px;"
          data-approval-id="${r.id}" data-approval-type="${type}">
          <div style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px;">
            <div style="width:36px;height:36px;border-radius:50%;background:var(--primary-light,#e8f0fe);color:var(--primary);font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;">
              ${emp.profile_image_url ? `<img src="${Utils.escapeHtml(emp.profile_image_url)}" alt="" style="width:100%;height:100%;object-fit:cover;">` : Utils.getInitials(emp.name || '?')}
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;font-size:14px;">${Utils.escapeHtml(emp.name || '—')}</div>
              <div style="font-size:12px;color:var(--text-muted);">${Utils.escapeHtml(emp.department || '—')}</div>
              <div style="margin-top:6px;font-size:13px;">
                <strong>${Utils.escapeHtml(typeName)}</strong>
                · ${dateRange}
                · ${r.days} day${Number(r.days) === 1 ? '' : 's'}
                ${type === 'leave' && r.is_half_day ? `<span class="badge badge--muted" style="font-size:10px;margin-left:4px;">Half-day ${r.half_day_period || ''}</span>` : ''}
              </div>
              ${r.reason ? `<div style="font-size:12px;color:var(--text-muted);margin-top:3px;">${Utils.escapeHtml(Utils.truncate(r.reason, 80))}</div>` : ''}
              ${type === 'wfh' && r.work_plan ? `
                <div style="margin-top:8px;padding:8px 10px;background:var(--bg-muted,rgba(0,0,0,0.04));border-radius:6px;border-left:3px solid var(--accent);">
                  <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px;">Work Plan</div>
                  <div style="font-size:13px;white-space:pre-line;">${Utils.escapeHtml(r.work_plan)}</div>
                </div>
              ` : ''}
              ${r.cancellation_reason ? `<div style="font-size:12px;color:var(--warning);margin-top:3px;">Cancellation reason: ${Utils.escapeHtml(r.cancellation_reason)}</div>` : ''}
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0;align-items:flex-start;">
              ${isCancPend ? `
                <button class="btn btn--xs btn--success" data-action="approve-cancel" data-id="${r.id}" data-type="${type}">Approve Cancellation</button>
                <button class="btn btn--xs btn--ghost"   data-action="deny-cancel"    data-id="${r.id}" data-type="${type}" style="color:var(--danger);">Deny</button>
              ` : `
                <button class="btn btn--xs btn--success" data-action="approve" data-id="${r.id}" data-type="${type}">Approve</button>
                <button class="btn btn--xs btn--danger"  data-action="reject"  data-id="${r.id}" data-type="${type}">Reject</button>
              `}
            </div>
          </div>
        </div>
      `
    }).join('')
  }

  function _bindApprovalCardActions() {
    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action
        const id     = btn.dataset.id
        const type   = btn.dataset.type
        if (action === 'approve')        _approveRequest(id, type)
        else if (action === 'reject')    _openRejectModal(id, type)
        else if (action === 'approve-cancel') _approveCancellation(id, type)
        else if (action === 'deny-cancel')    _denyCancellation(id, type)
      })
    })
  }

  async function _approveRequest(id, type) {
    const arr = type === 'leave' ? _pendingApprovals : _pendingWfh
    const req = arr.find(r => r.id === id)

    const updateFn = type === 'leave' ? API.updateLeaveRequest : API.updateWfhRequest
    const { error } = await updateFn(id, {
      status:   'approved',
      acted_at: new Date().toISOString(),
    })
    if (error) {
      Utils.showToast('Failed to approve: ' + error.message, 'error')
    } else {
      if (req?.employee?.id) {
        const label = type === 'leave' ? 'leave' : 'WFH'
        API.createNotification({
          recipient_employee_id: req.employee.id,
          type: 'approval',
          message: `Your ${label} request has been approved.`,
          module: 'leave_tracker',
          record_id: id,
        })
      }
      Utils.showToast('Request approved.', 'success')
      await _refreshApprovalData()
      _loadTab('pending-approvals')
    }
  }

  function _openRejectModal(id, type) {
    const arr = type === 'leave' ? _pendingApprovals : _pendingWfh
    const req = arr.find(r => r.id === id)

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Reject Request</h3>
        <button class="modal-close" onclick="Utils.closeModal()">${CLOSE_SVG}</button>
      </div>
      <div class="modal-body">
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">Reason for rejection <span class="required">*</span></label>
          <textarea class="form-input" id="lt-reject-comment" rows="3"
            placeholder="Explain why this request is being rejected…"
            style="resize:vertical;"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--danger" id="lt-confirm-reject">Reject</button>
      </div>
    `)

    document.getElementById('lt-confirm-reject').addEventListener('click', async () => {
      const comment = document.getElementById('lt-reject-comment').value.trim()
      if (!comment) { Utils.showToast('Please provide a rejection reason.', 'error'); return }

      const btn = document.getElementById('lt-confirm-reject')
      btn.disabled    = true
      btn.textContent = 'Rejecting…'

      const updateFn = type === 'leave' ? API.updateLeaveRequest : API.updateWfhRequest
      const { error } = await updateFn(id, {
        status:           'rejected',
        approver_comment: comment,
        acted_at:         new Date().toISOString(),
      })

      btn.disabled    = false
      btn.textContent = 'Reject'

      if (error) {
        Utils.showToast('Failed: ' + error.message, 'error')
        return
      }

      if (req?.employee?.id) {
        const label = type === 'leave' ? 'leave' : 'WFH'
        API.createNotification({
          recipient_employee_id: req.employee.id,
          type: 'rejection',
          message: `Your ${label} request was rejected${comment ? ': ' + comment : '.'}`,
          module: 'leave_tracker',
          record_id: id,
        })
      }
      Utils.closeModal()
      Utils.showToast('Request rejected.', 'success')
      await _refreshApprovalData()
      _loadTab('pending-approvals')
    })
  }

  async function _approveCancellation(id, type) {
    const arr = type === 'leave' ? _pendingApprovals : _pendingWfh
    const req = arr.find(r => r.id === id)

    const updateFn = type === 'leave' ? API.updateLeaveRequest : API.updateWfhRequest
    const { error } = await updateFn(id, {
      status:   'cancelled',
      acted_at: new Date().toISOString(),
    })
    if (error) {
      Utils.showToast('Failed: ' + error.message, 'error')
    } else {
      if (req?.employee?.id) {
        const label = type === 'leave' ? 'leave' : 'WFH'
        API.createNotification({
          recipient_employee_id: req.employee.id,
          type: 'approval',
          message: `Your ${label} cancellation request has been approved.`,
          module: 'leave_tracker',
          record_id: id,
        })
      }
      Utils.showToast('Cancellation approved.', 'success')
      await _refreshApprovalData()
      _loadTab('pending-approvals')
    }
  }

  async function _denyCancellation(id, type) {
    const arr = type === 'leave' ? _pendingApprovals : _pendingWfh
    const req = arr.find(r => r.id === id)

    const updateFn = type === 'leave' ? API.updateLeaveRequest : API.updateWfhRequest
    const { error } = await updateFn(id, { status: 'approved' })
    if (error) {
      Utils.showToast('Failed: ' + error.message, 'error')
    } else {
      if (req?.employee?.id) {
        const label = type === 'leave' ? 'leave' : 'WFH'
        API.createNotification({
          recipient_employee_id: req.employee.id,
          type: 'rejection',
          message: `Your ${label} cancellation request was denied. The original request remains approved.`,
          module: 'leave_tracker',
          record_id: id,
        })
      }
      Utils.showToast('Cancellation denied. Request restored to approved.', 'success')
      await _refreshApprovalData()
      _loadTab('pending-approvals')
    }
  }

  async function _refreshApprovalData() {
    const [paRes, pwRes] = await Promise.all([
      API.getPendingLeaveApprovals(_user.id),
      API.getPendingWfhApprovals(_user.id),
    ])
    _pendingApprovals = paRes.data || []
    _pendingWfh       = pwRes.data || []

    if (_isHR) {
      const [hrLRes, hrWRes] = await Promise.all([
        API.getHRLeaveQueue(),
        API.getHRWfhQueue(),
      ])
      const hrLeaves = (hrLRes.data || []).filter(r => !_pendingApprovals.some(p => p.id === r.id))
      const hrWfh    = (hrWRes.data || []).filter(r => !_pendingWfh.some(p => p.id === r.id))
      _pendingApprovals = [..._pendingApprovals, ...hrLeaves]
      _pendingWfh       = [..._pendingWfh, ...hrWfh]
    }

    _updateApprovalBadge()
  }

  /* ══════════════════════════════════════════════════════════
     TAB: TEAM OVERVIEW (HR only)
  ══════════════════════════════════════════════════════════ */
  async function _loadTeamOverviewTab() {
    const content = document.getElementById('lt-content')
    if (!content) return
    content.innerHTML = '<p class="loading-text">Loading team overview…</p>'

    const todayISO = _toISO(new Date())

    const [allLeaveRes, allWfhRes] = await Promise.all([
      API.getAllLeaveRequests({ status: 'approved' }),
      API.getAllWfhRequests({ status: 'approved' }),
    ])

    const allLeaves = allLeaveRes.data || []
    const allWfh    = allWfhRes.data   || []

    // Who is on leave today
    const onLeaveToday = allLeaves.filter(r =>
      r.start_date <= todayISO && r.end_date >= todayISO
    )

    // Who is WFH today
    const wfhToday = allWfh.filter(r =>
      r.start_date <= todayISO && r.end_date >= todayISO
    )

    // Who is on leave this week
    const weekStart = _toISO(_getMondayOf(new Date()))
    const weekEnd   = (() => {
      const d = _getMondayOf(new Date())
      d.setDate(d.getDate() + 6)
      return _toISO(d)
    })()
    const onLeaveThisWeek = allLeaves.filter(r =>
      r.start_date <= weekEnd && r.end_date >= weekStart
    )

    const _empCard = (r, typeLabel) => {
      const emp = r.employee || {}
      return `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);">
          <div style="width:30px;height:30px;border-radius:50%;background:var(--primary-light,#e8f0fe);color:var(--primary);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;">
            ${emp.profile_image_url ? `<img src="${Utils.escapeHtml(emp.profile_image_url)}" alt="" style="width:100%;height:100%;object-fit:cover;">` : Utils.getInitials(emp.name || '?')}
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:500;font-size:13px;">${Utils.escapeHtml(emp.name || '—')}</div>
            <div style="font-size:11px;color:var(--text-muted);">${Utils.escapeHtml(emp.department || '—')} · ${Utils.escapeHtml(typeLabel)}</div>
          </div>
          <div style="font-size:12px;color:var(--text-muted);white-space:nowrap;">
            ${Utils.formatDate(r.start_date)} – ${Utils.formatDate(r.end_date)}
          </div>
        </div>
      `
    }

    content.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;" class="mb-4">
        <div class="section-card">
          <div class="section-card-header"><h3>On Leave Today (${onLeaveToday.length})</h3></div>
          <div class="section-card-body">
            ${onLeaveToday.length
              ? onLeaveToday.map(r => _empCard(r, r.leave_types?.name || 'Leave')).join('')
              : '<p class="empty-state">No one on leave today.</p>'
            }
          </div>
        </div>
        <div class="section-card">
          <div class="section-card-header"><h3>WFH Today (${wfhToday.length})</h3></div>
          <div class="section-card-body">
            ${wfhToday.length
              ? wfhToday.map(r => _empCard(r, 'WFH')).join('')
              : '<p class="empty-state">No one WFH today.</p>'
            }
          </div>
        </div>
      </div>

      <div class="section-card mb-4">
        <div class="section-card-header">
          <h3>On Leave This Week (${onLeaveThisWeek.length})</h3>
        </div>
        <div class="section-card-body">
          ${onLeaveThisWeek.length
            ? onLeaveThisWeek.map(r => _empCard(r, r.leave_types?.name || 'Leave')).join('')
            : '<p class="empty-state">No leaves this week.</p>'
          }
        </div>
      </div>

      <div class="section-card">
        <div class="section-card-header">
          <h3>All Pending Requests</h3>
        </div>
        <div class="section-card-body" style="padding:0;">
          ${_renderTeamPendingTable(allLeaves, allWfh)}
        </div>
      </div>
    `
  }

  function _renderTeamPendingTable(leaves, wfh) {
    // Combine all requests, show pending ones
    const allReq = [...leaves, ...wfh].filter(r => r.status === 'pending')
    if (!allReq.length) return '<p class="empty-state">No pending requests.</p>'

    return `
      <table class="data-table">
        <thead><tr>
          <th>Employee</th>
          <th>Type</th>
          <th>Dates</th>
          <th>Days</th>
          <th>Reason</th>
        </tr></thead>
        <tbody>
          ${allReq.map(r => `
            <tr>
              <td>${Utils.escapeHtml(r.employee?.name || '—')}</td>
              <td>${Utils.escapeHtml(r.leave_types?.name || 'WFH')}</td>
              <td style="white-space:nowrap;font-size:12px;">${Utils.formatDate(r.start_date)} – ${Utils.formatDate(r.end_date)}</td>
              <td>${r.days}</td>
              <td class="text-muted" style="font-size:12px;">${Utils.escapeHtml(Utils.truncate(r.reason || '—', 50))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `
  }

  function _getMondayOf(date) {
    const d   = new Date(date)
    const dow = d.getDay()
    d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow))
    d.setHours(0, 0, 0, 0)
    return d
  }

  /* ══════════════════════════════════════════════════════════
     TAB: SETTINGS (HR only)
  ══════════════════════════════════════════════════════════ */
  async function _loadSettingsTab() {
    const content = document.getElementById('lt-content')
    if (!content) return
    content.innerHTML = '<p class="loading-text">Loading settings…</p>'

    const now      = new Date()
    const curMonth = now.getMonth() + 1
    const curYear  = now.getFullYear()

    const [ltRes, holRes, evtRes, quotaRes, creditsRes] = await Promise.all([
      API.getLeaveTypes(),
      API.getCompanyHolidays(curYear),
      API.getCompanyEvents(curYear),
      API.getWfhQuotas(null, curYear),
      API.getAllLeaveCredits(curYear),
    ])

    const allLeaveTypes = ltRes.data       || []
    const allHolidays   = holRes.data      || []
    const allEvents     = evtRes.data      || []
    const allQuotas     = quotaRes.data    || []
    const allCredits    = creditsRes.data  || []

    content.innerHTML = `
      <!-- ── Leave Types ── -->
      <div class="lt-settings-section section-card mb-4">
        <div class="section-card-header">
          <h3>Leave Types</h3>
          <button class="btn btn--primary btn--sm" id="lt-add-type-btn">+ Add Type</button>
        </div>
        <div class="section-card-body" style="padding:0;" id="lt-leave-types-body">
          ${_renderLeaveTypesTable(allLeaveTypes)}
        </div>
        <div id="lt-add-type-form" style="display:none;padding:14px 16px;border-top:1px solid var(--border);">
          <div style="display:flex;gap:10px;align-items:flex-end;">
            <div class="form-group" style="flex:1;margin-bottom:0;">
              <label class="form-label">Name</label>
              <input class="form-input" type="text" id="lt-new-type-name" placeholder="e.g. Casual Leave" />
            </div>
            <button class="btn btn--primary btn--sm" id="lt-save-type-btn">Save</button>
            <button class="btn btn--ghost btn--sm" id="lt-cancel-type-btn">Cancel</button>
          </div>
        </div>
      </div>

      <!-- ── WFH Quotas ── -->
      <div class="lt-settings-section section-card mb-4">
        <div class="section-card-header">
          <h3>WFH Quotas</h3>
          <button class="btn btn--primary btn--sm" id="lt-add-quota-btn">+ Add Quota</button>
        </div>
        <div style="padding:8px 16px;display:flex;align-items:center;gap:8px;font-size:13px;">
          <label class="form-label" style="margin:0;">Month:</label>
          <input class="form-input" type="month" id="lt-quota-month"
            value="${curYear}-${String(curMonth).padStart(2,'0')}"
            style="width:160px;" />
        </div>
        <div class="section-card-body" style="padding:0;" id="lt-wfh-quotas-body">
          ${_renderWfhQuotasTable(allQuotas, curMonth, curYear)}
        </div>
        <div id="lt-add-quota-form" style="display:none;padding:14px 16px;border-top:1px solid var(--border);">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto auto;gap:10px;align-items:flex-end;">
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">Scope</label>
              <select class="form-select" id="lt-q-scope">
                <option value="department">Department</option>
                <option value="individual">Individual</option>
              </select>
            </div>
            <div class="form-group" style="margin-bottom:0;" id="lt-q-dept-wrap">
              <label class="form-label">Department</label>
              <select class="form-select" id="lt-q-dept">
                <option value="">— Select department —</option>
                ${[...new Set(_employees.map(e => e.department).filter(Boolean))].sort().map(slug =>
                  `<option value="${slug}">${Utils.escapeHtml(Utils.getDeptLabel(slug))}</option>`
                ).join('')}
              </select>
            </div>
            <div class="form-group" style="margin-bottom:0;" id="lt-q-emp-wrap" style="display:none;">
              <label class="form-label">Employee</label>
              <select class="form-select" id="lt-q-emp">
                <option value="">— Select employee —</option>
                ${_employees.filter(e => e.status === 'active').sort((a,b) => a.name.localeCompare(b.name)).map(e =>
                  `<option value="${e.id}">${Utils.escapeHtml(e.name)}</option>`
                ).join('')}
              </select>
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">Max Days/Month</label>
              <input class="form-input" type="number" id="lt-q-max" min="1" placeholder="8" />
            </div>
            <button class="btn btn--primary btn--sm" id="lt-save-quota-btn">Save</button>
            <button class="btn btn--ghost btn--sm" id="lt-cancel-quota-btn">Cancel</button>
          </div>
        </div>
      </div>

      <!-- ── Holidays ── -->
      <div class="lt-settings-section section-card mb-4">
        <div class="section-card-header">
          <h3>Holidays (${curYear})</h3>
          <button class="btn btn--primary btn--sm" id="lt-add-holiday-btn">+ Add Holiday</button>
        </div>
        <div class="section-card-body" style="padding:0;" id="lt-holidays-body">
          ${_renderHolidaysTable(allHolidays)}
        </div>
        <div id="lt-add-holiday-form" style="display:none;padding:14px 16px;border-top:1px solid var(--border);">
          <div style="display:flex;gap:10px;align-items:flex-end;">
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">Date</label>
              <input class="form-input" type="date" id="lt-new-hol-date" />
            </div>
            <div class="form-group" style="flex:1;margin-bottom:0;">
              <label class="form-label">Name</label>
              <input class="form-input" type="text" id="lt-new-hol-name" placeholder="e.g. Diwali" />
            </div>
            <button class="btn btn--primary btn--sm" id="lt-save-holiday-btn">Save</button>
            <button class="btn btn--ghost btn--sm" id="lt-cancel-holiday-btn">Cancel</button>
          </div>
        </div>
      </div>

      <!-- ── Leave Credits ── -->
      <div class="lt-settings-section section-card mb-4">
        <div class="section-card-header">
          <h3>Leave Allocations</h3>
          <div style="display:flex;align-items:center;gap:8px;">
            <input class="form-input" type="number" id="lt-credits-year"
              value="${curYear}" min="2020" max="2099"
              style="width:80px;text-align:center;" />
            <button class="btn btn--primary btn--sm" id="lt-add-credit-btn">+ Add Allocation</button>
          </div>
        </div>
        <div class="section-card-body" style="padding:0;" id="lt-credits-body">
          ${_renderCreditsTable(allCredits, allLeaveTypes)}
        </div>
        <div id="lt-add-credit-form" style="display:none;padding:14px 16px;border-top:1px solid var(--border);">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:10px;align-items:flex-end;margin-bottom:10px;">
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">Employee</label>
              <select class="form-select" id="lt-lc-emp">
                <option value="">— Select employee —</option>
                ${_employees.filter(e => e.status === 'active').sort((a,b) => a.name.localeCompare(b.name)).map(e =>
                  `<option value="${e.id}">${Utils.escapeHtml(e.name)}</option>`
                ).join('')}
              </select>
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">Leave Type</label>
              <select class="form-select" id="lt-lc-type">
                <option value="">— Select type —</option>
                ${allLeaveTypes.filter(t => t.is_active).map(t =>
                  `<option value="${t.id}">${Utils.escapeHtml(t.name)}</option>`
                ).join('')}
              </select>
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">Days</label>
              <input class="form-input" type="number" id="lt-lc-days" min="0.5" step="0.5" placeholder="e.g. 12" />
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">Year</label>
              <input class="form-input" type="number" id="lt-lc-year-field"
                value="${curYear}" min="2020" max="2099" style="width:80px;" />
            </div>
          </div>
          <div class="form-group" style="margin-bottom:10px;">
            <label class="form-label">Notes (optional)</label>
            <input class="form-input" type="text" id="lt-lc-notes" placeholder="e.g. Annual allocation 2026" />
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn btn--primary btn--sm" id="lt-save-credit-btn">Save Allocation</button>
            <button class="btn btn--ghost btn--sm" id="lt-cancel-credit-btn">Cancel</button>
          </div>
        </div>
      </div>

      <!-- ── Company Events ── -->
      <div class="lt-settings-section section-card">
        <div class="section-card-header">
          <h3>Company Events (${curYear})</h3>
          <button class="btn btn--primary btn--sm" id="lt-add-event-btn">+ Add Event</button>
        </div>
        <div class="section-card-body" style="padding:0;" id="lt-events-body">
          ${_renderEventsTable(allEvents)}
        </div>
        <div id="lt-add-event-form" style="display:none;padding:14px 16px;border-top:1px solid var(--border);">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px;">
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">Title</label>
              <input class="form-input" type="text" id="lt-new-evt-title" placeholder="Event title" />
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">Start Date</label>
              <input class="form-input" type="date" id="lt-new-evt-start" />
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">End Date</label>
              <input class="form-input" type="date" id="lt-new-evt-end" />
            </div>
          </div>
          <div class="form-group" style="margin-bottom:10px;">
            <label class="form-label">Description</label>
            <textarea class="form-input" id="lt-new-evt-desc" rows="2" style="resize:vertical;"></textarea>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn btn--primary btn--sm" id="lt-save-event-btn">Save</button>
            <button class="btn btn--ghost btn--sm" id="lt-cancel-event-btn">Cancel</button>
          </div>
        </div>
      </div>
    `

    _bindSettingsActions(allLeaveTypes, allQuotas, allHolidays, allEvents, allCredits, curMonth, curYear)
  }

  /* ── Leave Types table ────────────────────────────────── */
  function _renderLeaveTypesTable(types) {
    if (!types.length) return '<p class="empty-state">No leave types configured.</p>'
    return `
      <table class="data-table">
        <thead><tr><th>Name</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${types.map(t => `
            <tr class="lt-type-row" data-type-id="${t.id}">
              <td id="lt-type-name-${t.id}">${Utils.escapeHtml(t.name)}</td>
              <td>
                <span class="badge ${t.is_active ? 'badge--success' : 'badge--muted'}">
                  ${t.is_active ? 'Active' : 'Inactive'}
                </span>
              </td>
              <td style="white-space:nowrap;">
                <button class="btn btn--xs btn--ghost" data-edit-type="${t.id}" data-name="${Utils.escapeHtml(t.name)}">Edit</button>
                <button class="btn btn--xs btn--ghost" data-toggle-type="${t.id}" data-active="${t.is_active}"
                  style="margin-left:4px;">${t.is_active ? 'Deactivate' : 'Activate'}</button>
                <button class="btn btn--xs btn--ghost" data-delete-type="${t.id}"
                  style="margin-left:4px;color:var(--danger);">Delete</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `
  }

  /* ── WFH Quotas table ─────────────────────────────────── */
  function _renderWfhQuotasTable(quotas, month, year) {
    const filtered = quotas.filter(q => q.month === month && q.year === year)
    if (!filtered.length) return '<p class="empty-state">No quotas for this period.</p>'
    return `
      <table class="data-table">
        <thead><tr><th>Scope</th><th>Target</th><th>Max Days/Month</th><th></th></tr></thead>
        <tbody>
          ${filtered.map(q => `
            <tr>
              <td>${q.scope === 'individual' ? 'Individual' : 'Department'}</td>
              <td>${q.scope === 'individual'
                    ? Utils.escapeHtml((_employees.find(e => e.id === q.employee_id)?.name) || q.employee_id || '—')
                    : Utils.escapeHtml(Utils.getDeptLabel(q.department) || q.department || '—')
                  }</td>
              <td>${q.max_days}</td>
              <td>
                <button class="btn btn--xs btn--ghost" data-delete-quota="${q.id}"
                  style="color:var(--danger);">Delete</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `
  }

  /* ── Holidays table ───────────────────────────────────── */
  function _renderHolidaysTable(holidays) {
    if (!holidays.length) return '<p class="empty-state">No holidays added.</p>'
    return `
      <table class="data-table">
        <thead><tr><th>Date</th><th>Name</th><th></th></tr></thead>
        <tbody>
          ${holidays.map(h => `
            <tr>
              <td>${Utils.formatDate(h.date)}</td>
              <td>${Utils.escapeHtml(h.name)}</td>
              <td>
                <button class="btn btn--xs btn--ghost" data-delete-holiday="${h.id}"
                  style="color:var(--danger);">Delete</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `
  }

  /* ── Events table ─────────────────────────────────────── */
  function _renderEventsTable(events) {
    if (!events.length) return '<p class="empty-state">No events added.</p>'
    return `
      <table class="data-table">
        <thead><tr><th>Title</th><th>Dates</th><th>Description</th><th></th></tr></thead>
        <tbody>
          ${events.map(ev => `
            <tr data-event-id="${ev.id}">
              <td>${Utils.escapeHtml(ev.title)}</td>
              <td style="white-space:nowrap;font-size:12px;">
                ${Utils.formatDate(ev.start_date)}${ev.end_date && ev.end_date !== ev.start_date ? ' – ' + Utils.formatDate(ev.end_date) : ''}
              </td>
              <td class="text-muted" style="font-size:12px;">${Utils.escapeHtml(Utils.truncate(ev.description || '—', 60))}</td>
              <td style="white-space:nowrap;">
                <button class="btn btn--xs btn--ghost" data-edit-event="${ev.id}"
                  data-title="${Utils.escapeHtml(ev.title)}"
                  data-start="${ev.start_date}"
                  data-end="${ev.end_date || ''}"
                  data-desc="${Utils.escapeHtml(ev.description || '')}">Edit</button>
                <button class="btn btn--xs btn--ghost" data-delete-event="${ev.id}"
                  style="margin-left:4px;color:var(--danger);">Delete</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `
  }

  /* ── Leave Credits table ──────────────────────────────── */
  function _renderCreditsTable(credits, leaveTypes) {
    if (!credits.length) return '<p class="empty-state">No allocations yet. Use "+ Add Allocation" to credit leave days to employees.</p>'
    return `
      <table class="data-table">
        <thead>
          <tr>
            <th>Employee</th>
            <th>Leave Type</th>
            <th>Days</th>
            <th>Year</th>
            <th>Notes</th>
            <th>Credited By</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${credits.map(c => `
            <tr>
              <td>${Utils.escapeHtml(c.employees?.name || '—')}</td>
              <td>${Utils.escapeHtml(c.leave_types?.name || '—')}</td>
              <td><strong>${c.credited_days}</strong></td>
              <td>${c.year}</td>
              <td class="text-muted" style="font-size:12px;">${Utils.escapeHtml(c.notes || '—')}</td>
              <td style="font-size:12px;">${Utils.escapeHtml(c.credited_by_emp?.name || '—')}</td>
              <td>
                <button class="btn btn--xs btn--ghost" data-delete-credit="${c.id}"
                  style="color:var(--danger);">Delete</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `
  }

  /* ── Settings event binding ───────────────────────────── */
  function _bindSettingsActions(allLeaveTypes, allQuotas, allHolidays, allEvents, allCredits, curMonth, curYear) {

    /* ── Leave Type actions ── */
    document.getElementById('lt-add-type-btn')?.addEventListener('click', () => {
      document.getElementById('lt-add-type-form').style.display = 'block'
      document.getElementById('lt-new-type-name').focus()
    })
    document.getElementById('lt-cancel-type-btn')?.addEventListener('click', () => {
      document.getElementById('lt-add-type-form').style.display = 'none'
      document.getElementById('lt-new-type-name').value = ''
    })
    document.getElementById('lt-save-type-btn')?.addEventListener('click', async () => {
      const name = document.getElementById('lt-new-type-name').value.trim()
      if (!name) { Utils.showToast('Please enter a name.', 'error'); return }
      const btn = document.getElementById('lt-save-type-btn')
      btn.disabled = true
      const { error } = await API.createLeaveType({ name, is_active: true })
      btn.disabled = false
      if (error) { Utils.showToast('Failed: ' + error.message, 'error'); return }
      Utils.showToast('Leave type added.', 'success')
      _loadSettingsTab()
    })

    document.querySelectorAll('[data-edit-type]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id      = btn.dataset.editType
        const current = btn.dataset.name
        const nameEl  = document.getElementById(`lt-type-name-${id}`)
        if (!nameEl) return
        nameEl.innerHTML = `
          <input class="form-input" type="text" id="lt-inline-name-${id}"
            value="${Utils.escapeHtml(current)}" style="max-width:200px;padding:4px 8px;font-size:13px;" />
          <button class="btn btn--xs btn--primary" style="margin-left:6px;" data-save-type-inline="${id}">Save</button>
          <button class="btn btn--xs btn--ghost" style="margin-left:4px;" data-cancel-type-inline="${id}">Cancel</button>
        `
        document.querySelector(`[data-save-type-inline="${id}"]`)?.addEventListener('click', async () => {
          const newName = document.getElementById(`lt-inline-name-${id}`)?.value.trim()
          if (!newName) { Utils.showToast('Name cannot be empty.', 'error'); return }
          const { error } = await API.updateLeaveType(id, { name: newName })
          if (error) { Utils.showToast('Failed: ' + error.message, 'error'); return }
          Utils.showToast('Updated.', 'success')
          _loadSettingsTab()
        })
        document.querySelector(`[data-cancel-type-inline="${id}"]`)?.addEventListener('click', () => {
          _loadSettingsTab()
        })
      })
    })

    document.querySelectorAll('[data-toggle-type]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id       = btn.dataset.toggleType
        const isActive = btn.dataset.active === 'true'
        const { error } = await API.updateLeaveType(id, { is_active: !isActive })
        if (error) { Utils.showToast('Failed: ' + error.message, 'error'); return }
        Utils.showToast(`Leave type ${!isActive ? 'activated' : 'deactivated'}.`, 'success')
        _loadSettingsTab()
      })
    })

    document.querySelectorAll('[data-delete-type]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this leave type? This cannot be undone.')) return
        const { error } = await API.deleteLeaveType(btn.dataset.deleteType)
        if (error) { Utils.showToast('Failed: ' + error.message, 'error'); return }
        Utils.showToast('Leave type deleted.', 'success')
        _loadSettingsTab()
      })
    })

    /* ── Leave Credits (Allocations) actions ── */
    document.getElementById('lt-credits-year')?.addEventListener('change', async function () {
      const yr = parseInt(this.value, 10)
      if (!yr || yr < 2020) return
      const res = await API.getAllLeaveCredits(yr)
      const body = document.getElementById('lt-credits-body')
      if (body) body.innerHTML = _renderCreditsTable(res.data || [], allLeaveTypes)
      _bindCreditDeleteButtons()
    })

    document.getElementById('lt-add-credit-btn')?.addEventListener('click', () => {
      document.getElementById('lt-add-credit-form').style.display = 'block'
      document.getElementById('lt-lc-emp').focus()
    })
    document.getElementById('lt-cancel-credit-btn')?.addEventListener('click', () => {
      document.getElementById('lt-add-credit-form').style.display = 'none'
    })
    document.getElementById('lt-save-credit-btn')?.addEventListener('click', async () => {
      const empId       = document.getElementById('lt-lc-emp').value
      const leaveTypeId = document.getElementById('lt-lc-type').value
      const days        = parseFloat(document.getElementById('lt-lc-days').value)
      const year        = parseInt(document.getElementById('lt-lc-year-field').value, 10)
      const notes       = document.getElementById('lt-lc-notes').value.trim()

      if (!empId)       { Utils.showToast('Select an employee.', 'error');   return }
      if (!leaveTypeId) { Utils.showToast('Select a leave type.', 'error');  return }
      if (!days || days < 0.5) { Utils.showToast('Enter valid days (min 0.5).', 'error'); return }
      if (!year || year < 2020) { Utils.showToast('Enter a valid year.', 'error'); return }

      const payload = {
        employee_id:   empId,
        leave_type_id: leaveTypeId,
        credited_days: days,
        year,
        credited_by:   _user.id,
      }
      if (notes) payload.notes = notes

      const btn = document.getElementById('lt-save-credit-btn')
      btn.disabled = true
      const { error } = await API.addLeaveCredit(payload)
      btn.disabled = false
      if (error) { Utils.showToast('Failed: ' + error.message, 'error'); return }
      Utils.showToast('Leave allocation saved.', 'success')
      _loadSettingsTab()
    })

    _bindCreditDeleteButtons()

    /* ── WFH Quota actions ── */
    const quotaMonthEl = document.getElementById('lt-quota-month')
    quotaMonthEl?.addEventListener('change', async () => {
      const [y, m] = quotaMonthEl.value.split('-').map(Number)
      const res = await API.getWfhQuotas(m, y)
      const quotas = res.data || []
      const body = document.getElementById('lt-wfh-quotas-body')
      if (body) body.innerHTML = _renderWfhQuotasTable(quotas, m, y)
      _bindQuotaDeleteButtons()
    })

    document.getElementById('lt-add-quota-btn')?.addEventListener('click', () => {
      document.getElementById('lt-add-quota-form').style.display = 'block'
    })
    document.getElementById('lt-cancel-quota-btn')?.addEventListener('click', () => {
      document.getElementById('lt-add-quota-form').style.display = 'none'
    })
    document.getElementById('lt-q-scope')?.addEventListener('change', function () {
      const isDept = this.value === 'department'
      const deptWrap = document.getElementById('lt-q-dept-wrap')
      const empWrap  = document.getElementById('lt-q-emp-wrap')
      if (deptWrap) deptWrap.style.display = isDept ? '' : 'none'
      if (empWrap)  empWrap.style.display  = isDept ? 'none' : ''
    })
    document.getElementById('lt-save-quota-btn')?.addEventListener('click', async () => {
      const scope   = document.getElementById('lt-q-scope').value
      const maxDays = parseInt(document.getElementById('lt-q-max').value, 10)
      const [selYear, selMonth] = (document.getElementById('lt-quota-month')?.value || `${curYear}-${String(curMonth).padStart(2,'0')}`).split('-').map(Number)
      if (!maxDays || maxDays < 1) { Utils.showToast('Enter a valid max days value.', 'error'); return }

      const payload = { scope, max_days: maxDays, month: selMonth, year: selYear }
      if (scope === 'department') {
        const dept = document.getElementById('lt-q-dept').value
        if (!dept) { Utils.showToast('Select a department.', 'error'); return }
        payload.department = dept
      } else {
        const empId = document.getElementById('lt-q-emp').value
        if (!empId) { Utils.showToast('Select an employee.', 'error'); return }
        payload.employee_id = empId
      }

      const btn = document.getElementById('lt-save-quota-btn')
      btn.disabled = true
      const { error } = await API.createWfhQuota(payload)
      btn.disabled = false
      if (error) { Utils.showToast('Failed: ' + error.message, 'error'); return }
      Utils.showToast('WFH quota saved.', 'success')
      _loadSettingsTab()
    })

    _bindQuotaDeleteButtons()

    /* ── Holiday actions ── */
    document.getElementById('lt-add-holiday-btn')?.addEventListener('click', () => {
      document.getElementById('lt-add-holiday-form').style.display = 'block'
    })
    document.getElementById('lt-cancel-holiday-btn')?.addEventListener('click', () => {
      document.getElementById('lt-add-holiday-form').style.display = 'none'
    })
    document.getElementById('lt-save-holiday-btn')?.addEventListener('click', async () => {
      const date = document.getElementById('lt-new-hol-date').value
      const name = document.getElementById('lt-new-hol-name').value.trim()
      if (!date) { Utils.showToast('Select a date.', 'error'); return }
      if (!name) { Utils.showToast('Enter a holiday name.', 'error'); return }
      const btn = document.getElementById('lt-save-holiday-btn')
      btn.disabled = true
      const { error } = await API.addCompanyHoliday({ date, name })
      btn.disabled = false
      if (error) { Utils.showToast('Failed: ' + error.message, 'error'); return }
      Utils.showToast('Holiday added.', 'success')
      const holRes = await API.getCompanyHolidays(curYear)
      _holidays = holRes.data || []
      _loadSettingsTab()
    })

    document.querySelectorAll('[data-delete-holiday]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this holiday?')) return
        const { error } = await API.deleteCompanyHoliday(btn.dataset.deleteHoliday)
        if (error) { Utils.showToast('Failed: ' + error.message, 'error'); return }
        Utils.showToast('Holiday deleted.', 'success')
        const holRes = await API.getCompanyHolidays(curYear)
        _holidays = holRes.data || []
        _loadSettingsTab()
      })
    })

    /* ── Company Event actions ── */
    document.getElementById('lt-add-event-btn')?.addEventListener('click', () => {
      // Clear any existing editing state
      document.getElementById('lt-new-evt-title').value = ''
      document.getElementById('lt-new-evt-start').value = ''
      document.getElementById('lt-new-evt-end').value   = ''
      document.getElementById('lt-new-evt-desc').value  = ''
      document.getElementById('lt-save-event-btn').dataset.editEventId = ''
      document.getElementById('lt-add-event-form').style.display = 'block'
    })
    document.getElementById('lt-cancel-event-btn')?.addEventListener('click', () => {
      document.getElementById('lt-add-event-form').style.display = 'none'
      document.getElementById('lt-save-event-btn').dataset.editEventId = ''
    })
    document.getElementById('lt-save-event-btn')?.addEventListener('click', async () => {
      const title   = document.getElementById('lt-new-evt-title').value.trim()
      const start   = document.getElementById('lt-new-evt-start').value
      const end     = document.getElementById('lt-new-evt-end').value
      const desc    = document.getElementById('lt-new-evt-desc').value.trim()
      const editId  = document.getElementById('lt-save-event-btn').dataset.editEventId

      if (!title) { Utils.showToast('Enter an event title.', 'error'); return }
      if (!start) { Utils.showToast('Select a start date.', 'error'); return }

      const btn = document.getElementById('lt-save-event-btn')
      btn.disabled = true

      let error
      if (editId) {
        ;({ error } = await API.updateCompanyEvent(editId, {
          title, start_date: start, end_date: end || start, description: desc || null,
        }))
      } else {
        ;({ error } = await API.createCompanyEvent({
          title, start_date: start, end_date: end || start, description: desc || null,
          created_by: _user.id,
        }))
      }

      btn.disabled = false
      if (error) { Utils.showToast('Failed: ' + error.message, 'error'); return }
      Utils.showToast(editId ? 'Event updated.' : 'Event created.', 'success')
      const evtRes = await API.getCompanyEvents(curYear)
      _events = evtRes.data || []
      _loadSettingsTab()
    })

    document.querySelectorAll('[data-edit-event]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('lt-new-evt-title').value = btn.dataset.title
        document.getElementById('lt-new-evt-start').value = btn.dataset.start
        document.getElementById('lt-new-evt-end').value   = btn.dataset.end || ''
        document.getElementById('lt-new-evt-desc').value  = btn.dataset.desc || ''
        document.getElementById('lt-save-event-btn').dataset.editEventId = btn.dataset.editEvent
        document.getElementById('lt-add-event-form').style.display = 'block'
        document.getElementById('lt-new-evt-title').focus()
      })
    })

    document.querySelectorAll('[data-delete-event]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this event?')) return
        const { error } = await API.deleteCompanyEvent(btn.dataset.deleteEvent)
        if (error) { Utils.showToast('Failed: ' + error.message, 'error'); return }
        Utils.showToast('Event deleted.', 'success')
        const evtRes = await API.getCompanyEvents(curYear)
        _events = evtRes.data || []
        _loadSettingsTab()
      })
    })
  }

  function _bindQuotaDeleteButtons() {
    document.querySelectorAll('[data-delete-quota]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this WFH quota?')) return
        const { error } = await API.deleteWfhQuota(btn.dataset.deleteQuota)
        if (error) { Utils.showToast('Failed: ' + error.message, 'error'); return }
        Utils.showToast('Quota deleted.', 'success')
        const quotaEl = document.getElementById('lt-quota-month')
        const [y, m]  = (quotaEl?.value || `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`).split('-').map(Number)
        const res = await API.getWfhQuotas(m, y)
        const body = document.getElementById('lt-wfh-quotas-body')
        if (body) body.innerHTML = _renderWfhQuotasTable(res.data || [], m, y)
        _bindQuotaDeleteButtons()
      })
    })
  }

  function _bindCreditDeleteButtons() {
    document.querySelectorAll('[data-delete-credit]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this leave allocation? This will reduce the employee\'s leave balance.')) return
        const { error } = await API.deleteLeaveCredit(btn.dataset.deleteCredit)
        if (error) { Utils.showToast('Failed: ' + error.message, 'error'); return }
        Utils.showToast('Allocation deleted.', 'success')
        const yr  = parseInt(document.getElementById('lt-credits-year')?.value || new Date().getFullYear(), 10)
        const res = await API.getAllLeaveCredits(yr)
        const body = document.getElementById('lt-credits-body')
        const ltRes = await API.getLeaveTypes()
        if (body) body.innerHTML = _renderCreditsTable(res.data || [], ltRes.data || [])
        _bindCreditDeleteButtons()
      })
    })
  }

  /* ══════════════════════════════════════════════════════════
     PUBLIC API
  ══════════════════════════════════════════════════════════ */
  return { render, init }

})()
