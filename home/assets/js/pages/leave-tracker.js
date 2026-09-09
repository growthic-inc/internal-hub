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
  let _pendingApprovals  = []
  let _pendingWfh        = []
  let _historyLeave      = []
  let _historyWfh        = []
  let _clientVisits        = []   // my client-visit requests
  let _pendingClientVisits = []
  let _historyClientVisit  = []
  let _pendingCorrections  = []   // late half-day correction requests awaiting my decision
  let _isManager          = false
  let _isHR               = false   // can manage settings/holidays/quotas
  let _canApproveLeave    = false   // can approve team leave/WFH requests
  let _isSolePC           = false   // true if viewer is the only P&C-tagged person company-wide
  let _attendanceRecords  = []      // employee_attendance rows for current month
  let _attendanceMonth    = null    // Date: first day of displayed month
  let _lateThreshold        = '10:30'   // HH:MM from app_settings
  let _lateEffectiveFrom    = ''        // YYYY-MM from app_settings

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

  // ISO date string (YYYY-MM-DD) using LOCAL date components to avoid
  // UTC conversion shifting the date back for IST/+ve offset timezones
  function _calcLateMinutes(punchIn, recordDate) {
    if (!punchIn || !_lateThreshold) return 0
    if (_lateEffectiveFrom && recordDate.substring(0, 7) < _lateEffectiveFrom) return 0
    const [ph, pm] = punchIn.split(':').map(Number)
    const [th, tm] = _lateThreshold.split(':').map(Number)
    return Math.max(0, (ph * 60 + pm) - (th * 60 + tm))
  }

  function _toISO(date) {
    const d   = new Date(date)
    const y   = d.getFullYear()
    const m   = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
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

  // Resolve approver with Management fallback.
  // If the direct manager has an approved full-day leave overlapping
  // [startISO, endISO], route to the first active Management dept member
  // instead. WFH does NOT trigger rerouting (manager is still working).
  // Falls back to the HR queue (null) if Management dept is empty.
  async function _resolveApproverWithFallback(startISO, endISO) {
    const managerId = _user.manager_id
    if (!managerId) return null  // no manager → existing HR queue behavior

    // Fetch manager's approved leaves and check for full-day overlap
    try {
      const { leaves } = await API.getApprovedLeaveForEmployee(managerId)
      const managerOnLeave = (leaves || [])
        .filter(l => !l.is_half_day)
        .some(l => l.start_date <= endISO && l.end_date >= startISO)

      if (!managerOnLeave) return managerId  // manager available — normal routing

      // Manager is on approved leave → route to Management dept
      const mgmt = _employees.filter(e =>
        e.status === 'active' &&
        Utils.getDeptSystemKey(e.department) === 'management' &&
        e.id !== _user.id
      )
      return mgmt.length ? mgmt[0].id : null  // null → HR queue if Mgmt is empty
    } catch (_) {
      return managerId  // on any error, fall back to normal routing
    }
  }

  // ── Request-type helpers (leave | wfh | client-visit) ───────
  function _reqPending(type) {
    return type === 'leave' ? _pendingApprovals
         : type === 'wfh'   ? _pendingWfh
         : _pendingClientVisits
  }
  function _reqHistory(type) {
    return type === 'leave' ? _historyLeave
         : type === 'wfh'   ? _historyWfh
         : _historyClientVisit
  }
  function _reqUpdateFn(type) {
    return type === 'leave' ? API.updateLeaveRequest
         : type === 'wfh'   ? API.updateWfhRequest
         : API.updateClientVisit
  }
  function _reqLabel(type) {
    return type === 'leave' ? 'leave' : type === 'wfh' ? 'WFH' : 'Client Visit'
  }
  // Human label for a client-visit duration_type
  function _cvDurationLabel(d) {
    return d === 'first_half' ? 'First Half' : d === 'second_half' ? 'Second Half' : 'Full Day'
  }
  // Client + entity display for a client-visit record
  function _cvClientLabel(r) {
    const c = r.clients?.client_name || 'Client'
    const e = r.entity?.entity_name
    return e ? `${c} — ${e}` : c
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
    const tabs = [
      { id: 'attendance',         label: 'Attendance' },
      { id: 'my-leaves',          label: 'My Leaves' },
      { id: 'my-wfh',             label: 'My WFH' },
      { id: 'my-client-visits',   label: 'My Client Visits' },
      { id: 'pending-approvals',  label: 'Pending Approvals' },
    ]

    return `
      <div class="page-inner">
        <div class="page-toolbar">
          <div class="tabs" id="lt-tabs">
            ${tabs.map(t => `
              <button
                class="tab-btn${t.id === 'attendance' ? ' tab-btn--active' : ''}"
                data-tab="${t.id}"
                id="lt-tab-${t.id}"
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
    _user             = user
    _isHR             = App.hasAccess('leave_tracker', 'manage_leave_settings', 'can_manage')
    _canApproveLeave  = App.hasAccess('leave_tracker', 'approve_leave', 'can_approve')
    _calMonth         = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    _attendanceMonth  = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    _activeTab        = 'attendance'

    // Fetch all employees to determine manager status
    const empRes = await API.getAllEmployees()
    _employees = empRes.data || []
    _isManager = _employees.some(e => e.manager_id === _user.id)
    // If the viewer is the only P&C-tagged person company-wide, there's nobody
    // else to act on their own requests — let their own queue show them rather
    // than leaving them permanently stuck.
    _isSolePC = _employees.filter(e => e.role === 'super_admin' || Utils.getDeptSystemKey(e.department) === 'people_culture').length <= 1

    // Show/hide conditional tab — visible to direct managers AND anyone with approve_leave access
    const approvalTab = document.getElementById('lt-tab-pending-approvals')
    if (approvalTab) {
      approvalTab.style.display = (_isManager || _isHR || _canApproveLeave) ? '' : 'none'
    }

    // Fetch core data in parallel
    const [ltRes, lrRes, wfhRes, cvRes, lcRes, holRes, evtRes] = await Promise.all([
      API.getLeaveTypes(true),
      API.getMyLeaveRequests(_user.id),
      API.getMyWfhRequests(_user.id),
      API.getMyClientVisits(_user.id),
      API.getLeaveCredits(_user.id, currentYear),
      API.getCompanyHolidays(currentYear),
      API.getCompanyEvents(currentYear),
    ])

    _leaveTypes    = ltRes.data  || []
    _leaveRequests = lrRes.data  || []
    _wfhRequests   = wfhRes.data || []
    _clientVisits  = cvRes.data  || []
    _leaveCredits  = lcRes.data  || []
    _holidays      = holRes.data || []
    _events        = evtRes.data || []

    // Fetch pending approvals + history if manager, HR, or has approve_leave access
    if (_isManager || _isHR || _canApproveLeave) {
      const [paRes, pwRes, pcvRes, hlRes, hwRes, hcvRes, pcorRes] = await Promise.all([
        API.getPendingLeaveApprovals(_user.id),
        API.getPendingWfhApprovals(_user.id),
        API.getPendingClientVisitApprovals(_user.id),
        API.getApprovalHistoryLeave(_user.id),
        API.getApprovalHistoryWfh(_user.id),
        API.getApprovalHistoryClientVisit(_user.id),
        API.getPendingCorrections(_user.id),
      ])
      _pendingApprovals    = paRes.data  || []
      _pendingWfh          = pwRes.data  || []
      _pendingClientVisits = pcvRes.data || []
      _historyLeave        = hlRes.data  || []
      _historyWfh          = hwRes.data  || []
      _historyClientVisit  = hcvRes.data || []
      _pendingCorrections   = pcorRes.data || []

      if (_isHR) {
        const [hrLRes, hrWRes, hrCvRes] = await Promise.all([
          API.getHRLeaveQueue(),
          API.getHRWfhQueue(),
          API.getHRClientVisitQueue(),
        ])
        // Merge HR queue — deduplicate by id, and never surface a P&C
        // member's own request in the queue they'd act from.
        const hrLeaves = (hrLRes.data || []).filter(r => !_pendingApprovals.some(p => p.id === r.id) && (_isSolePC || r.employee_id !== _user.id))
        const hrWfh    = (hrWRes.data || []).filter(r => !_pendingWfh.some(p => p.id === r.id) && (_isSolePC || r.employee_id !== _user.id))
        const hrCv     = (hrCvRes.data || []).filter(r => !_pendingClientVisits.some(p => p.id === r.id) && (_isSolePC || r.employee_id !== _user.id))
        _pendingApprovals    = [..._pendingApprovals, ...hrLeaves]
        _pendingWfh          = [..._pendingWfh, ...hrWfh]
        _pendingClientVisits = [..._pendingClientVisits, ...hrCv]
      }

      _updateApprovalBadge()
    }

    // Fetch attendance upload log + app settings
    const settingsRes = await API.getAppSettings('attendance')
    ;(settingsRes.data || []).forEach(s => {
      if (s.key === 'attendance.late_threshold')     _lateThreshold     = s.value
      if (s.key === 'attendance.late_effective_from') _lateEffectiveFrom = s.value
    })

    _bindTabs()
    _loadTab('attendance')
  }

  function _updateApprovalBadge() {
    const badge = document.getElementById('lt-approval-badge')
    if (!badge) return
    const count = _pendingApprovals.length + _pendingWfh.length + _pendingClientVisits.length + _pendingCorrections.length
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
      case 'attendance':        return _loadAttendanceTab()
      case 'my-leaves':         return _loadMyLeavesTab()
      case 'my-wfh':            return _loadMyWfhTab()
      case 'my-client-visits':  return _loadMyClientVisitsTab()
      case 'pending-approvals': return _loadPendingApprovalsTab()
    }
  }

  /* ══════════════════════════════════════════════════════════
     TAB: ATTENDANCE
  ══════════════════════════════════════════════════════════ */
  async function _loadAttendanceTab() {
    const content = document.getElementById('lt-content')
    if (!content) return

    // Fetch attendance for current month
    const mStart    = _toISO(_attendanceMonth)
    const mEnd      = _toISO(new Date(_attendanceMonth.getFullYear(), _attendanceMonth.getMonth() + 1, 0))
    const yearMonth = _toISO(_attendanceMonth).slice(0, 7)
    const [attRes, exemptRes] = await Promise.all([
      API.getEmployeeAttendance(_user.id, mStart, mEnd),
      API.getMonthlyExemptionCount(_user.id, yearMonth),
    ])
    _attendanceRecords = attRes.data || []
    const exemptCount = exemptRes.data?.length ?? 0

    const monthLabel = _attendanceMonth.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    const today = _toISO(new Date())

    // Build maps
    const attMap = {}
    _attendanceRecords.forEach(r => { attMap[r.date] = r })

    const leaveMap = {}
    _leaveRequests.filter(r => r.status === 'approved' || r.status === 'pending').forEach(r => {
      let d = new Date(r.start_date)
      const end = new Date(r.end_date)
      while (d <= end) {
        const iso = _toISO(d)
        leaveMap[iso] = { type: 'leave', name: r.leave_types?.name || 'Leave', is_half_day: r.is_half_day, half_day_period: r.half_day_period, status: r.status }
        d.setDate(d.getDate() + 1)
      }
    })

    const wfhMap = {}
    _wfhRequests.filter(r => r.status === 'approved').forEach(r => {
      let d = new Date(r.start_date)
      const end = new Date(r.end_date)
      while (d <= end) {
        wfhMap[_toISO(d)] = true
        d.setDate(d.getDate() + 1)
      }
    })

    // Approved client visits — treated as working days (never absent).
    // Stores the raw record so both the cell and the date modal can read
    // clients / entity / duration_type / reason consistently.
    const clientVisitMap = {}
    _clientVisits.filter(r => r.status === 'approved').forEach(r => {
      let d = new Date(r.start_date)
      const end = new Date(r.end_date)
      while (d <= end) {
        clientVisitMap[_toISO(d)] = r
        d.setDate(d.getDate() + 1)
      }
    })

    const holidayMap = {}
    _holidays.forEach(h => { holidayMap[h.date] = h.name })

    // Events: map each event across its date range
    const eventMap = {}
    ;(_events || []).forEach(ev => {
      let d = new Date(ev.start_date)
      const end = new Date(ev.end_date || ev.start_date)
      while (d <= end) {
        const iso = _toISO(d)
        if (!eventMap[iso]) eventMap[iso] = []
        eventMap[iso].push(ev)
        d.setDate(d.getDate() + 1)
      }
    })

    // Build calendar days
    const year  = _attendanceMonth.getFullYear()
    const month = _attendanceMonth.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay  = new Date(year, month + 1, 0)
    const startDow = (firstDay.getDay() + 6) % 7 // Mon=0

    let calCells = ''
    // Empty cells before first day
    for (let i = 0; i < startDow; i++) {
      calCells += `<div class="att-cal-cell att-cal-cell--empty"></div>`
    }

    for (let d = 1; d <= lastDay.getDate(); d++) {
      const dateObj = new Date(year, month, d)
      const iso     = _toISO(dateObj)
      const dow     = dateObj.getDay() // 0=Sun, 6=Sat
      const isSunday  = dow === 0     // only Sunday is the weekly off
      const isFuture  = iso > today

      const att     = attMap[iso]
      const leave   = leaveMap[iso]
      const isWfh   = wfhMap[iso]
      const cv      = clientVisitMap[iso]
      const holiday = holidayMap[iso]
      const dayEvents = eventMap[iso] || []

      let cellClass = 'att-cal-cell att-cal-cell--clickable'
      let cellContent = `<span class="att-cal-day">${d}</span>`

      if (isSunday) {
        cellClass += ' att-cal-cell--weekend'
        cellContent += `<span class="att-cal-label">Weekly Off</span>`
      } else if (holiday) {
        cellClass += ' att-cal-cell--holiday'
        cellContent += `<span class="att-cal-label">${Utils.escapeHtml(holiday)}</span>`
      } else if (leave) {
        cellClass += leave.status === 'pending' ? ' att-cal-cell--leave att-cal-cell--leave-pending' : ' att-cal-cell--leave'
        const lbl = leave.is_half_day ? `½ ${Utils.escapeHtml(leave.name)}` : Utils.escapeHtml(leave.name)
        cellContent += `<span class="att-cal-label">${lbl}${leave.status === 'pending' ? ' <em style="font-size:10px;font-style:normal;opacity:0.7;">(Pending)</em>' : ''}</span>`
      } else if (isWfh) {
        cellClass += ' att-cal-cell--wfh'
        cellContent += `<span class="att-cal-label">WFH</span>`
      } else if (cv) {
        // Client visit = working day. Show client + (if present) punch times.
        cellClass += ' att-cal-cell--client-visit'
        const half = cv.duration_type !== 'full_day'
        cellContent += `<span class="att-cal-label">${half ? '½ ' : ''}Client Visit</span>`
        cellContent += `<span class="att-cal-time att-cal-time--cv">${Utils.escapeHtml(cv.clients?.client_name || 'Client')}</span>`
        if (att && !att.is_absent && att.punch_in) {
          cellContent += `<span class="att-cal-time">${att.punch_in.substring(0,5)}${att.punch_out ? '–' + att.punch_out.substring(0,5) : ''}</span>`
        }
      } else if (att) {
        if (att.is_exempted) {
          cellClass += ' att-cal-cell--present'
          const inT  = att.punch_in  ? att.punch_in.slice(0, 5)  : '—'
          const outT = att.punch_out ? att.punch_out.slice(0, 5) : '—'
          cellContent += `<span class="att-cal-time">${inT}</span>`
          cellContent += `<span class="att-cal-time att-cal-time--out">${outT}</span>`
        } else if (att.is_absent) {
          cellClass += ' att-cal-cell--absent'
          cellContent += `<span class="att-cal-label">Absent</span>`
        } else if (att.punch_in && att.punch_out) {
          const isLate = att.late_minutes > 0
          cellClass += isLate ? ' att-cal-cell--late' : ' att-cal-cell--present'
          cellContent += `<span class="att-cal-time${isLate ? ' att-cal-time--late' : ''}">${att.punch_in.substring(0,5)}${isLate ? ' ▲' : ''}</span>`
          cellContent += `<span class="att-cal-time att-cal-time--out">${att.punch_out.substring(0,5)}</span>`
        } else if (att.punch_in) {
          const isLate = att.late_minutes > 0
          cellClass += isLate ? ' att-cal-cell--late' : ' att-cal-cell--partial'
          cellContent += `<span class="att-cal-time${isLate ? ' att-cal-time--late' : ''}">${att.punch_in.substring(0,5)}${isLate ? ' ▲' : ''}</span>`
          cellContent += `<span class="att-cal-time att-cal-time--out">—</span>`
        }
      } else if (!isFuture) {
        cellClass += ' att-cal-cell--no-data'
      } else {
        cellClass += ' att-cal-cell--future'
      }

      // Event indicator dot (events can coexist with any day state)
      if (dayEvents.length) {
        cellContent += `<span class="att-cal-event-dot" title="${dayEvents.map(e => Utils.escapeHtml(e.title)).join(', ')}"></span>`
      }
      if (att?.is_exempted) {
        cellContent += `<span class="att-cal-exempt-badge" title="${att.exemption_reason ? Utils.escapeHtml(att.exemption_reason) : 'Correction applied'}">✓</span>`
      }

      if (iso === today) cellClass += ' att-cal-cell--today'
      calCells += `<div class="${cellClass}" data-att-date="${iso}">${cellContent}</div>`
    }

    // Legend
    const legend = `
      <div class="att-legend">
        <span class="att-legend-item"><span class="att-legend-dot" style="background:#D1FAE5;border:1.5px solid #1D9E75;border-radius:3px;"></span>Present</span>
        <span class="att-legend-item"><span class="att-legend-dot" style="background:#FEE2E2;border:1.5px solid #FECACA;border-radius:3px;"></span>Late</span>
        <span class="att-legend-item"><span class="att-legend-dot" style="background:#FEF3C7;border:1.5px solid #F59E0B;border-radius:3px;"></span>Partial</span>
        <span class="att-legend-item"><span class="att-legend-dot" style="background:#FEE2E2;border:1.5px solid #EF4444;border-radius:3px;"></span>Absent</span>
        <span class="att-legend-item"><span class="att-legend-dot" style="background:#EEF2FF;border:1.5px solid #6366F1;border-radius:3px;"></span>Leave</span>
        <span class="att-legend-item"><span class="att-legend-dot" style="background:#ECFDF5;border:1.5px solid #059669;border-radius:3px;"></span>WFH</span>
        <span class="att-legend-item"><span class="att-legend-dot" style="background:#E0F2FE;border:1.5px solid #0EA5E9;border-radius:3px;"></span>Client Visit</span>
        <span class="att-legend-item"><span class="att-legend-dot" style="background:#FEF3C7;border:1.5px solid #F59E0B;border-radius:3px;"></span>Holiday</span>
        <span class="att-legend-item"><span class="att-legend-dot" style="background:var(--surface);border:1.5px solid var(--border);border-radius:3px;opacity:0.6;"></span>No Data</span>
        <span class="att-legend-item"><span class="att-legend-dot" style="background:#EC4899;"></span>Event</span>
      </div>`

    content.innerHTML = `
      <div style="display:flex;gap:16px;align-items:flex-start;" class="mb-4">
        <div style="flex:1;min-width:0;">
          <div class="section-card">
            <div class="section-card-body">
              <!-- Month nav -->
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
                <div>
                  <h3 style="margin:0;font-size:15px;font-weight:700;">Attendance — ${monthLabel}</h3>
                  <div style="font-size:12px;color:${exemptCount >= 4 ? '#DC2626' : '#059669'};margin-top:3px;font-weight:500;">${exemptCount} of 4 corrections used this month</div>
                </div>
                <div style="display:flex;align-items:center;gap:6px;">
                  <button class="btn btn--ghost btn--sm" id="att-cal-prev">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
                  </button>
                  <button class="btn btn--ghost btn--sm" id="att-cal-next" ${_toISO(_attendanceMonth).slice(0,7) >= today.slice(0,7) ? 'disabled' : ''}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                  </button>
                </div>
              </div>
              <!-- Day headers -->
              <div class="att-cal-grid att-cal-grid--header">
                ${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => `<div class="att-cal-dow">${d}</div>`).join('')}
              </div>
              <div class="att-cal-grid">
                ${calCells}
              </div>
              ${legend}
            </div>
          </div>
        </div>
        <div style="width:260px;flex-shrink:0;">
          ${_renderUpcomingPanel()}
        </div>
      </div>
    `

    // Month nav handlers
    document.getElementById('att-cal-prev')?.addEventListener('click', () => {
      _attendanceMonth = new Date(_attendanceMonth.getFullYear(), _attendanceMonth.getMonth() - 1, 1)
      _loadAttendanceTab()
    })
    document.getElementById('att-cal-next')?.addEventListener('click', () => {
      const now  = new Date()
      const next = new Date(_attendanceMonth.getFullYear(), _attendanceMonth.getMonth() + 1, 1)
      if (next <= new Date(now.getFullYear(), now.getMonth(), 1)) {
        _attendanceMonth = next
        _loadAttendanceTab()
      }
    })

    // Click any date to view what's marked / self-correct
    document.querySelectorAll('.att-cal-cell--clickable[data-att-date]').forEach(cell => {
      cell.addEventListener('click', async () => {
        await _openAttendanceDateModal(cell.dataset.attDate, { holidayMap, leaveMap, wfhMap, clientVisitMap, attMap, eventMap }, exemptCount)
      })
    })
  }

  /* View what's marked on a date, and self-correct via exemption if eligible */
  async function _openAttendanceDateModal(dateISO, maps, exemptCount = 0) {
    const holiday   = maps.holidayMap[dateISO]
    const leave     = maps.leaveMap[dateISO]
    const isWfh     = maps.wfhMap[dateISO]
    const cv        = maps.clientVisitMap ? maps.clientVisitMap[dateISO] : null
    const att       = maps.attMap[dateISO]
    const dayEvents = maps.eventMap[dateISO] || []

    // Always fetch a fresh count so stale closures or external DB changes can't bypass the limit
    const freshRes = await API.getMonthlyExemptionCount(_user.id, dateISO.slice(0, 7))
    exemptCount = freshRes.data?.length ?? 0

    // Build the "what's on this day" summary
    const items = []
    if (holiday) items.push(`<div class="att-day-row"><span class="att-day-tag att-day-tag--holiday">Holiday</span><span>${Utils.escapeHtml(holiday)}</span></div>`)
    if (leave)   items.push(`<div class="att-day-row"><span class="att-day-tag att-day-tag--leave">${leave.is_half_day ? 'Half-Day Leave' : 'Leave'}</span><span>${Utils.escapeHtml(leave.name)}</span></div>`)
    if (isWfh)   items.push(`<div class="att-day-row"><span class="att-day-tag att-day-tag--wfh">WFH</span><span>Work From Home</span></div>`)
    if (cv) {
      const dur = cv.duration_type === 'full_day' ? '' : ` (${_cvDurationLabel(cv.duration_type)})`
      items.push(`<div class="att-day-row"><span class="att-day-tag att-day-tag--client-visit">Client Visit${dur}</span><span>${Utils.escapeHtml(_cvClientLabel(cv))}${cv.reason ? ' — ' + Utils.escapeHtml(cv.reason) : ''}</span></div>`)
    }
    if (att && !att.is_absent && att.punch_in) {
      const lateNote = att.late_minutes > 0 ? ` · Late by ${att.late_minutes} min` : ''
      const tagStyle = att.late_minutes > 0 ? ' style="background:#FEE2E2;color:#B91C1C;"' : ''
      items.push(`<div class="att-day-row"><span class="att-day-tag att-day-tag--present"${tagStyle}>Attendance${lateNote}</span><span>${att.punch_in.substring(0,5)} → ${att.punch_out ? att.punch_out.substring(0,5) : '—'}</span></div>`)
    } else if (att && att.is_absent) {
      items.push(`<div class="att-day-row"><span class="att-day-tag att-day-tag--absent">Absent</span><span>No punch recorded</span></div>`)
    }
    dayEvents.forEach(ev => {
      items.push(`<div class="att-day-row"><span class="att-day-tag att-day-tag--event">Event</span><span>${Utils.escapeHtml(ev.title)}${ev.description ? ` — ${Utils.escapeHtml(ev.description)}` : ''}</span></div>`)
    })

    const summaryHtml = items.length
      ? items.join('')
      : `<p style="font-size:13px;color:var(--text-muted);margin:0;">Nothing marked on this day.</p>`

    // Exemption section — employee can self-correct up to 4 times per month
    const todayISO  = _toISO(new Date())
    const isPast    = dateISO < todayISO
    const isSunday  = new Date(dateISO + 'T00:00:00').getDay() === 0
    // Late arrivals no longer go through self-service exemption — they're
    // auto-marked as a half-day leave with its own manager-approved correction.
    const hasIssue  = att?.is_absent || (att?.punch_in && !att?.punch_out) || (!att && !leave && !isWfh && !cv && !holiday)
    const isExemptEligible = isPast && !isSunday && !holiday && !leave && !isWfh && !cv && hasIssue

    let exemptSectionHtml = ''
    if (att?.is_exempted) {
      const origIn  = att.original_punch_in  ? att.original_punch_in.slice(0, 5)  : '—'
      const origOut = att.original_punch_out ? att.original_punch_out.slice(0, 5) : '—'
      const corrIn  = att.punch_in  ? att.punch_in.slice(0, 5)  : '—'
      const corrOut = att.punch_out ? att.punch_out.slice(0, 5) : '—'
      exemptSectionHtml = `
        <div style="border-top:1px solid var(--border);margin-top:16px;padding-top:16px;">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);margin-bottom:10px;">Correction History</div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            <div class="att-day-row"><span class="att-day-tag" style="background:var(--surface);color:var(--text-muted);">Biometric</span><span style="font-size:13px;">${origIn} → ${origOut}</span></div>
            <div class="att-day-row"><span class="att-day-tag" style="background:#ECFDF5;color:#065F46;border:1px solid #6EE7B7;">✓ Corrected</span><span style="font-size:13px;">${corrIn} → ${corrOut}</span></div>
            ${att.exemption_reason ? `<div class="att-day-row"><span class="att-day-tag" style="background:var(--surface);color:var(--text-muted);">Reason</span><span style="font-size:13px;">${Utils.escapeHtml(att.exemption_reason)}</span></div>` : ''}
          </div>
        </div>`
    } else if (isExemptEligible && exemptCount < 4) {
      const preIn  = att?.punch_in  ? att.punch_in.slice(0, 5)  : ''
      const preOut = att?.punch_out ? att.punch_out.slice(0, 5) : ''
      exemptSectionHtml = `
        <div style="border-top:1px solid var(--border);margin-top:16px;padding-top:16px;">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);margin-bottom:8px;">Log Correction (${4 - exemptCount} of 4 remaining)</div>
          <div id="att-exempt-err" class="alert alert--danger" style="display:none;margin-bottom:8px;"></div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <div>
              <label style="font-size:12px;color:var(--text-muted);margin-bottom:4px;display:block;">Corrected Punch In</label>
              <input type="time" id="att-exempt-in" class="form-input" value="${preIn}" style="font-size:13px;">
            </div>
            <div>
              <label style="font-size:12px;color:var(--text-muted);margin-bottom:4px;display:block;">Corrected Punch Out</label>
              <input type="time" id="att-exempt-out" class="form-input" value="${preOut}" style="font-size:13px;">
            </div>
            <input class="form-input" type="text" id="att-exempt-reason" placeholder="Reason *" style="font-size:13px;">
            <button class="btn btn--primary btn--sm" id="att-exempt-submit" style="align-self:flex-start;">Apply Correction</button>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:6px;">No approval needed · marks this day as corrected.</div>
        </div>`
    } else if (isExemptEligible && exemptCount >= 4) {
      exemptSectionHtml = `
        <div id="att-exempt-bal-wrap" style="border-top:1px solid var(--border);margin-top:16px;padding-top:16px;">
          <p style="font-size:13px;color:var(--text-muted);margin:0;">Loading leave balance…</p>
        </div>`
    }

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">${Utils.formatDate(dateISO)}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">${CLOSE_SVG}</button>
      </div>
      <div class="modal-body">
        <div style="display:flex;flex-direction:column;gap:8px;">${summaryHtml}</div>
        ${exemptSectionHtml}
      </div>
    `)

    // Wire up exemption handler
    if (isExemptEligible && !att?.is_exempted && exemptCount < 4) {
      document.getElementById('att-exempt-submit')?.addEventListener('click', async () => {
        const reason   = document.getElementById('att-exempt-reason')?.value?.trim() || ''
        const errEl    = document.getElementById('att-exempt-err')
        const btn      = document.getElementById('att-exempt-submit')
        const punchIn  = document.getElementById('att-exempt-in')?.value
        const punchOut = document.getElementById('att-exempt-out')?.value

        if (!punchIn)  { errEl.style.display = ''; errEl.textContent = 'Please enter the corrected punch in time.'; return }
        if (!punchOut) { errEl.style.display = ''; errEl.textContent = 'Please enter the corrected punch out time.'; return }
        if (!reason)   { errEl.style.display = ''; errEl.textContent = 'Please enter a reason for the correction.'; return }

        // Recalculate late_minutes if punch_in is being set
        let lateMins = att?.late_minutes ?? 0
        if (punchIn) {
          const [th, tm] = (_lateThreshold || '10:30').split(':').map(Number)
          const [ph, pm] = punchIn.split(':').map(Number)
          lateMins = Math.max(0, (ph * 60 + pm) - (th * 60 + tm))
        }

        // Capture original biometric times before overwriting
        const origIn  = att?.punch_in  || null
        const origOut = att?.punch_out || null

        errEl.style.display = 'none'
        btn.disabled = true; btn.textContent = 'Saving…'
        const { error } = await API.applyAttendanceExemption(_user.id, dateISO, reason, _user.id, punchIn || null, punchOut || null, lateMins, origIn, origOut)
        if (error) {
          errEl.style.display = ''; errEl.textContent = error.message
          btn.disabled = false; btn.textContent = 'Apply Correction'
          return
        }
        Utils.closeModal()
        Utils.showToast('Correction applied.', 'success')
        _loadAttendanceTab()
      })
    } else if (isExemptEligible && exemptCount >= 4) {
      // Async-fill the leave balance section
      const year = new Date(dateISO).getFullYear()
      const [creditsRes, takenRes] = await Promise.all([
        API.getLeaveCredits(_user.id, year),
        API.getMyLeaveRequests(),
      ])
      const wrap = document.getElementById('att-exempt-bal-wrap')
      if (wrap) {
        // 1 day if fully absent, 0.5 if late or partial punch
        const suggestedDays = (att?.is_absent || !att) ? 1 : 0.5
        const isHalfDay     = suggestedDays === 0.5
        const deductLabel   = isHalfDay ? '0.5 day (half-day)' : '1 day (full day)'

        const credits = creditsRes.data || []
        const taken   = (takenRes.data || []).filter(r => r.status === 'approved' && new Date(r.start_date).getFullYear() === year)
        const balMap  = {}
        credits.forEach(c => { balMap[c.leave_type_id] = (balMap[c.leave_type_id] || 0) + Number(c.credited_days) })
        taken.forEach(r => { balMap[r.leave_type_id] = (balMap[r.leave_type_id] || 0) - Number(r.days) })
        const eligibleTypes = _leaveTypes
          .filter(t => t.is_active && !t.name.toLowerCase().includes('medical') && (t.is_unpaid || (balMap[t.id] || 0) > 0))
          .sort((a, b) => {
            const aC = a.name.toLowerCase().includes('casual')
            const bC = b.name.toLowerCase().includes('casual')
            if (aC && !bC) return -1
            if (!aC && bC) return 1
            if (a.is_unpaid && !b.is_unpaid) return 1
            if (!a.is_unpaid && b.is_unpaid) return -1
            return a.name.localeCompare(b.name)
          })
        if (!eligibleTypes.length) {
          wrap.innerHTML = '<div style="font-size:13px;color:#DC2626;">All 4 corrections used. No leave balance available — contact HR.</div>'
        } else {
          const opts = eligibleTypes.map(t => {
            const bal = t.is_unpaid ? null : (balMap[t.id] || 0)
            return `<option value="${t.id}">${Utils.escapeHtml(t.name)}${bal !== null ? ' (' + bal + ' days remaining)' : ' (Unpaid)'}</option>`
          }).join('')
          wrap.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
              <span style="font-size:13px;font-weight:700;color:var(--text);">Apply Leave</span>
              <span style="font-size:11px;font-weight:600;background:#FEE2E2;color:#B91C1C;padding:2px 8px;border-radius:20px;">4/4 corrections used</span>
            </div>
            <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;">
              <span style="font-size:12px;color:var(--text-muted);">Priority: <strong style="color:var(--text);">CL → EL → Unpaid</strong></span>
              <span style="font-size:12px;color:var(--text-muted);">Deduction: <strong style="color:${isHalfDay ? '#D97706' : '#DC2626'};">${deductLabel}</strong></span>
            </div>
            <div id="att-exempt-err" class="alert alert--danger" style="display:none;margin-bottom:10px;"></div>
            <div style="display:flex;flex-direction:column;gap:10px;">
              <select id="att-exempt-lt" class="form-control" style="font-size:13px;">${opts}</select>
              <input class="form-input" type="text" id="att-exempt-reason" placeholder="Reason (optional)" style="font-size:13px;">
              <div style="display:flex;align-items:center;gap:10px;">
                <button class="btn btn--primary btn--sm" id="att-exempt-submit">Submit for Approval</button>
                <span style="font-size:11px;color:var(--text-muted);">Goes to your manager</span>
              </div>
            </div>`
          document.getElementById('att-exempt-submit')?.addEventListener('click', async () => {
            const typeId = document.getElementById('att-exempt-lt')?.value
            const reason = document.getElementById('att-exempt-reason')?.value?.trim() || ''
            const errEl  = document.getElementById('att-exempt-err')
            const btn    = document.getElementById('att-exempt-submit')
            if (!typeId) return
            btn.disabled = true; btn.textContent = 'Submitting…'
            const me        = _employees.find(e => e.id === _user.id)
            const managerId = me?.reports_to || null
            const { error } = await API.createLeaveRequest({
              employee_id:   _user.id,
              leave_type_id: typeId,
              start_date:    dateISO,
              end_date:      dateISO,
              days:          suggestedDays,
              is_half_day:   isHalfDay,
              reason:        reason || 'Attendance correction',
              status:        'pending',
              approver_id:   managerId,
            })
            if (error) {
              errEl.style.display = ''; errEl.textContent = error.message
              btn.disabled = false; btn.textContent = 'Submit for Approval'
              return
            }
            Utils.closeModal()
            Utils.showToast('Leave request submitted for approval.', 'success')
            _loadAttendanceTab()
          })
        }
      }
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

    // Category-wise leave breakdown
    const creditedByType = {}
    const takenByType    = {}

    _leaveCredits.forEach(c => {
      if (!creditedByType[c.leave_type_id]) creditedByType[c.leave_type_id] = 0
      creditedByType[c.leave_type_id] += Number(c.credited_days)
    })
    _leaveRequests
      .filter(r => r.status === 'approved' && new Date(r.start_date).getFullYear() === currentYear)
      .forEach(r => {
        if (!takenByType[r.leave_type_id]) takenByType[r.leave_type_id] = 0
        takenByType[r.leave_type_id] += Number(r.days)
      })

    const pendingCount = _leaveRequests.filter(r => r.status === 'pending').length

    // Drive cards from ALL active leave types — a new type added in Settings
    // automatically appears here even before any credits are assigned.
    const kpiCards = _leaveTypes.length
      ? _leaveTypes.map(t => {
          const credited  = creditedByType[t.id] || 0
          const taken     = takenByType[t.id]    || 0
          const remaining = credited - taken

          if (t.is_unpaid) {
            return `
              <div class="lt-stat-card lt-stat-card--category section-card">
                <div class="lt-stat-cat-name">${Utils.escapeHtml(t.name)}</div>
                <div class="lt-stat-cat-body">
                  <div class="lt-stat-cat-col">
                    <div class="lt-stat-value">${taken}</div>
                    <div class="lt-stat-label">Days Taken</div>
                  </div>
                </div>
              </div>
            `
          }

          const notYetCredited = credited === 0
          return `
            <div class="lt-stat-card lt-stat-card--category section-card${notYetCredited ? ' lt-stat-card--uncredited' : ''}">
              <div class="lt-stat-cat-name">${Utils.escapeHtml(t.name)}</div>
              <div class="lt-stat-cat-body">
                <div class="lt-stat-cat-col">
                  <div class="lt-stat-value">${credited}</div>
                  <div class="lt-stat-label">Allocated</div>
                </div>
                <div class="lt-stat-cat-sep"></div>
                <div class="lt-stat-cat-col">
                  <div class="lt-stat-value">${taken}</div>
                  <div class="lt-stat-label">Taken</div>
                </div>
              </div>
              ${notYetCredited ? `<div class="lt-stat-cat-hint">Not yet allocated</div>` : ''}
            </div>
          `
        }).join('')
      : `<div class="lt-stat-card section-card" style="grid-column:1/-1;">
           <div class="lt-stat-label" style="font-size:13px;color:var(--text-muted);">
             No leave types configured yet. Ask HR to set them up in Settings.
           </div>
         </div>`

    content.innerHTML = `
      <div class="lt-summary-cards lt-summary-cards--cat mb-4">
        ${kpiCards}
        <div class="lt-stat-card lt-stat-card--pending section-card">
          <div class="lt-stat-value">${pendingCount}</div>
          <div class="lt-stat-label">Pending Requests</div>
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
                ${r.is_late_half_day ? `<span class="badge badge--muted" style="font-size:10px;margin-left:4px;">Late Half-Day</span>` : ''}
                ${r.approver_comment ? `<div class="text-sm text-muted" style="margin-top:2px;white-space:pre-wrap;word-break:break-word;">${Utils.escapeHtml(r.approver_comment)}</div>` : ''}
                <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Submitted ${Utils.formatDateTime(r.created_at)}</div>
                ${r.acted_at ? `<div style="font-size:11px;color:var(--text-muted);">Decided by ${Utils.escapeHtml(r.approver?.name || '—')} · ${Utils.formatDateTime(r.acted_at)}</div>` : ''}
                ${r.correction_status === 'pending'  ? `<div style="font-size:11px;color:var(--warning);margin-top:4px;">Correction pending with manager</div>` : ''}
                ${r.correction_status === 'approved' ? `<div style="font-size:11px;color:var(--success);margin-top:4px;">Correction approved — half-day reversed</div>` : ''}
                ${r.correction_status === 'rejected' ? `<div style="font-size:11px;color:var(--danger);margin-top:4px;">Correction denied — half-day stands</div>` : ''}
              </td>
              <td class="text-muted" style="font-size:12px;white-space:pre-wrap;word-break:break-word;max-width:220px;">${Utils.escapeHtml(r.reason || '—')}</td>
              <td style="white-space:nowrap;">
                ${r.status === 'pending' ? `<button class="btn btn--xs btn--ghost" data-cancel-leave="${r.id}" style="color:var(--danger);">Cancel</button>` : ''}
                ${r.status === 'approved' && !r.is_late_half_day ? `<button class="btn btn--xs btn--ghost" data-cancel-request="${r.id}" style="color:var(--warning);">Request Cancel</button>` : ''}
                ${r.is_late_half_day && !r.correction_status ? `<button class="btn btn--xs btn--ghost" data-request-correction="${r.id}" style="color:var(--warning);">Request Correction</button>` : ''}
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
    document.querySelectorAll('[data-request-correction]').forEach(btn => {
      btn.addEventListener('click', () => _requestCorrection(btn.dataset.requestCorrection))
    })
  }

  // Keeps prompting until a non-empty reason is given, or the user cancels.
  function _promptCorrectionReason() {
    let reason = prompt('Reason for correction request:')
    if (reason === null) return null
    reason = reason.trim()
    while (!reason) {
      reason = prompt('A reason is required to request a correction:')
      if (reason === null) return null
      reason = reason.trim()
    }
    return reason
  }

  async function _requestCorrection(id) {
    const reason = _promptCorrectionReason()
    if (reason === null) return
    const req = _leaveRequests.find(r => r.id === id)
    const { error } = await API.updateLeaveRequest(id, {
      correction_status: 'pending',
      correction_reason: reason,
    })
    if (error) {
      Utils.showToast('Failed: ' + error.message, 'error')
      return
    }
    if (req?.approver_id) {
      API.createNotification({
        recipient_employee_id: req.approver_id,
        type: 'info',
        message: `${_user.name} requested a correction for their late half-day on ${Utils.formatDate(req.start_date)}.`,
        module: 'leave_tracker',
        record_id: id,
        notify_email: true,
      })
    }
    Utils.showToast('Correction request sent.', 'success')
    await _refreshMyLeaveData()
    _loadTab(_activeTab)
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

  // Keeps prompting until a non-empty reason is given, or the user cancels.
  function _promptCancellationReason() {
    let reason = prompt('Reason for cancellation request:')
    if (reason === null) return null
    reason = reason.trim()
    while (!reason) {
      reason = prompt('A reason is required to request cancellation:')
      if (reason === null) return null
      reason = reason.trim()
    }
    return reason
  }

  async function _requestCancellation(id) {
    const reason = _promptCancellationReason()
    if (reason === null) return // user clicked Cancel
    const req = _leaveRequests.find(r => r.id === id)
    const { error } = await API.updateLeaveRequest(id, {
      status:              'cancellation_pending',
      cancellation_reason: reason,
    })
    if (error) {
      Utils.showToast('Failed: ' + error.message, 'error')
    } else {
      _notifyCancellationFiled(req, 'leave')
      Utils.showToast('Cancellation request sent.', 'success')
      await _refreshMyLeaveData()
      _loadTab(_activeTab)
    }
  }

  // Cancellation requests route to People & Culture, not the manager — notify
  // P&C so they know to act, and give the manager a passive FYI since they're
  // no longer the one approving it.
  function _notifyCancellationFiled(req, type) {
    const label = _reqLabel(type)
    _employees
      .filter(e => (e.role === 'super_admin' || Utils.getDeptSystemKey(e.department) === 'people_culture') && e.id !== _user.id)
      .forEach(hr => API.createNotification({
        recipient_employee_id: hr.id,
        type: 'info',
        message: `${_user.name} requested to cancel their ${label} request.`,
        module: 'leave_tracker',
        record_id: req?.id,
        notify_email: true,
      }))
    if (req?.approver_id) {
      API.createNotification({
        recipient_employee_id: req.approver_id,
        type: 'info',
        message: `${_user.name}'s ${label} cancellation is now with People & Culture.`,
        module: 'leave_tracker',
        record_id: req?.id,
        notify_email: true,
      })
    }
  }

  async function _refreshMyLeaveData() {
    const [lrRes, wfhRes, cvRes] = await Promise.all([
      API.getMyLeaveRequests(_user.id),
      API.getMyWfhRequests(_user.id),
      API.getMyClientVisits(_user.id),
    ])
    _leaveRequests = lrRes.data  || []
    _wfhRequests   = wfhRes.data || []
    _clientVisits  = cvRes.data  || []
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
      const leaveType = _leaveTypes.find(t => t.id === typeId)
      if (leaveType?.is_unpaid) {
        el.style.display    = 'block'
        el.style.color      = 'var(--text-muted)'
        el.style.background = 'var(--surface-2, #F9FAFB)'
        el.style.border     = '1px solid var(--border)'
        el.textContent      = 'Heads up: This leave is unpaid — days taken will be deducted from your monthly salary.'
        return
      }
      el.style.background = ''
      el.style.border     = ''
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

      const days      = _calcLeaveDays(start, isHalf ? start : end, isHalf)
      const leaveType = _leaveTypes.find(t => t.id === typeId)

      // Balance is enforced for every paid leave type — unpaid leave has no
      // balance concept and is exempt. The database has the same check as a
      // backstop; this is just the friendly, immediate version.
      if (!leaveType?.is_unpaid) {
        const balance = _getBalance(typeId, currentYear)
        if (days > balance) {
          errEl.textContent = `You only have ${balance} day${Math.abs(balance) === 1 ? '' : 's'} of ${leaveType?.name || 'this leave type'} remaining — cannot request ${days}.`
          errEl.style.display = 'block'
          return
        }
      }

      const approverId = await _resolveApproverWithFallback(start, isHalf ? start : end)

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
          notify_email: true,
        })
      } else {
        _employees
          .filter(e => (e.role === 'super_admin' || Utils.getDeptSystemKey(e.department) === 'people_culture') && e.id !== _user.id)
          .forEach(hr => API.createNotification({
            recipient_employee_id: hr.id,
            type: 'info',
            message: `${_user.name} submitted a leave request (no manager assigned).`,
            module: 'leave_tracker',
            notify_email: true,
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
                ${r.approver_comment ? `<div class="text-sm text-muted" style="margin-top:2px;white-space:pre-wrap;word-break:break-word;">${Utils.escapeHtml(r.approver_comment)}</div>` : ''}
                <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Submitted ${Utils.formatDateTime(r.created_at)}</div>
                ${r.acted_at ? `<div style="font-size:11px;color:var(--text-muted);">Decided · ${Utils.formatDateTime(r.acted_at)}</div>` : ''}
              </td>
              <td class="text-muted" style="font-size:12px;white-space:pre-wrap;word-break:break-word;max-width:220px;">${Utils.escapeHtml(r.reason || '—')}</td>
              <td style="font-size:12px;max-width:220px;white-space:pre-wrap;word-break:break-word;">${r.work_plan ? Utils.escapeHtml(r.work_plan) : '<span class="text-muted">—</span>'}</td>
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
    const reason = _promptCancellationReason()
    if (reason === null) return
    const req = _wfhRequests.find(r => r.id === id)
    const { error } = await API.updateWfhRequest(id, {
      status:              'cancellation_pending',
      cancellation_reason: reason,
    })
    if (error) {
      Utils.showToast('Failed: ' + error.message, 'error')
    } else {
      _notifyCancellationFiled(req, 'wfh')
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

      const approverId = await _resolveApproverWithFallback(start, end)

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
          notify_email: true,
        })
      } else {
        _employees
          .filter(e => (e.role === 'super_admin' || Utils.getDeptSystemKey(e.department) === 'people_culture') && e.id !== _user.id)
          .forEach(hr => API.createNotification({
            recipient_employee_id: hr.id,
            type: 'info',
            message: `${_user.name} submitted a WFH request (no manager assigned).`,
            module: 'leave_tracker',
            notify_email: true,
          }))
      }
      Utils.closeModal()
      Utils.showToast('WFH request submitted.', 'success')
      await _refreshMyLeaveData()
      _loadTab('my-wfh')
    })
  }

  /* ══════════════════════════════════════════════════════════
     TAB: MY CLIENT VISITS
  ══════════════════════════════════════════════════════════ */
  function _loadMyClientVisitsTab() {
    const toolbar = document.getElementById('lt-toolbar-actions')
    if (toolbar) {
      toolbar.innerHTML = `<button class="btn btn--primary btn--sm" id="lt-apply-cv-btn">+ Apply Client Visit</button>`
      document.getElementById('lt-apply-cv-btn').addEventListener('click', _openApplyClientVisitModal)
    }

    const content = document.getElementById('lt-content')
    if (!content) return

    content.innerHTML = `
      <div class="section-card">
        <div class="section-card-header"><h3>Client Visit History</h3></div>
        <div class="section-card-body" style="padding:0;">
          ${_renderClientVisitTable()}
        </div>
      </div>
    `
    _bindClientVisitActions()
  }

  function _renderClientVisitTable() {
    if (!_clientVisits.length) return '<p class="empty-state">No client visit requests yet.</p>'
    return `
      <table class="data-table">
        <thead><tr>
          <th>Dates</th><th>Duration</th><th>Client</th>
          <th>Status</th><th>Reason</th><th>Approver</th><th></th>
        </tr></thead>
        <tbody>
          ${_clientVisits.map(r => `
            <tr>
              <td style="white-space:nowrap;font-size:12px;">
                ${Utils.formatDate(r.start_date)}${r.start_date !== r.end_date ? ' – ' + Utils.formatDate(r.end_date) : ''}
              </td>
              <td style="font-size:12px;">${_cvDurationLabel(r.duration_type)}</td>
              <td style="font-size:12px;">${Utils.escapeHtml(_cvClientLabel(r))}</td>
              <td>
                ${STATUS_BADGE[r.status] || r.status}
                ${r.approver_comment ? `<div class="text-sm text-muted" style="margin-top:2px;white-space:pre-wrap;word-break:break-word;">${Utils.escapeHtml(r.approver_comment)}</div>` : ''}
                <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Submitted ${Utils.formatDateTime(r.created_at)}</div>
                ${r.acted_at ? `<div style="font-size:11px;color:var(--text-muted);">Decided · ${Utils.formatDateTime(r.acted_at)}</div>` : ''}
              </td>
              <td class="text-muted" style="font-size:12px;white-space:pre-wrap;word-break:break-word;max-width:220px;">${Utils.escapeHtml(r.reason || '—')}</td>
              <td style="font-size:12px;">${Utils.escapeHtml(r.approver?.name || '—')}</td>
              <td style="white-space:nowrap;">
                ${r.status === 'pending'  ? `<button class="btn btn--xs btn--ghost" data-cancel-cv="${r.id}" style="color:var(--danger);">Cancel</button>` : ''}
                ${r.status === 'approved' ? `<button class="btn btn--xs btn--ghost" data-cancel-cv-request="${r.id}" style="color:var(--warning);">Request Cancel</button>` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `
  }

  function _bindClientVisitActions() {
    document.querySelectorAll('[data-cancel-cv]').forEach(btn => {
      btn.addEventListener('click', () => _cancelClientVisit(btn.dataset.cancelCv))
    })
    document.querySelectorAll('[data-cancel-cv-request]').forEach(btn => {
      btn.addEventListener('click', () => _requestClientVisitCancellation(btn.dataset.cancelCvRequest))
    })
  }

  async function _cancelClientVisit(id) {
    if (!confirm('Cancel this Client Visit request?')) return
    const { error } = await API.updateClientVisit(id, { status: 'cancelled' })
    if (error) { Utils.showToast('Failed to cancel: ' + error.message, 'error'); return }
    Utils.showToast('Client Visit request cancelled.', 'success')
    await _refreshMyLeaveData()
    _loadTab(_activeTab)
  }

  async function _requestClientVisitCancellation(id) {
    const reason = _promptCancellationReason()
    if (reason === null) return
    const req = _clientVisits.find(r => r.id === id)
    const { error } = await API.updateClientVisit(id, {
      status: 'cancellation_pending',
      cancellation_reason: reason,
    })
    if (error) { Utils.showToast('Failed: ' + error.message, 'error'); return }
    _notifyCancellationFiled(req, 'client-visit')
    Utils.showToast('Cancellation request sent.', 'success')
    await _refreshMyLeaveData()
    _loadTab(_activeTab)
  }

  // ── Conflict detection (period-aware) ───────────────────────
  function _normHalf(v) {
    if (v === 'morning'   || v === 'first_half'  || v === 'first')  return 'first'
    if (v === 'afternoon' || v === 'second_half' || v === 'second') return 'second'
    return 'full'
  }
  // Expand an existing request into [{iso, period, label}] occupancy slots.
  function _expandOccupancy(rec, kind) {
    let period = 'full', single = false, label = ''
    if (kind === 'leave') {
      period = _normHalf(rec.is_half_day ? rec.half_day_period : 'full')
      single = !!rec.is_half_day
      label  = rec.leave_types?.name || 'Leave'
    } else if (kind === 'wfh') {
      period = 'full'; label = 'WFH'
    } else {
      period = _normHalf(rec.duration_type)
      single = rec.duration_type !== 'full_day'
      label  = 'Client Visit' + (rec.clients?.client_name ? ` (${rec.clients.client_name})` : '')
    }
    const out = []
    const cur = _parseLocal(rec.start_date)
    const end = _parseLocal(single ? rec.start_date : rec.end_date)
    while (cur <= end) { out.push({ iso: _toISO(cur), period, label }); cur.setDate(cur.getDate() + 1) }
    return out
  }
  // Returns conflicting slots for a proposed client visit. Two slots on the
  // same date clash if either is full-day or they share the same half.
  async function _findClientVisitConflicts(start, end, durationType) {
    const reqSingle = durationType !== 'full_day'
    const reqPeriod = _normHalf(durationType)
    const reqEnd    = reqSingle ? start : end

    const { leaves, wfhs, clientVisits } = await API.getAttendanceConflicts(_user.id, start, reqEnd)
    const existing = [
      ...leaves.flatMap(r => _expandOccupancy(r, 'leave')),
      ...wfhs.flatMap(r => _expandOccupancy(r, 'wfh')),
      ...clientVisits.flatMap(r => _expandOccupancy(r, 'client')),
    ]

    const reqDates = []
    { const c = _parseLocal(start), e = _parseLocal(reqEnd)
      while (c <= e) { reqDates.push(_toISO(c)); c.setDate(c.getDate() + 1) } }

    const hits = []
    reqDates.forEach(iso => {
      existing.filter(o => o.iso === iso).forEach(o => {
        if (reqPeriod === 'full' || o.period === 'full' || reqPeriod === o.period) {
          hits.push({ iso, label: o.label })
        }
      })
    })
    return hits
  }

  function _showConflictPopup(hits) {
    const rows = hits.map(h =>
      `<li style="margin-bottom:4px;">${Utils.formatDate(h.iso)} — <strong>${Utils.escapeHtml(h.label)}</strong></li>`
    ).join('')
    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Attendance Conflict</h3>
        <button class="modal-close" onclick="Utils.closeModal()">${CLOSE_SVG}</button>
      </div>
      <div class="modal-body" style="padding:20px 24px;">
        <p style="font-size:14px;line-height:1.6;margin:0 0 12px;">
          This date already has an existing attendance request. Please review or
          edit the existing request before creating a new one.
        </p>
        <ul style="font-size:13px;color:var(--text-muted);margin:0;padding-left:18px;">${rows}</ul>
      </div>
      <div class="modal-footer">
        <button class="btn btn--primary" onclick="Utils.closeModal()">OK</button>
      </div>
    `)
  }

  /* ── Apply Client Visit Modal ─────────────────────────── */
  async function _openApplyClientVisitModal() {
    const todayISO = _toISO(new Date())
    const clientsRes = await API.getClients(false)
    const clients = clientsRes.data || []

    if (!clients.length) {
      Utils.showToast('No clients found in the Client Directory.', 'error')
      return
    }

    const clientOptions = clients.map(c =>
      `<option value="${c.id}">${Utils.escapeHtml(c.client_name)}</option>`
    ).join('')

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Apply for Client Visit</h3>
        <button class="modal-close" onclick="Utils.closeModal()">${CLOSE_SVG}</button>
      </div>
      <div class="modal-body">
        <div id="lt-cv-modal-err" class="alert alert--danger" style="display:none;"></div>

        <div class="form-group">
          <label class="form-label">Client <span class="required">*</span></label>
          <select class="form-input" id="lt-f-cv-client">
            <option value="">Select a client…</option>
            ${clientOptions}
          </select>
        </div>

        <div class="form-group" id="lt-cv-entity-wrap" style="display:none;">
          <label class="form-label">Entity <span class="required">*</span></label>
          <select class="form-input" id="lt-f-cv-entity"></select>
        </div>

        <div class="form-group">
          <label class="form-label">Duration <span class="required">*</span></label>
          <select class="form-input" id="lt-f-cv-duration">
            <option value="full_day">Full Day</option>
            <option value="first_half">First Half</option>
            <option value="second_half">Second Half</option>
          </select>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Start Date <span class="required">*</span></label>
            <input class="form-input" type="date" id="lt-f-cv-start" value="${todayISO}" />
          </div>
          <div class="form-group" id="lt-cv-end-wrap">
            <label class="form-label">End Date <span class="required">*</span></label>
            <input class="form-input" type="date" id="lt-f-cv-end" value="${todayISO}" />
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Reason <span class="required">*</span></label>
          <textarea class="form-input" id="lt-f-cv-reason" rows="3"
            placeholder="e.g. Monthly review meeting, production shoot…" style="resize:vertical;"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="lt-submit-cv-btn">Submit</button>
      </div>
    `)

    const clientSel = document.getElementById('lt-f-cv-client')
    const entityWrap = document.getElementById('lt-cv-entity-wrap')
    const entitySel  = document.getElementById('lt-f-cv-entity')
    const durationSel = document.getElementById('lt-f-cv-duration')
    const endWrap     = document.getElementById('lt-cv-end-wrap')
    const startEl     = document.getElementById('lt-f-cv-start')
    const endEl       = document.getElementById('lt-f-cv-end')

    // Populate entities when a client is chosen
    clientSel.addEventListener('change', () => {
      const c = clients.find(x => x.id === clientSel.value)
      const ents = c?.client_entities || []
      if (ents.length) {
        entitySel.innerHTML = ents.map(e =>
          `<option value="${e.id}">${Utils.escapeHtml(e.entity_name)}</option>`
        ).join('')
        entityWrap.style.display = ''
      } else {
        entitySel.innerHTML = ''
        entityWrap.style.display = 'none'
      }
    })

    // Half-day is single-date only
    durationSel.addEventListener('change', () => {
      const isHalf = durationSel.value !== 'full_day'
      endWrap.style.display = isHalf ? 'none' : ''
      if (isHalf) endEl.value = startEl.value
    })
    startEl.addEventListener('change', () => {
      if (endEl.value < startEl.value || durationSel.value !== 'full_day') endEl.value = startEl.value
    })

    document.getElementById('lt-submit-cv-btn').addEventListener('click', async () => {
      const errEl    = document.getElementById('lt-cv-modal-err')
      const btn      = document.getElementById('lt-submit-cv-btn')
      const clientId = clientSel.value
      const duration = durationSel.value
      const isHalf   = duration !== 'full_day'
      const start    = startEl.value
      const end      = isHalf ? start : endEl.value
      const reason   = document.getElementById('lt-f-cv-reason').value.trim()
      const c        = clients.find(x => x.id === clientId)
      const hasEnts  = (c?.client_entities || []).length > 0
      const entityId = hasEnts ? entitySel.value : null

      errEl.style.display = 'none'
      const fail = (m) => { errEl.textContent = m; errEl.style.display = 'block' }
      if (!clientId)            return fail('Please select a client.')
      if (hasEnts && !entityId) return fail('Please select an entity.')
      if (!start)               return fail('Please select a start date.')
      if (!isHalf && end < start) return fail('End date cannot be before start date.')
      if (!reason)              return fail('Please provide a reason.')

      btn.disabled = true; btn.textContent = 'Checking…'

      // Period-aware conflict check
      const hits = await _findClientVisitConflicts(start, end, duration)
      if (hits.length) {
        btn.disabled = false; btn.textContent = 'Submit'
        _showConflictPopup(hits)
        return
      }

      const days = isHalf ? 0.5 : _calcLeaveDays(start, end, false)
      const approverId = await _resolveApproverWithFallback(start, end)

      btn.textContent = 'Submitting…'
      const { error } = await API.createClientVisit({
        employee_id:   _user.id,
        client_id:     clientId,
        entity_id:     entityId,
        duration_type: duration,
        start_date:    start,
        end_date:      end,
        days,
        reason,
        status:        'pending',
        approver_id:   approverId,
      })

      btn.disabled = false; btn.textContent = 'Submit'
      if (error) return fail(error.message)

      if (approverId) {
        API.createNotification({
          recipient_employee_id: approverId,
          type: 'info',
          message: `${_user.name} submitted a Client Visit request.`,
          module: 'leave_tracker',
          notify_email: true,
        })
      } else {
        _employees
          .filter(e => (e.role === 'super_admin' || Utils.getDeptSystemKey(e.department) === 'people_culture') && e.id !== _user.id)
          .forEach(hr => API.createNotification({
            recipient_employee_id: hr.id,
            type: 'info',
            message: `${_user.name} submitted a Client Visit request (no manager assigned).`,
            module: 'leave_tracker',
            notify_email: true,
          }))
      }
      Utils.closeModal()
      Utils.showToast('Client Visit request submitted.', 'success')
      await _refreshMyLeaveData()
      _loadTab('my-client-visits')
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

      <div class="section-card mb-4">
        <div class="section-card-header">
          <h3>WFH Approvals</h3>
          <span class="badge badge--warning">${_pendingWfh.length}</span>
        </div>
        <div class="section-card-body" id="lt-wfh-approvals-body">
          ${_renderApprovalCards(_pendingWfh, 'wfh')}
        </div>
      </div>

      <div class="section-card mb-4">
        <div class="section-card-header">
          <h3>Client Visit Approvals</h3>
          <span class="badge badge--warning">${_pendingClientVisits.length}</span>
        </div>
        <div class="section-card-body" id="lt-cv-approvals-body">
          ${_renderApprovalCards(_pendingClientVisits, 'client-visit')}
        </div>
      </div>

      <div class="section-card mb-4">
        <div class="section-card-header">
          <h3>Attendance Corrections</h3>
          <span class="badge badge--warning">${_pendingCorrections.length}</span>
        </div>
        <div class="section-card-body" id="lt-correction-approvals-body">
          ${_renderCorrectionCards(_pendingCorrections)}
        </div>
      </div>

      <div class="section-card">
        <div class="section-card-header" style="cursor:pointer;user-select:none;" id="lt-history-header">
          <h3>Approval History</h3>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:12px;color:var(--text-muted);">${_historyLeave.length + _historyWfh.length + _historyClientVisit.length} decisions</span>
            <svg id="lt-history-chevron" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transition:transform .2s;"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
        </div>
        <div class="section-card-body" id="lt-history-body" style="display:none;padding:0;">
          ${_renderApprovalHistory()}
        </div>
      </div>
    `

    _bindApprovalCardActions()
    _bindCorrectionCardActions()

    // Collapsible history section
    document.getElementById('lt-history-header')?.addEventListener('click', () => {
      const body    = document.getElementById('lt-history-body')
      const chevron = document.getElementById('lt-history-chevron')
      if (!body) return
      const open = body.style.display !== 'none'
      body.style.display    = open ? 'none' : 'block'
      if (chevron) chevron.style.transform = open ? '' : 'rotate(180deg)'
    })
  }

  function _renderApprovalCards(requests, type) {
    if (!requests.length) return '<p class="empty-state">No pending approvals.</p>'

    return requests.map(r => {
      const emp         = r.employee || {}
      const initials    = Utils.getInitials(emp.name || '?')
      const isCancPend  = r.status === 'cancellation_pending'
      const typeName    = type === 'leave' ? (r.leave_types?.name || 'Leave')
                        : type === 'wfh'   ? 'WFH' : 'Client Visit'
      const dateRange   = r.start_date === r.end_date
        ? Utils.formatDate(r.start_date)
        : `${Utils.formatDate(r.start_date)} – ${Utils.formatDate(r.end_date)}`

      const reasonPreview = r.reason ? Utils.truncate(r.reason, 80) : ''
      const reasonFull    = r.reason || ''
      const hasMore       = reasonFull.length > 80

      return `
        <div class="lt-approval-card section-card" style="margin-bottom:12px;"
          data-approval-id="${r.id}" data-approval-type="${type}">
          <div style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px;">
            <div style="width:36px;height:36px;border-radius:50%;background:var(--primary-light,#e8f0fe);color:var(--primary);font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;">
              ${emp.profile_image_url ? `<img src="${Utils.escapeHtml(emp.profile_image_url)}" alt="" style="width:100%;height:100%;object-fit:cover;">` : Utils.getInitials(emp.name || '?')}
            </div>
            <div style="flex:1;min-width:0;cursor:pointer;" class="lt-approval-card-body" data-detail-id="${r.id}" data-detail-type="${type}">
              <div style="font-weight:600;font-size:14px;">${Utils.escapeHtml(emp.name || '—')}</div>
              <div style="font-size:12px;color:var(--text-muted);">${Utils.escapeHtml(emp.department || '—')}</div>
              <div style="margin-top:6px;font-size:13px;">
                <strong>${Utils.escapeHtml(typeName)}</strong>
                · ${dateRange}
                · ${r.days} day${Number(r.days) === 1 ? '' : 's'}
                ${type === 'leave' && r.is_half_day ? `<span class="badge badge--muted" style="font-size:10px;margin-left:4px;">Half-day ${r.half_day_period || ''}</span>` : ''}
                ${type === 'client-visit' ? `<span class="badge badge--muted" style="font-size:10px;margin-left:4px;">${_cvDurationLabel(r.duration_type)}</span>` : ''}
              </div>
              ${type === 'client-visit' ? `<div style="font-size:12px;margin-top:4px;"><strong>${Utils.escapeHtml(_cvClientLabel(r))}</strong></div>` : ''}
              ${r.reason ? `<div style="font-size:12px;color:var(--text-muted);margin-top:3px;">
                ${Utils.escapeHtml(reasonPreview)}${hasMore ? `<span style="color:var(--primary);margin-left:4px;font-weight:500;">View more</span>` : ''}
              </div>` : ''}
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

  function _renderCorrectionCards(requests) {
    if (!requests.length) return '<p class="empty-state">No pending approvals.</p>'

    return requests.map(r => {
      const emp = r.employee || {}
      return `
        <div class="lt-approval-card section-card" style="margin-bottom:12px;" data-correction-id="${r.id}">
          <div style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px;">
            <div style="width:36px;height:36px;border-radius:50%;background:var(--primary-light,#e8f0fe);color:var(--primary);font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;">
              ${emp.profile_image_url ? `<img src="${Utils.escapeHtml(emp.profile_image_url)}" alt="" style="width:100%;height:100%;object-fit:cover;">` : Utils.getInitials(emp.name || '?')}
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;font-size:14px;">${Utils.escapeHtml(emp.name || '—')}</div>
              <div style="font-size:12px;color:var(--text-muted);">${Utils.escapeHtml(emp.department || '—')}</div>
              <div style="margin-top:6px;font-size:13px;">
                <strong>Late Half-Day</strong> · ${Utils.formatDate(r.start_date)} · ${Utils.escapeHtml(r.leave_types?.name || 'Leave')}
              </div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:3px;">${Utils.escapeHtml(r.reason || '')}</div>
              <div style="font-size:12px;margin-top:6px;"><strong>Correction reason:</strong> ${Utils.escapeHtml(r.correction_reason || '—')}</div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0;align-items:flex-start;">
              <button class="btn btn--xs btn--success" data-correction-action="approve" data-id="${r.id}">Approve</button>
              <button class="btn btn--xs btn--danger"  data-correction-action="reject"  data-id="${r.id}">Reject</button>
            </div>
          </div>
        </div>
      `
    }).join('')
  }

  function _bindCorrectionCardActions() {
    document.querySelectorAll('[data-correction-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id     = btn.dataset.id
        const action = btn.dataset.correctionAction
        if (action === 'approve') _approveCorrection(id)
        else _rejectCorrection(id)
      })
    })
  }

  async function _approveCorrection(id) {
    const req = _pendingCorrections.find(r => r.id === id)
    const now = new Date().toISOString()
    const { error } = await API.updateLeaveRequest(id, {
      status:                'cancelled',
      acted_at:               now,
      correction_status:      'approved',
      correction_decided_by:  _user.id,
      correction_decided_at:  now,
    })
    if (error) { Utils.showToast('Failed: ' + error.message, 'error'); return }
    if (req?.employee?.id) {
      API.createNotification({
        recipient_employee_id: req.employee.id,
        type: 'approval',
        message: `Your correction request for the late half-day on ${Utils.formatDate(req.start_date)} was approved — the half-day has been reversed.`,
        module: 'leave_tracker',
        record_id: id,
        notify_email: true,
      })
    }
    Utils.showToast('Correction approved. Half-day reversed.', 'success')
    await _refreshApprovalData()
    _loadTab('pending-approvals')
  }

  async function _rejectCorrection(id) {
    const req = _pendingCorrections.find(r => r.id === id)
    const now = new Date().toISOString()
    const { error } = await API.updateLeaveRequest(id, {
      acted_at:               now,
      correction_status:      'rejected',
      correction_decided_by:  _user.id,
      correction_decided_at:  now,
    })
    if (error) { Utils.showToast('Failed: ' + error.message, 'error'); return }
    if (req?.employee?.id) {
      API.createNotification({
        recipient_employee_id: req.employee.id,
        type: 'rejection',
        message: `Your correction request for the late half-day on ${Utils.formatDate(req.start_date)} was denied. The half-day stands.`,
        module: 'leave_tracker',
        record_id: id,
        notify_email: true,
      })
    }
    Utils.showToast('Correction denied. Half-day stands.', 'success')
    await _refreshApprovalData()
    _loadTab('pending-approvals')
  }

  function _renderApprovalHistory() {
    // Merge leave + WFH history, sort by acted_at desc
    const leaveRows = _historyLeave.map(r => ({
      ...r, _kind: 'leave', typeName: r.leave_types?.name || 'Leave'
    }))
    const wfhRows = _historyWfh.map(r => ({
      ...r, _kind: 'wfh', typeName: 'WFH'
    }))
    const cvRows = _historyClientVisit.map(r => ({
      ...r, _kind: 'client-visit', typeName: 'Client Visit'
    }))
    const all = [...leaveRows, ...wfhRows, ...cvRows].sort((a, b) => {
      const da = a.acted_at ? new Date(a.acted_at) : new Date(a.created_at)
      const db = b.acted_at ? new Date(b.acted_at) : new Date(b.created_at)
      return db - da
    })

    if (!all.length) return '<p class="empty-state" style="padding:20px 16px;">No decisions yet.</p>'

    const rows = all.map(r => {
      const emp       = r.employee || {}
      const dateRange = r.start_date === r.end_date
        ? Utils.formatDate(r.start_date)
        : `${Utils.formatDate(r.start_date)} – ${Utils.formatDate(r.end_date)}`
      const decidedAt = r.acted_at
        ? new Date(r.acted_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        : '—'
      const avatarHtml = emp.profile_image_url
        ? `<img src="${Utils.escapeHtml(emp.profile_image_url)}" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">`
        : `<div style="width:28px;height:28px;border-radius:50%;background:var(--primary-light,#e8f0fe);color:var(--primary);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;">${Utils.getInitials(emp.name || '?')}</div>`

      return `<tr style="cursor:pointer;" class="lt-history-row" data-history-id="${r.id}" data-history-kind="${r._kind}">
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            ${avatarHtml}
            <div>
              <div style="font-weight:500;font-size:13px;">${Utils.escapeHtml(emp.name || '—')}</div>
              <div style="font-size:11px;color:var(--text-muted);">${Utils.escapeHtml(emp.department || '—')}</div>
            </div>
          </div>
        </td>
        <td style="font-size:13px;">${Utils.escapeHtml(r.typeName)}</td>
        <td style="font-size:13px;white-space:nowrap;">${dateRange}</td>
        <td style="font-size:13px;text-align:center;">${r.days} day${Number(r.days) === 1 ? '' : 's'}</td>
        <td>${STATUS_BADGE[r.status] || r.status}</td>
        <td style="font-size:12px;color:var(--text-muted);white-space:nowrap;">${decidedAt}</td>
      </tr>`
    }).join('')

    return `<table class="data-table">
      <thead>
        <tr>
          <th>Employee</th>
          <th>Type</th>
          <th>Dates</th>
          <th style="text-align:center;">Days</th>
          <th>Decision</th>
          <th>Decided On</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`
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

    // Clicking the card body (name/date/reason area) opens a detail modal
    document.querySelectorAll('.lt-approval-card-body').forEach(body => {
      body.addEventListener('click', () => {
        const id   = body.dataset.detailId
        const type = body.dataset.detailType
        _openLeaveDetailModal(id, type)
      })
    })

    // Clicking a history row opens a read-only detail modal
    document.querySelectorAll('.lt-history-row').forEach(row => {
      row.addEventListener('click', () => {
        const id   = row.dataset.historyId
        const kind = row.dataset.historyKind  // 'leave' or 'wfh'
        _openLeaveDetailModal(id, kind, true)
      })
    })
  }

  function _openLeaveDetailModal(id, type, readOnly = false) {
    // Search pending arrays first, then history arrays
    const pendingArr = _reqPending(type)
    const historyArr = _reqHistory(type)
    const r = pendingArr.find(x => x.id === id) || historyArr.find(x => x.id === id)
    if (!r) return

    const emp      = r.employee || {}
    const typeName = type === 'leave' ? (r.leave_types?.name || 'Leave')
                   : type === 'wfh'   ? 'WFH' : 'Client Visit'
    const dateRange = r.start_date === r.end_date
      ? Utils.formatDate(r.start_date)
      : `${Utils.formatDate(r.start_date)} – ${Utils.formatDate(r.end_date)}`
    const isCancPend = r.status === 'cancellation_pending'

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">${Utils.escapeHtml(typeName)} Request</h3>
        <button class="modal-close" onclick="Utils.closeModal()">${CLOSE_SVG}</button>
      </div>
      <div class="modal-body" style="padding:20px 24px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;">
          <div style="width:44px;height:44px;border-radius:50%;background:var(--primary-light,#e8f0fe);color:var(--primary);font-size:15px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;">
            ${emp.profile_image_url ? `<img src="${Utils.escapeHtml(emp.profile_image_url)}" alt="" style="width:100%;height:100%;object-fit:cover;">` : Utils.getInitials(emp.name || '?')}
          </div>
          <div>
            <div style="font-weight:600;font-size:15px;">${Utils.escapeHtml(emp.name || '—')}</div>
            <div style="font-size:12px;color:var(--text-muted);">${Utils.escapeHtml(emp.department || '—')}</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 20px;margin-bottom:16px;">
          <div>
            <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-muted);letter-spacing:.05em;margin-bottom:3px;">Type</div>
            <div style="font-size:14px;font-weight:500;">${Utils.escapeHtml(typeName)}</div>
          </div>
          <div>
            <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-muted);letter-spacing:.05em;margin-bottom:3px;">Duration</div>
            <div style="font-size:14px;font-weight:500;">${r.days} day${Number(r.days) === 1 ? '' : 's'}${type === 'leave' && r.is_half_day ? ' (half-day)' : ''}${type === 'client-visit' ? ' · ' + _cvDurationLabel(r.duration_type) : ''}</div>
          </div>
          ${type === 'client-visit' ? `
          <div style="grid-column:1/-1;">
            <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-muted);letter-spacing:.05em;margin-bottom:3px;">Client</div>
            <div style="font-size:14px;font-weight:500;">${Utils.escapeHtml(_cvClientLabel(r))}</div>
          </div>` : ''}
          <div>
            <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-muted);letter-spacing:.05em;margin-bottom:3px;">Date${r.start_date !== r.end_date ? 's' : ''}</div>
            <div style="font-size:14px;font-weight:500;">${dateRange}</div>
          </div>
          <div>
            <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-muted);letter-spacing:.05em;margin-bottom:3px;">Status</div>
            <div style="font-size:14px;">${STATUS_BADGE[r.status] || r.status}</div>
          </div>
          <div>
            <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-muted);letter-spacing:.05em;margin-bottom:3px;">Submitted On</div>
            <div style="font-size:14px;font-weight:500;">${Utils.formatDateTime(r.created_at)}</div>
          </div>
          ${r.acted_at ? `
          <div>
            <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-muted);letter-spacing:.05em;margin-bottom:3px;">Decided On</div>
            <div style="font-size:14px;font-weight:500;">${Utils.formatDateTime(r.acted_at)}</div>
          </div>
          <div style="grid-column:1/-1;">
            <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-muted);letter-spacing:.05em;margin-bottom:3px;">Decided By</div>
            <div style="font-size:14px;font-weight:500;">${Utils.escapeHtml(r.approver?.name || '—')}</div>
          </div>` : ''}
        </div>
        ${r.reason ? `
          <div style="margin-bottom:14px;">
            <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-muted);letter-spacing:.05em;margin-bottom:6px;">Reason</div>
            <div style="font-size:14px;line-height:1.6;white-space:pre-line;background:var(--surface);padding:10px 12px;border-radius:6px;border:1px solid var(--border);">${Utils.escapeHtml(r.reason)}</div>
          </div>
        ` : ''}
        ${type === 'wfh' && r.work_plan ? `
          <div style="margin-bottom:14px;">
            <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-muted);letter-spacing:.05em;margin-bottom:6px;">Work Plan</div>
            <div style="font-size:14px;line-height:1.6;white-space:pre-line;background:var(--surface);padding:10px 12px;border-radius:6px;border:1px solid var(--border);">${Utils.escapeHtml(r.work_plan)}</div>
          </div>
        ` : ''}
        ${r.cancellation_reason ? `
          <div style="margin-bottom:14px;padding:10px 12px;border-radius:6px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.3);">
            <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--warning);letter-spacing:.05em;margin-bottom:4px;">Cancellation Reason</div>
            <div style="font-size:14px;line-height:1.6;">${Utils.escapeHtml(r.cancellation_reason)}</div>
          </div>
        ` : ''}
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="Utils.closeModal()">Close</button>
        ${!readOnly ? (isCancPend ? `
          <button class="btn btn--ghost" id="md-deny-cancel" style="color:var(--danger);">Deny Cancellation</button>
          <button class="btn btn--success" id="md-approve-cancel">Approve Cancellation</button>
        ` : `
          <button class="btn btn--danger" id="md-reject">Reject</button>
          <button class="btn btn--success" id="md-approve">Approve</button>
        `) : ''}
      </div>
    `)

    // Wire up modal action buttons
    document.getElementById('md-approve')?.addEventListener('click', () => {
      Utils.closeModal(); _approveRequest(id, type)
    })
    document.getElementById('md-reject')?.addEventListener('click', () => {
      Utils.closeModal(); _openRejectModal(id, type)
    })
    document.getElementById('md-approve-cancel')?.addEventListener('click', () => {
      Utils.closeModal(); _approveCancellation(id, type)
    })
    document.getElementById('md-deny-cancel')?.addEventListener('click', () => {
      Utils.closeModal(); _denyCancellation(id, type)
    })
  }

  async function _approveRequest(id, type) {
    const arr = _reqPending(type)
    const req = arr.find(r => r.id === id)

    const updateFn = _reqUpdateFn(type)
    const { error } = await updateFn(id, {
      status:   'approved',
      acted_at: new Date().toISOString(),
    })
    if (error) {
      Utils.showToast('Failed to approve: ' + error.message, 'error')
    } else {
      const label     = _reqLabel(type)
      const empName   = req?.employee?.name || 'An employee'

      // Notify the requester
      if (req?.employee?.id) {
        API.createNotification({
          recipient_employee_id: req.employee.id,
          type: 'approval',
          message: `Your ${label} request has been approved.`,
          module: 'leave_tracker',
          record_id: id,
          notify_email: true,
        })
      }

      // Notify all active People & Culture members (excluding requester & current approver)
      const pcTeam = _employees.filter(e =>
        e.status === 'active' &&
        Utils.getDeptSystemKey(e.department) === 'people_culture' &&
        e.id !== req?.employee?.id &&
        e.id !== _user.id
      )
      pcTeam.forEach(e => {
        API.createNotification({
          recipient_employee_id: e.id,
          type: 'info',
          message: `${empName}'s ${label} request has been approved.`,
          module: 'leave_tracker',
          record_id: id,
        })
      })

      Utils.showToast('Request approved.', 'success')
      await _refreshApprovalData()
      _loadTab('pending-approvals')
    }
  }

  function _openRejectModal(id, type) {
    const arr = _reqPending(type)
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

      const updateFn = _reqUpdateFn(type)
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
        const label = _reqLabel(type)
        API.createNotification({
          recipient_employee_id: req.employee.id,
          type: 'rejection',
          message: `Your ${label} request was rejected${comment ? ': ' + comment : '.'}`,
          module: 'leave_tracker',
          record_id: id,
          notify_email: true,
        })
      }
      Utils.closeModal()
      Utils.showToast('Request rejected.', 'success')
      await _refreshApprovalData()
      _loadTab('pending-approvals')
    })
  }

  async function _approveCancellation(id, type) {
    const arr = _reqPending(type)
    const req = arr.find(r => r.id === id)

    const updateFn = _reqUpdateFn(type)
    const { error } = await updateFn(id, {
      status:                'cancelled',
      acted_at:              new Date().toISOString(),
      cancellation_actor_id: _user.id,
    })
    if (error) {
      Utils.showToast('Failed: ' + error.message, 'error')
    } else {
      const label = _reqLabel(type)
      if (req?.employee?.id) {
        API.createNotification({
          recipient_employee_id: req.employee.id,
          type: 'approval',
          message: `Your ${label} cancellation request has been approved.`,
          module: 'leave_tracker',
          record_id: id,
          notify_email: true,
        })
      }
      if (req?.approver_id) {
        API.createNotification({
          recipient_employee_id: req.approver_id,
          type: 'info',
          message: `${req.employee?.name || 'An employee'}'s ${label} cancellation was approved by People & Culture.`,
          module: 'leave_tracker',
          record_id: id,
          notify_email: true,
        })
      }
      Utils.showToast('Cancellation approved.', 'success')
      await _refreshApprovalData()
      _loadTab('pending-approvals')
    }
  }

  async function _denyCancellation(id, type) {
    const arr = _reqPending(type)
    const req = arr.find(r => r.id === id)

    const updateFn = _reqUpdateFn(type)
    const { error } = await updateFn(id, {
      status:                'approved',
      cancellation_actor_id: _user.id,
    })
    if (error) {
      Utils.showToast('Failed: ' + error.message, 'error')
    } else {
      const label = _reqLabel(type)
      if (req?.employee?.id) {
        API.createNotification({
          recipient_employee_id: req.employee.id,
          type: 'rejection',
          message: `Your ${label} cancellation request was denied. The original request remains approved.`,
          module: 'leave_tracker',
          record_id: id,
          notify_email: true,
        })
      }
      if (req?.approver_id) {
        API.createNotification({
          recipient_employee_id: req.approver_id,
          type: 'info',
          message: `${req.employee?.name || 'An employee'}'s ${label} cancellation was denied by People & Culture. The original request remains approved.`,
          module: 'leave_tracker',
          record_id: id,
          notify_email: true,
        })
      }
      Utils.showToast('Cancellation denied. Request restored to approved.', 'success')
      await _refreshApprovalData()
      _loadTab('pending-approvals')
    }
  }

  async function _refreshApprovalData() {
    const [paRes, pwRes, pcvRes, hlRes, hwRes, hcvRes, pcorRes] = await Promise.all([
      API.getPendingLeaveApprovals(_user.id),
      API.getPendingWfhApprovals(_user.id),
      API.getPendingClientVisitApprovals(_user.id),
      API.getApprovalHistoryLeave(_user.id),
      API.getApprovalHistoryWfh(_user.id),
      API.getApprovalHistoryClientVisit(_user.id),
      API.getPendingCorrections(_user.id),
    ])
    _pendingApprovals    = paRes.data  || []
    _pendingWfh          = pwRes.data  || []
    _pendingClientVisits = pcvRes.data || []
    _historyLeave        = hlRes.data  || []
    _historyWfh          = hwRes.data  || []
    _historyClientVisit  = hcvRes.data || []
    _pendingCorrections   = pcorRes.data || []

    if (_isHR) {
      const [hrLRes, hrWRes, hrCvRes] = await Promise.all([
        API.getHRLeaveQueue(),
        API.getHRWfhQueue(),
        API.getHRClientVisitQueue(),
      ])
      // Never surface a P&C member's own request in the queue they'd act from
      // — unless they're the only P&C-tagged person, in which case there's
      // nobody else to hand it to.
      const hrLeaves = (hrLRes.data || []).filter(r => !_pendingApprovals.some(p => p.id === r.id) && (_isSolePC || r.employee_id !== _user.id))
      const hrWfh    = (hrWRes.data || []).filter(r => !_pendingWfh.some(p => p.id === r.id) && (_isSolePC || r.employee_id !== _user.id))
      const hrCv     = (hrCvRes.data || []).filter(r => !_pendingClientVisits.some(p => p.id === r.id) && (_isSolePC || r.employee_id !== _user.id))
      _pendingApprovals    = [..._pendingApprovals, ...hrLeaves]
      _pendingWfh          = [..._pendingWfh, ...hrWfh]
      _pendingClientVisits = [..._pendingClientVisits, ...hrCv]
    }

    _updateApprovalBadge()
  }

  /* ══════════════════════════════════════════════════════════
     PUBLIC API
  ══════════════════════════════════════════════════════════ */
  return { render, init }

})()

ModuleRegistry.register({
  key:       'leave_tracker',
  routeId:   'leave-tracker',
  label:     'Leave Tracker',
  order:     9,
  icon:      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`,
  getModule: () => LeaveTracker,
  features:  {
    view_leaves:           'View Own Leaves & WFH',
    apply_leave:           'Apply for Leave',
    apply_wfh:             'Apply for WFH',
    approve_leave:         'Approve / Reject Team Leaves',
    manage_leave_settings: 'Manage HR Queue & Leave Settings',
  },
})
