/* ============================================================
   TIMESHEET — Phase 10 Redesign
   Calendar week view + per-day submission + entity support
   Tabs: My Timesheet · Team's Timesheet (managers) · Insights
   ============================================================ */

const Timesheet = (() => {

  /* ── State ──────────────────────────────────────────────── */
  let _user              = null
  let _entries           = []
  let _clients           = []
  let _internalProjects  = []   // active internal projects with their work areas
  let _directReports     = []   // employees whose manager_id === _user.id
  let _isManager         = false
  let _subordinateIds    = new Set() // employees actually in this user's reporting chain — used to gate approve/reject actions
  let _myLeaves          = []   // user's approved leave requests
  let _myWfhs            = []   // user's approved WFH requests
  let _myClientVisits    = []   // user's approved client visits
  let _teamPersonLeaves  = []   // selected team member's approved leaves
  let _teamPersonWfhs    = []   // selected team member's approved WFHs
  let _teamPersonClientVisits = [] // selected team member's approved client visits
  let _holidays          = []   // company_holidays dates (YYYY-MM-DD strings)
  // Missed days navigation
  let _missedNavMonth    = null // Date: first day of displayed missed-days month (My Timesheet)
  let _missedTeamMonth   = null // Date: first day of displayed missed-days month (Team person view)
  let _weekStart         = null
  let _activeTab         = 'mine'
  let _p                 = null
  let _sideChart         = null   // Chart.js donut
  // Team tab
  let _teamEntries       = []
  let _teamWeek          = null
  let _teamEmpId         = ''
  // Team drill-down state
  let _teamView          = 'list'       // 'list' | 'person'
  let _teamSelEmpObj     = null         // selected employee object
  let _teamPersonTab     = 'week'       // 'week' | 'history' | 'monthly'
  let _teamPersonWeek    = null         // Date (Monday) for person week view
  let _teamPersonEntries = []           // entries for person drill-down
  // Insights tab
  let _insightsCharts    = []
  let _insightsPersonMonth = null   // Date: first day of selected month for person insights
  let _personInsightsChart = null   // Chart.js donut for person insights tab

  /* ── Constants ──────────────────────────────────────────── */
  const CHART_COLORS = [
    '#0F4799','#1D9E75','#45BBF0','#F59E0B',
    '#8B5CF6','#EF4444','#EC4899','#14B8A6',
  ]

  const STATUS = {
    draft:     { label:'Draft',      cls:'badge--muted'   },
    submitted: { label:'In Review',  cls:'badge--warning' },
    approved:  { label:'Approved',   cls:'badge--success' },
    rejected:  { label:'Rejected',   cls:'badge--danger'  },
  }

  /* ── render ─────────────────────────────────────────────── */
  function render(user) {
    const tabs = [
      { id: 'mine',     label: 'My Timesheet'      },
      { id: 'team',     label: "Team's Timesheet"   },
      { id: 'insights', label: 'Insights'            },
    ]

    return `
      <div class="page-inner">
        <div class="page-toolbar">
          <div class="tabs" id="ts-tabs">
            ${tabs.map((t,i) => `
              <button class="tab-btn${i===0?' tab-btn--active':''}" data-tab="${t.id}">${t.label}</button>
            `).join('')}
          </div>
          <div id="ts-toolbar-actions"></div>
        </div>
        <div id="ts-content" class="mt-4"></div>
      </div>
    `
  }

  /* ── init ───────────────────────────────────────────────── */
  async function init(user) {
    _user      = user
    _p         = {
      can_create:  App.hasAccess('timesheet', 'log_entry',          'can_upload'),
      can_edit:    App.hasAccess('timesheet', 'submit_timesheet',   'can_upload'),
      can_approve: user.role === 'admin' || App.hasAccess('timesheet', 'approve_timesheets', 'can_approve'),
    }
    _weekStart = _getMondayOf(new Date())
    _teamWeek  = _getMondayOf(new Date())
    _activeTab = 'mine'

    // Consume any deep-link tab request (e.g. from home page "Review" button)
    const _requestedTab = sessionStorage.getItem('timesheet:tab') || null
    if (_requestedTab) sessionStorage.removeItem('timesheet:tab')

    const year = new Date().getFullYear()
    const [{ data: clients }, { data: internalProjects }, leaveData, { data: holidaysData }] = await Promise.all([
      API.getClients(false),
      API.getInternalProjects(),
      API.getApprovedLeaveForEmployee(_user.id),
      API.getCompanyHolidays(year),
    ])
    _clients          = clients || []
    _internalProjects = (internalProjects || []).filter(p => p.status === 'active')
    _myLeaves         = leaveData.leaves
    _myWfhs           = leaveData.wfhs
    _myClientVisits   = leaveData.clientVisits || []
    _holidays         = (holidaysData || []).map(h => h.date)

    // HR (can_approve) sees all active employees; managers see their reporting subtree.
    // Note: seeing an employee's timesheet and being allowed to approve it are separate —
    // approval rights are always scoped to the real reporting chain (or super_admin).
    const { data: subs } = await API.getAllSubordinates(_user.id)
    _subordinateIds = new Set((subs || []).map(e => e.id))
    if (_p.can_approve) {
      const { data: allEmps } = await API.getEmployees()
      _directReports = allEmps || []
    } else {
      _directReports = subs || []
    }
    _isManager = _directReports.length > 0

    // Hide the Team tab if the user is neither an approver nor a reporting manager
    if (!_p.can_approve && !_isManager) {
      document.querySelector('#ts-tabs .tab-btn[data-tab="team"]')?.remove()
    }

    _bindTabs()

    // If a valid tab was requested (e.g. "team" from home Review button) and
    // the user has the right permissions, navigate there instead of "mine"
    if (_requestedTab === 'team' && (_p.can_approve || _isManager)) {
      _activeTab = 'team'
      document.querySelectorAll('#ts-tabs .tab-btn').forEach(btn => {
        btn.classList.toggle('tab-btn--active', btn.dataset.tab === 'team')
      })
      _loadTab('team')
    } else {
      _loadTab('mine')
    }
  }

  // Approve/Reject rights: super_admin can act on anyone but themselves.
  // admin has that same broad reach, minus super_admin's own timesheet
  // (People & Culture handles that one instead — see below). Everyone
  // else is scoped to their real reporting chain.
  function _canApproveEmployee(employeeId) {
    if (employeeId === _user.id) return false
    if (_user.role === 'super_admin') return true
    if (_subordinateIds.has(employeeId)) return true
    // _directReports is every employee when can_approve is true (see init),
    // so this lookup works for admins even outside their own reporting line.
    const target = _directReports.find(e => e.id === employeeId)
    if (_user.role === 'admin' && target?.role !== 'super_admin') return true
    // super_admin has no manager, so their own timesheet can't route
    // through the normal chain — HR approves it instead, same idea as
    // leave/WFH falling back to the HR queue when there's no manager.
    if (_user.department === 'people_culture' && target?.role === 'super_admin') return true
    return false
  }

  /* ── Tab management ─────────────────────────────────────── */
  function _bindTabs() {
    document.querySelectorAll('#ts-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#ts-tabs .tab-btn').forEach(b => b.classList.remove('tab-btn--active'))
        btn.classList.add('tab-btn--active')
        _activeTab = btn.dataset.tab
        _loadTab(_activeTab)
      })
    })
  }

  function _loadTab(tab) {
    const toolbar = document.getElementById('ts-toolbar-actions')
    if (toolbar) toolbar.innerHTML = ''
    if (_sideChart) { _sideChart.destroy(); _sideChart = null }
    // Destroy any insights charts
    _insightsCharts.forEach(c => { try { c.destroy() } catch(_) {} })
    _insightsCharts = []
    if (_personInsightsChart) { try { _personInsightsChart.destroy() } catch(_) {} _personInsightsChart = null }
    switch (tab) {
      case 'mine':     return _loadMineTab()
      case 'team':     return _loadTeamTab()
      case 'insights': return _loadInsightsTab()
    }
  }

  /* ══════════════════════════════════════════════════════════
     MY TIMESHEET TAB
  ══════════════════════════════════════════════════════════ */
  function _loadMineTab() {
    const toolbar = document.getElementById('ts-toolbar-actions')
    if (toolbar) {
      toolbar.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;">
          <button class="btn btn--ghost btn--sm" id="ts-prev" title="Previous week">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span id="ts-week-label" style="font-size:13px;font-weight:600;min-width:180px;text-align:center;">—</span>
          <button class="btn btn--ghost btn--sm" id="ts-next" title="Next week">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      `
      document.getElementById('ts-prev').addEventListener('click', () => {
        _weekStart.setDate(_weekStart.getDate() - 7); _loadWeek()
      })
      document.getElementById('ts-next').addEventListener('click', () => {
        _weekStart.setDate(_weekStart.getDate() + 7); _loadWeek()
      })
    }
    _loadWeek()
  }

  async function _loadWeek() {
    const label = document.getElementById('ts-week-label')
    if (label) label.textContent = _weekLabel(_weekStart)

    // Disable the "Next" button when already on the current week
    const nextBtn = document.getElementById('ts-next')
    if (nextBtn) {
      const onCurrentWeek = _toISO(_weekStart) >= _toISO(_getMondayOf(new Date()))
      nextBtn.disabled = onCurrentWeek
      nextBtn.style.opacity = onCurrentWeek ? '0.35' : ''
      nextBtn.style.cursor  = onCurrentWeek ? 'not-allowed' : ''
    }

    const content = document.getElementById('ts-content')
    if (content) content.innerHTML = '<p class="loading-text">Loading…</p>'

    const { data, error } = await API.getTimesheetEntries(_user.id, _toISO(_weekStart), _toISO(_weekEnd(_weekStart)))
    if (error) { Utils.showToast('Failed to load timesheet.', 'error'); return }
    _entries = data || []
    _renderWeek()
  }

  function _renderWeek() {
    const content = document.getElementById('ts-content')
    if (!content) return

    const days = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(_weekStart)
      d.setDate(d.getDate() + i)
      return d
    })

    // Build sidebar data — group by entity name, fall back to project name
    const clientHours = {}
    _entries.forEach(e => {
      const name = e.work_type === 'internal'
        ? (e.internal_entity?.entity_name || e.internal_project?.name || 'Internal')
        : (e.entity?.entity_name || e.clients?.client_name || 'Unknown')
      clientHours[name] = (clientHours[name] || 0) + parseFloat(e.hours || 0)
    })
    const totalHours = Object.values(clientHours).reduce((s, h) => s + h, 0)

    // Pending: past weekdays with unsent drafts
    const today = _toISO(new Date())
    const pending = days.filter(d => {
      const iso = _toISO(d)
      if (iso >= today) return false
      return _entries.some(e => e.date === iso && e.status === 'draft')
    })

    content.innerHTML = `
      <div class="ts-layout">
        <div class="ts-day-grid">
          ${days.map(d => _renderDayCol(d)).join('')}
        </div>
        <div class="ts-sidebar">
          ${_renderSidebar(totalHours, clientHours, days, pending)}
        </div>
      </div>
    `

    // Bind interactions
    content.querySelectorAll('.ts-add-btn').forEach(btn =>
      btn.addEventListener('click', () => _openEntryModal(btn.dataset.date))
    )
    content.querySelectorAll('.ts-submit-day').forEach(btn =>
      btn.addEventListener('click', () => _submitDay(btn.dataset.date))
    )
    content.querySelectorAll('.ts-edit-entry').forEach(btn =>
      btn.addEventListener('click', () => {
        const entry = _entries.find(e => e.id === btn.dataset.id)
        if (entry) _openEntryModal(entry.date, entry)
      })
    )
    content.querySelectorAll('.ts-delete-entry').forEach(btn =>
      btn.addEventListener('click', () => _deleteEntry(btn.dataset.id))
    )

    _initSidebarChart(clientHours)
    _loadMissedSection()
  }

  /* ── Day column ─────────────────────────────────────────── */
  /* ── Leave / WFH helpers ────────────────────────────────── */
  // ── Leave helpers ────────────────────────────────────────────
  function _getLeave(iso, leaves) {
    return leaves.find(l => iso >= l.start_date && iso <= l.end_date) || null
  }
  function _isLeaveDay(iso, leaves)     { return !!_getLeave(iso, leaves) }
  // Full-day leave = blocks the entire day; no timesheet entry allowed
  function _isFullLeaveDay(iso, leaves) {
    const l = _getLeave(iso, leaves); return !!l && !l.is_half_day
  }
  // Half-day leave = partial; timesheet entry still allowed for the other half
  function _isHalfLeaveDay(iso, leaves) {
    const l = _getLeave(iso, leaves); return !!l && !!l.is_half_day
  }
  function _isWfhDay(iso, wfhs) {
    return wfhs.some(w => iso >= w.start_date && iso <= w.end_date)
  }
  // Approved client visit covering this date (or null)
  function _clientVisitForDay(iso, cvs) {
    return (cvs || []).find(c => iso >= c.start_date && iso <= c.end_date) || null
  }
  function _cvDurLabel(d) {
    return d === 'first_half' ? 'First Half' : d === 'second_half' ? 'Second Half' : 'Full Day'
  }
  // Read-only context banner shown for a half-day client visit (full-day
  // visits auto-create an editable entry instead, so they need no banner).
  function _cvContextBanner(cv) {
    const client = cv.clients?.client_name || 'Client'
    const entity = cv.entity?.entity_name ? ' — ' + Utils.escapeHtml(cv.entity.entity_name) : ''
    return `
      <div class="ts-cv-context">
        <span class="ts-cv-context-tag">${_cvDurLabel(cv.duration_type)} · Client Visit</span>
        <div class="ts-cv-context-client">${Utils.escapeHtml(client)}${entity}</div>
        ${cv.reason ? `<div class="ts-cv-context-reason">${Utils.escapeHtml(cv.reason)}</div>` : ''}
      </div>`
  }
  function _getLeaveName(iso, leaves) {
    return _getLeave(iso, leaves)?.leave_types?.name || null
  }
  function _getHalfDayPeriod(iso, leaves) {
    const p = _getLeave(iso, leaves)?.half_day_period || ''
    if (p === 'first_half')  return 'First Half'
    if (p === 'second_half') return 'Second Half'
    return null
  }

  function _weekdaysInMonth(year, month) {
    let count = 0
    const days = new Date(year, month + 1, 0).getDate()
    for (let d = 1; d <= days; d++) {
      const dow = new Date(year, month, d).getDay()
      if (dow !== 0 && dow !== 6) count++
    }
    return count
  }

  function _leaveDaysInMonth(leaves, mS, mE) {
    let full = 0, half = 0
    ;(leaves || []).forEach(l => {
      if (l.end_date < mS || l.start_date > mE) return
      if (l.is_half_day) {
        const dow = new Date(l.start_date).getDay()
        if (l.start_date >= mS && l.start_date <= mE && dow !== 0 && dow !== 6) half += 0.5
      } else {
        const s = new Date(Math.max(new Date(l.start_date), new Date(mS)))
        const e = new Date(Math.min(new Date(l.end_date), new Date(mE)))
        for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
          if (d.getDay() !== 0 && d.getDay() !== 6) full++
        }
      }
    })
    return { full, half, total: full + half }
  }

  function _renderDayCol(day) {
    const iso        = _toISO(day)
    const today      = _toISO(new Date())
    const dayEntries = _entries.filter(e => e.date === iso)
    const isToday    = iso === today
    const dayHours   = dayEntries.reduce((s, e) => s + parseFloat(e.hours || 0), 0)

    // Hard lock: dates more than N days in the past, or any future date
    // (N is temporarily widened — see _editLockDays)
    const diffDays  = Math.floor((new Date(today) - new Date(iso)) / 86400000)
    const isFuture  = iso > today
    const isLocked  = diffDays > _editLockDays()
    const isHoliday = _isHoliday(iso)
    const isSunday  = day.getDay() === 0

    // Leave / WFH status for this day.
    // Half-day leaves are intentionally NOT marked on the timesheet — the
    // employee works the other half and must still log time, so a half-day is
    // treated as a normal working day. Only a full-day leave blocks the day.
    const isFullLeaveDay = _isFullLeaveDay(iso, _myLeaves)
    const isWfhDay       = !isFullLeaveDay && _isWfhDay(iso, _myWfhs)
    const leaveName      = isFullLeaveDay ? _getLeaveName(iso, _myLeaves) : null
    const halfLeaveDay   = !isFullLeaveDay && _isHalfLeaveDay(iso, _myLeaves)
    const halfLeavePeriod = halfLeaveDay ? _getHalfDayPeriod(iso, _myLeaves) : null
    const cvDay          = _clientVisitForDay(iso, _myClientVisits)
    const cvHalf         = cvDay && cvDay.duration_type !== 'full_day'

    // Warn for missing hours on past working days (leave, holiday, and Sunday excluded).
    const isPastNoEntry = !isToday && diffDays > 0 && diffDays <= 7 && dayEntries.length === 0 && !isFullLeaveDay && !isHoliday && !isSunday

    // Determine day-level status
    const drafts    = dayEntries.filter(e => e.status === 'draft').length
    const submitted = dayEntries.filter(e => e.status === 'submitted').length
    const approved  = dayEntries.filter(e => e.status === 'approved').length
    const rejected  = dayEntries.filter(e => e.status === 'rejected').length

    // A day with an unresolved rejection stays fully editable regardless of
    // the lock window — same principle _openEntryModal already applies to a
    // single entry, extended to the whole day so the "Submit Draft" action
    // actually shows once a rejected entry gets edited back into 'draft'.
    // Editing doesn't clear rejection_comment, so it's still the signal to
    // check even after status has already moved off 'rejected'.
    const hasUnresolvedRejection = dayEntries.some(e => e.status === 'rejected' || (e.status === 'draft' && e.rejection_comment))
    const effectiveLocked = isLocked && !hasUnresolvedRejection

    let headerIcon = ''
    if (isPastNoEntry) {
      headerIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" title="No hours logged"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
    } else if (dayEntries.length && approved === dayEntries.length) {
      headerIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1D9E75" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
    } else if (submitted > 0 && drafts === 0 && rejected === 0) {
      headerIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`
    } else if (rejected > 0) {
      headerIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`
    }

    let footerHtml = ''
    if (effectiveLocked && (isSunday || isHoliday) && dayEntries.length === 0) {
      footerHtml = isSunday
        ? `<div class="ts-day-action ts-day-action--locked">Day Off</div>`
        : `<div class="ts-day-action" style="background:#F0FDF4;color:#059669;border:none;cursor:default;">Holiday</div>`
    } else if (effectiveLocked) {
      footerHtml = `<div class="ts-day-action ts-day-action--locked">Locked</div>`
    } else if (isSunday && dayEntries.length === 0) {
      footerHtml = `<div class="ts-day-action" style="background:var(--surface-2,#F9FAFB);color:var(--text-muted);border:none;cursor:default;">Day Off</div>`
    } else if (isHoliday && dayEntries.length === 0) {
      footerHtml = `<div class="ts-day-action" style="background:#F0FDF4;color:#059669;border:none;cursor:default;">Holiday</div>`
    } else if (isFullLeaveDay && dayEntries.length === 0) {
      footerHtml = `<div class="ts-day-action" style="background:#EEF2FF;color:#6366F1;border:none;cursor:default;">On Leave</div>`
    } else if (drafts > 0 && _p.can_edit) {
      footerHtml = `<button class="ts-day-action ts-day-action--submit ts-submit-day" data-date="${iso}">Submit ${drafts} Draft${drafts > 1 ? 's' : ''}</button>`
    } else if (approved === dayEntries.length && dayEntries.length > 0) {
      footerHtml = `<div class="ts-day-action ts-day-action--approved">Approved</div>`
    } else if (submitted > 0 && drafts === 0 && rejected === 0) {
      footerHtml = `<div class="ts-day-action ts-day-action--review">In Review</div>`
    } else if (rejected > 0) {
      footerHtml = `<div class="ts-day-action ts-day-action--rejected">Has Rejections</div>`
    }

    return `
      <div class="ts-col${isToday ? ' ts-col--today' : ''}${effectiveLocked ? ' ts-col--locked' : ''}${isFullLeaveDay ? ' ts-col--leave' : ''}${isHoliday ? ' ts-col--holiday' : ''}${isSunday ? ' ts-col--off' : ''}">
        <div class="ts-col-header">
          <div class="ts-col-top">
            <span class="ts-col-weekday">${day.toLocaleDateString('en-IN', { weekday:'short' }).toUpperCase()}</span>
            <span class="ts-col-status-icon">${headerIcon}${isSunday ? `<span style="font-size:9px;font-weight:600;background:var(--surface-2,#F3F4F6);color:var(--text-muted);border-radius:99px;padding:1px 6px;margin-left:2px;white-space:nowrap;">Day Off</span>` : ''}${isHoliday ? `<span style="font-size:9px;font-weight:600;background:#F0FDF4;color:#059669;border-radius:99px;padding:1px 6px;margin-left:2px;white-space:nowrap;">Holiday</span>` : ''}${halfLeaveDay ? `<span style="font-size:9px;font-weight:600;background:#EEF2FF;color:#6366F1;border-radius:99px;padding:1px 6px;margin-left:2px;white-space:nowrap;" title="Half-day leave${halfLeavePeriod ? ' — ' + halfLeavePeriod : ''}">½ Leave</span>` : ''}${isWfhDay ? `<span style="font-size:9px;font-weight:600;background:#ECFDF5;color:#059669;border-radius:99px;padding:1px 6px;margin-left:2px;white-space:nowrap;">WFH</span>` : ''}${cvDay ? `<span style="font-size:9px;font-weight:600;background:#E0F2FE;color:#0369A1;border-radius:99px;padding:1px 6px;margin-left:2px;white-space:nowrap;">Visit</span>` : ''}</span>
          </div>
          <span class="ts-col-date${isToday ? ' ts-col-date--today' : ''}">${day.getDate()}</span>
          ${dayHours > 0 ? `<span class="ts-col-hours">${dayHours.toFixed(1)}h</span>` : ''}
        </div>

        <div class="ts-col-body">
          ${isSunday && dayEntries.length === 0 ? `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:20px 8px;text-align:center;flex:1;">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              <span style="font-size:11px;font-weight:600;color:var(--text-muted);">Day Off</span>
            </div>
          ` : ''}
          ${!isSunday && isHoliday && dayEntries.length === 0 ? `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:20px 8px;text-align:center;flex:1;">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              <span style="font-size:11px;font-weight:600;color:#059669;">Holiday</span>
            </div>
          ` : ''}
          ${!isSunday && !isHoliday && isFullLeaveDay && dayEntries.length === 0 ? `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:20px 8px;text-align:center;flex:1;">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6366F1" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              <span style="font-size:11px;font-weight:600;color:#6366F1;">On Leave</span>
              ${leaveName ? `<span style="font-size:10px;color:var(--text-muted);">${Utils.escapeHtml(leaveName)}</span>` : ''}
            </div>
          ` : ''}
          ${cvHalf ? _cvContextBanner(cvDay) : ''}
          ${(!isFullLeaveDay && !isHoliday && !isSunday) || dayEntries.length > 0 ? dayEntries.map(e => _renderCard(e)).join('') : ''}
          ${_p.can_create && !effectiveLocked && !isFuture && !isFullLeaveDay && !isHoliday && !isSunday ? `
            <button class="ts-add-btn" data-date="${iso}">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add Entry
            </button>
          ` : ''}
        </div>

        <div class="ts-col-footer">${footerHtml}</div>
      </div>
    `
  }

  /* ── Entry card ─────────────────────────────────────────── */
  function _renderCard(e) {
    const canAct      = e.status === 'draft' || e.status === 'rejected'
    const isInternal  = e.work_type === 'internal'
    const projName    = isInternal ? (e.internal_project?.name || 'Internal') : (e.clients?.client_name || null)
    const projCode    = isInternal ? (e.internal_project?.project_code || null) : (e.clients?.project_code || null)
    const entityName  = isInternal ? (e.internal_entity?.entity_name || null) : (e.entity?.entity_name || null)
    const desc        = e.work_description || e.task_description || ''
    const lateIcon    = e.is_late ? `<span title="Logged late" style="color:#F59E0B;font-size:11px;">🕐</span>` : ''

    return `
      <div class="ts-card ts-card--${e.status}">
        <div class="ts-card-client">
          ${isInternal ? `<span class="ts-card-type-badge ts-card-type-badge--internal">Internal</span>` : ''}
          ${e.source_client_visit_id ? `<span class="ts-card-type-badge" style="background:#E0F2FE;color:#0369A1;">Client Visit</span>` : ''}
          <span class="ts-card-client-name">${Utils.escapeHtml(projName || '—')}</span>
          ${projCode ? `<span class="ts-card-code">${Utils.escapeHtml(projCode)}</span>` : ''}
          ${lateIcon}
        </div>
        ${entityName ? `<div class="ts-card-entity">${Utils.escapeHtml(entityName)}</div>` : ''}
        ${desc ? `<div class="ts-card-desc" style="white-space:pre-wrap;word-break:break-word;">${Utils.escapeHtml(desc)}</div>` : ''}
        <div class="ts-card-footer">
          <span class="ts-card-hours">${parseFloat(e.hours).toFixed(1)}h</span>
          <span class="badge ${STATUS[e.status]?.cls || 'badge--muted'}">${STATUS[e.status]?.label || e.status}</span>
        </div>
        ${e.rejection_comment ? `
          <div class="ts-card-rejection">
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            ${Utils.escapeHtml(e.rejection_comment)}
          </div>
        ` : ''}
        ${e.approval_comment ? `
          <div class="ts-card-rejection" style="background:var(--success-light,#D1FAE5);color:#065F46;border-color:#6EE7B7;">
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            ${Utils.escapeHtml(e.approval_comment)}
          </div>
        ` : ''}
        ${canAct ? `
          <div class="ts-card-actions">
            <button class="ts-edit-entry" data-id="${e.id}" title="Edit">
              <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Edit
            </button>
            <button class="ts-delete-entry" data-id="${e.id}" title="Delete">
              <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              Delete
            </button>
          </div>
        ` : ''}
      </div>
    `
  }

  /* ── Sidebar ────────────────────────────────────────────── */
  function _renderSidebar(totalHours, clientHours, days, pending) {
    const dayBarsHtml = days.map(d => {
      const iso    = _toISO(d)
      const de     = _entries.filter(e => e.date === iso)
      const h      = de.reduce((s, e) => s + parseFloat(e.hours || 0), 0)
      const allApp = de.length > 0 && de.every(e => e.status === 'approved')
      const allSub = de.length > 0 && de.every(e => ['submitted','approved'].includes(e.status))
      const hasDraft = de.some(e => e.status === 'draft')
      const color  = allApp ? '#1D9E75' : allSub ? '#F59E0B' : hasDraft ? '#0F4799' : 'var(--border)'
      const pct    = Math.max(h > 0 ? Math.round((h / 9) * 100) : 0, 0)
      const label  = d.toLocaleDateString('en-IN', { weekday:'short' }).slice(0,1)
      return `
        <div class="ts-sb-bar-wrap">
          <span class="ts-sb-bar-val">${h > 0 ? h.toFixed(0) : ''}</span>
          <div class="ts-sb-bar-track">
            <div class="ts-sb-bar-fill" style="height:${pct}%;background:${color};"></div>
          </div>
          <span class="ts-sb-bar-label">${label}</span>
        </div>
      `
    }).join('')

    const clientLegend = Object.entries(clientHours).map(([name, h], i) => `
      <div class="ts-sb-legend-row">
        <span class="ts-sb-legend-dot" style="background:${CHART_COLORS[i % CHART_COLORS.length]};"></span>
        <span class="ts-sb-legend-name">${Utils.escapeHtml(name)}</span>
        <span class="ts-sb-legend-val">${h.toFixed(0)}h</span>
      </div>
    `).join('')

    const pendingHtml = pending.length ? `
      <div class="ts-sb-section">
        <div class="ts-sb-label">Pending</div>
        ${pending.map(d => {
          const iso  = _toISO(d)
          const dHrs = _entries.filter(e => e.date === iso && e.status === 'draft')
                               .reduce((s, e) => s + parseFloat(e.hours || 0), 0)
          const dateLabel = d.toLocaleDateString('en-IN', { month:'short', day:'numeric' })
          return `
            <div class="ts-sb-pending-row">
              <span>${dateLabel}</span>
              <div style="display:flex;align-items:center;gap:6px;">
                <span style="font-weight:600;font-size:12px;">${dHrs.toFixed(0)}h</span>
                ${_p.can_edit ? `<button class="btn btn--xs ts-submit-day" data-date="${iso}" style="background:#EF4444;color:#fff;border:none;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:600;cursor:pointer;">Fix</button>` : ''}
              </div>
            </div>
          `
        }).join('')}
      </div>
    ` : ''

    return `
      <div class="ts-sb-section">
        <div class="ts-sb-label">Weekly Hours</div>
        <div class="ts-sb-total">${totalHours.toFixed(1)}</div>
        <div class="ts-sb-bars">${dayBarsHtml}</div>
      </div>

      ${Object.keys(clientHours).length ? `
        <div class="ts-sb-section" style="margin-top:20px;">
          <div class="ts-sb-label">Distribution</div>
          <div class="ts-sb-donut-wrap">
            <canvas id="ts-donut" width="120" height="120"></canvas>
          </div>
          <div class="ts-sb-legend">${clientLegend}</div>
        </div>
      ` : ''}

      ${pendingHtml}

      <div id="ts-missed-wrap" style="margin-top:20px;">
        <p class="loading-text" style="font-size:12px;">Loading missed days…</p>
      </div>
    `
  }

  async function _loadMissedSection() {
    const wrap = document.getElementById('ts-missed-wrap')
    if (!wrap) return
    if (!_missedNavMonth) _missedNavMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)

    const y  = _missedNavMonth.getFullYear()
    const m  = _missedNavMonth.getMonth() + 1
    const mS = `${y}-${String(m).padStart(2,'0')}-01`
    const mE = `${y}-${String(m).padStart(2,'0')}-${new Date(y, m, 0).getDate()}`

    const [{ data: monthEntries }, leaveData] = await Promise.all([
      API.getTimesheetEntries(_user.id, mS, mE),
      API.getApprovedLeaveForEmployee(_user.id),
    ])

    const missed = _getMissedDays(y, m, monthEntries || [], leaveData.leaves || [])
    wrap.innerHTML = _renderMissedSection(missed, _missedNavMonth, null, null, true)

    wrap.querySelector('.ts-missed-prev')?.addEventListener('click', () => {
      _missedNavMonth = new Date(_missedNavMonth.getFullYear(), _missedNavMonth.getMonth() - 1, 1)
      _loadMissedSection()
    })
    wrap.querySelector('.ts-missed-next')?.addEventListener('click', () => {
      const next = new Date(_missedNavMonth.getFullYear(), _missedNavMonth.getMonth() + 1, 1)
      if (next <= new Date()) { _missedNavMonth = next; _loadMissedSection() }
    })
  }

  function _initSidebarChart(clientHours) {
    const canvas = document.getElementById('ts-donut')
    if (!canvas || typeof Chart === 'undefined') return
    if (_sideChart) { _sideChart.destroy(); _sideChart = null }
    const labels = Object.keys(clientHours)
    const data   = Object.values(clientHours)
    if (!labels.length) return
    _sideChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data, backgroundColor: CHART_COLORS.slice(0, data.length), borderWidth: 2, borderColor: '#fff' }],
      },
      options: {
        cutout: '68%',
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed.toFixed(1)}h` } } },
      },
    })
  }

  /* ── Per-day submit ─────────────────────────────────────── */
  async function _submitDay(date) {
    const draftIds = _entries.filter(e => e.date === date && e.status === 'draft').map(e => e.id)
    if (!draftIds.length) return

    const now      = new Date()
    const nowISO   = now.toISOString()
    // is_late: submitted more than 24 hours after the log date
    const logDate  = new Date(date + 'T00:00:00')
    const isLate   = (now - logDate) > 24 * 60 * 60 * 1000

    const { error } = await Config.supabase
      .from('timesheets')
      .update({ status: 'submitted', submitted_at: nowISO, is_late: isLate, updated_at: nowISO })
      .in('id', draftIds)
      .eq('employee_id', _user.id)

    if (error) {
      Utils.showToast('Failed to submit. Try again.', 'error')
    } else {
      if (_user.manager_id) {
        API.createNotification({
          recipient_employee_id: _user.manager_id,
          type: 'info',
          message: `${_user.name} submitted timesheet entries for ${date}.`,
          module: 'timesheet',
        })
      }
      Utils.showToast('Entries submitted for review.', 'success')
      await _loadWeek()
    }
  }

  /* ── Entry modal (create + edit) ────────────────────────── */
  function _openEntryModal(preDate = null, existingEntry = null) {
    const isEdit        = !!existingEntry
    const todayISO      = _toISO(new Date())
    const normalMinISO  = (() => { const d = new Date(); d.setDate(d.getDate() - _editLockDays()); return _toISO(d) })()
    // A rejected entry stays editable no matter how old its date is — being
    // rejected is what re-opens it, not the calendar. Pull the floor back to
    // the entry's own date so its pre-filled value is never treated as
    // invalid, without opening the door to picking an even older date.
    const minDateISO    = (isEdit && existingEntry.status === 'rejected' && existingEntry.date < normalMinISO)
      ? existingEntry.date
      : normalMinISO
    const weekStartISO  = _toISO(_weekStart)
    const weekEndISO    = _toISO(_weekEnd(_weekStart))
    const defaultDate   = preDate
      ? (preDate < minDateISO ? minDateISO : preDate)           // clamp if somehow passed a locked date
      : (todayISO >= weekStartISO && todayISO <= weekEndISO ? todayISO : weekStartISO)

    // Resolve work type for edit mode
    const preWorkType = existingEntry?.work_type || 'client'

    // Client mode pre-fill
    const preClientId      = existingEntry?.client_id || ''
    const preClient        = preClientId ? _clients.find(c => c.id === preClientId) : null
    const preClientDisplay = preClient ? `${preClient.project_code} — ${preClient.client_name}` : ''
    const preClientEntities = preClient?.client_entities || []
    const preEntityId      = existingEntry?.entity_id || ''

    // Internal mode pre-fill
    const preIntProjId     = existingEntry?.internal_project_id || ''
    const preIntProj       = preIntProjId ? _internalProjects.find(p => p.id === preIntProjId) : null
    const preIntProjDisplay = preIntProj ? `${preIntProj.project_code} — ${preIntProj.name}` : ''
    const preIntWorkAreas  = preIntProj?.internal_project_entities || []
    const preIntEntityId   = existingEntry?.internal_entity_id || ''

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">${isEdit ? 'Edit Entry' : 'Log Time Entry'}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <div id="ts-modal-err" class="alert alert--danger" style="display:none;margin-bottom:12px;"></div>

        <!-- Work Type toggle -->
        <div class="form-group" style="margin-bottom:16px;">
          <label class="form-label">Work Type</label>
          <div class="ts-work-type-toggle">
            <button type="button" class="ts-wt-btn${preWorkType === 'client' ? ' ts-wt-btn--active' : ''}" data-type="client">Client Work</button>
            <button type="button" class="ts-wt-btn${preWorkType === 'internal' ? ' ts-wt-btn--active' : ''}" data-type="internal">Internal Work</button>
          </div>
          <input type="hidden" id="ts-f-work-type" value="${preWorkType}" />
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Date <span class="required">*</span></label>
            <input class="form-input" type="date" id="ts-f-date"
              min="${minDateISO}" max="${todayISO}"
              value="${existingEntry?.date || defaultDate}" />
          </div>
          <div class="form-group">
            <label class="form-label">Hours <span class="required">*</span></label>
            <input class="form-input" type="number" id="ts-f-hours"
              min="0.5" max="12" step="0.5"
              value="${existingEntry?.hours || ''}"
              placeholder="e.g. 2.5" />
          </div>
        </div>

        <!-- CLIENT work fields -->
        <div id="ts-client-fields" style="${preWorkType === 'internal' ? 'display:none;' : ''}">
          <div class="form-group">
            <label class="form-label">Client / Project <span class="required">*</span></label>
            <div class="custom-select-wrap" id="ts-client-wrap" style="min-width:0;">
              <input class="form-input" type="text" id="ts-f-client-search"
                placeholder="Type to search client or project code…"
                autocomplete="off"
                value="${Utils.escapeHtml(preClientDisplay)}" />
              <div class="custom-select-dropdown" id="ts-client-dropdown"
                   style="display:none;position:absolute;width:100%;left:0;z-index:200;">
                <div class="custom-select-list" id="ts-client-list"></div>
              </div>
            </div>
            <input type="hidden" id="ts-f-client" value="${preClientId}" />
          </div>
          <div class="form-group" id="ts-entity-wrap" style="${preClientEntities.length ? '' : 'display:none;'}">
            <label class="form-label">Entity <span class="required">*</span></label>
            <select class="form-select" id="ts-f-entity">
              <option value="">— Select entity —</option>
              ${preClientEntities.map(en => `<option value="${en.id}" ${preEntityId === en.id ? 'selected' : ''}>${Utils.escapeHtml(en.entity_name)}</option>`).join('')}
            </select>
          </div>
        </div>

        <!-- INTERNAL work fields -->
        <div id="ts-internal-fields" style="${preWorkType === 'client' ? 'display:none;' : ''}">
          <div class="form-group">
            <label class="form-label">Internal Project <span class="required">*</span></label>
            <div class="custom-select-wrap" id="ts-int-wrap" style="min-width:0;">
              <input class="form-input" type="text" id="ts-f-int-search"
                placeholder="Type to search internal project…"
                autocomplete="off"
                value="${Utils.escapeHtml(preIntProjDisplay)}" />
              <div class="custom-select-dropdown" id="ts-int-dropdown"
                   style="display:none;position:absolute;width:100%;left:0;z-index:200;">
                <div class="custom-select-list" id="ts-int-list"></div>
              </div>
            </div>
            <input type="hidden" id="ts-f-int-project" value="${preIntProjId}" />
          </div>
          <div class="form-group" id="ts-workarea-wrap" style="${preIntWorkAreas.length ? '' : 'display:none;'}">
            <label class="form-label">Work Area <span class="required">*</span></label>
            <select class="form-select" id="ts-f-workarea">
              <option value="">— Select work area —</option>
              ${preIntWorkAreas.map(wa => `<option value="${wa.id}" ${preIntEntityId === wa.id ? 'selected' : ''}>${Utils.escapeHtml(wa.entity_name)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Work Description <span class="required">*</span></label>
          <textarea class="form-input" id="ts-f-desc" rows="3"
            placeholder="Describe what you worked on…"
            style="resize:vertical;">${Utils.escapeHtml(existingEntry?.work_description || existingEntry?.task_description || '')}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="ts-modal-save">${isEdit ? 'Update Entry' : 'Save Entry'}</button>
      </div>
    `, { width: '520px' })

    // ── Work Type toggle ─────────────────────────────────────
    document.querySelectorAll('.ts-wt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.ts-wt-btn').forEach(b => b.classList.remove('ts-wt-btn--active'))
        btn.classList.add('ts-wt-btn--active')
        document.getElementById('ts-f-work-type').value = btn.dataset.type
        const isInt = btn.dataset.type === 'internal'
        document.getElementById('ts-client-fields').style.display   = isInt ? 'none' : ''
        document.getElementById('ts-internal-fields').style.display = isInt ? '' : 'none'
      })
    })

    // ── Client combobox ──────────────────────────────────────
    _bindCombobox({
      searchId:   'ts-f-client-search',
      dropdownId: 'ts-client-dropdown',
      listId:     'ts-client-list',
      wrapId:     'ts-client-wrap',
      hiddenId:   'ts-f-client',
      items:      _clients,
      getLabel:   c => c.client_name,
      getCode:    c => c.project_code,
      getId:      c => c.id,
      onSelect:   id => {
        const client   = _clients.find(c => c.id === id)
        const entities = client?.client_entities || []
        const wrap     = document.getElementById('ts-entity-wrap')
        const sel      = document.getElementById('ts-f-entity')
        if (entities.length) {
          sel.innerHTML = '<option value="">— Select entity —</option>' +
            entities.map(en => `<option value="${en.id}">${Utils.escapeHtml(en.entity_name)}</option>`).join('')
          wrap.style.display = ''
        } else { sel.innerHTML = ''; wrap.style.display = 'none' }
      },
    })

    // ── Internal project combobox ────────────────────────────
    _bindCombobox({
      searchId:   'ts-f-int-search',
      dropdownId: 'ts-int-dropdown',
      listId:     'ts-int-list',
      wrapId:     'ts-int-wrap',
      hiddenId:   'ts-f-int-project',
      items:      _internalProjects,
      getLabel:   p => p.name,
      getCode:    p => p.project_code,
      getId:      p => p.id,
      onSelect:   id => {
        const proj      = _internalProjects.find(p => p.id === id)
        const workAreas = proj?.internal_project_entities || []
        const wrap      = document.getElementById('ts-workarea-wrap')
        const sel       = document.getElementById('ts-f-workarea')
        if (workAreas.length) {
          sel.innerHTML = '<option value="">— Select work area —</option>' +
            workAreas.map(wa => `<option value="${wa.id}">${Utils.escapeHtml(wa.entity_name)}</option>`).join('')
          wrap.style.display = ''
        } else { sel.innerHTML = ''; wrap.style.display = 'none' }
      },
    })

    // ── Save ─────────────────────────────────────────────────
    document.getElementById('ts-modal-save')?.addEventListener('click', async () => {
      const errEl    = document.getElementById('ts-modal-err')
      const saveBtn  = document.getElementById('ts-modal-save')
      errEl.style.display = 'none'

      const date      = document.getElementById('ts-f-date').value
      const hours     = parseFloat(document.getElementById('ts-f-hours').value)
      const workType  = document.getElementById('ts-f-work-type').value
      const desc      = document.getElementById('ts-f-desc').value.trim()

      const clientId      = document.getElementById('ts-f-client').value || null
      const entityId      = document.getElementById('ts-f-entity')?.value || null
      const intProjId     = document.getElementById('ts-f-int-project').value || null
      const intEntityId   = document.getElementById('ts-f-workarea')?.value || null

      const errs = []
      if (!date)                      errs.push('Date is required.')
      if (date > todayISO)            errs.push('Cannot log entries for future dates.')
      if (date < minDateISO)          errs.push('This date is outside the editable window.')
      if (isNaN(hours) || hours <= 0) errs.push('Hours must be greater than 0.')
      if (hours > 12)                 errs.push('Hours cannot exceed 12 per entry.')
      if (!desc)                      errs.push('Work description is required.')

      if (workType === 'client') {
        if (!clientId)                errs.push('Please select a client.')
        const clientObj    = _clients.find(c => c.id === clientId)
        const hasEntities  = (clientObj?.client_entities || []).length > 0
        if (hasEntities && !entityId) errs.push('Please select an entity for this client.')
      } else {
        if (!intProjId)               errs.push('Please select an internal project.')
        const intProjObj   = _internalProjects.find(p => p.id === intProjId)
        const hasWorkAreas = (intProjObj?.internal_project_entities || []).length > 0
        if (hasWorkAreas && !intEntityId) errs.push('Please select a work area for this project.')
      }

      if (errs.length) { errEl.textContent = errs[0]; errEl.style.display = 'block'; return }

      saveBtn.disabled    = true
      saveBtn.textContent = isEdit ? 'Updating…' : 'Saving…'

      const clientObj = workType === 'client' ? _clients.find(c => c.id === clientId) : null
      const intProj   = workType === 'internal' ? _internalProjects.find(p => p.id === intProjId) : null

      const payload = {
        date,
        hours,
        work_type:            workType,
        client_id:            workType === 'client' ? clientId : null,
        entity_id:            workType === 'client' ? (entityId || null) : null,
        project_code:         workType === 'client' ? (clientObj?.project_code || null) : (intProj?.project_code || null),
        internal_project_id:  workType === 'internal' ? intProjId : null,
        internal_entity_id:   workType === 'internal' ? (intEntityId || null) : null,
        work_description:     desc,
        task_description:     desc,
        updated_at:           new Date().toISOString(),
      }

      let error
      if (isEdit) {
        if (existingEntry.status === 'rejected') payload.status = 'draft'
        ;({ error } = await Config.supabase.from('timesheets').update(payload).eq('id', existingEntry.id).eq('employee_id', _user.id))
      } else {
        ;({ error } = await Config.supabase.from('timesheets').insert({ ...payload, employee_id: _user.id, status: 'draft' }))
      }

      saveBtn.disabled    = false
      saveBtn.textContent = isEdit ? 'Update Entry' : 'Save Entry'

      if (error) { errEl.textContent = error.message; errEl.style.display = 'block' }
      else { Utils.closeModal(); Utils.showToast(isEdit ? 'Entry updated.' : 'Entry logged.', 'success'); await _loadWeek() }
    })
  }

  /* ── Reusable combobox binder ────────────────────────────── */
  function _bindCombobox({ searchId, dropdownId, listId, wrapId, hiddenId, items, getLabel, getCode, getId, onSelect }) {
    const searchEl   = document.getElementById(searchId)
    const dropdownEl = document.getElementById(dropdownId)
    const listEl     = document.getElementById(listId)
    const hiddenEl   = document.getElementById(hiddenId)
    if (!searchEl || !dropdownEl || !listEl || !hiddenEl) return

    function renderList(subset) {
      listEl.innerHTML = subset.length
        ? subset.map(item => `
            <div class="custom-select-item"
                 data-id="${getId(item)}"
                 data-name="${Utils.escapeHtml(getLabel(item))}"
                 data-code="${Utils.escapeHtml(getCode(item))}">
              <span>${Utils.escapeHtml(getLabel(item))}</span>
              <span class="text-muted text-sm">${Utils.escapeHtml(getCode(item))}</span>
            </div>`).join('')
        : '<div class="custom-select-empty">No results found</div>'

      listEl.querySelectorAll('.custom-select-item').forEach(el => {
        el.addEventListener('mousedown', ev => {
          ev.preventDefault()
          hiddenEl.value         = el.dataset.id
          searchEl.value         = `${el.dataset.code} — ${el.dataset.name}`
          dropdownEl.style.display = 'none'
          if (onSelect) onSelect(el.dataset.id)
        })
      })
    }

    searchEl.addEventListener('focus', () => { renderList(items); dropdownEl.style.display = 'block' })
    searchEl.addEventListener('input', () => {
      const q = searchEl.value.trim().toLowerCase()
      hiddenEl.value = ''
      renderList(q ? items.filter(i => getLabel(i).toLowerCase().includes(q) || getCode(i).toLowerCase().includes(q)) : items)
      dropdownEl.style.display = 'block'
    })
    searchEl.addEventListener('blur', () => setTimeout(() => { dropdownEl.style.display = 'none' }, 150))

    document.addEventListener('click', function _close(e) {
      if (!document.getElementById(wrapId)?.contains(e.target)) {
        dropdownEl.style.display = 'none'
        document.removeEventListener('click', _close)
      }
    })
  }

  async function _deleteEntry(id) {
    if (!confirm('Delete this entry?')) return
    const { error } = await Config.supabase
      .from('timesheets')
      .delete()
      .eq('id', id)
      .eq('employee_id', _user.id)
      .in('status', ['draft', 'rejected'])

    if (error) {
      Utils.showToast('Failed to delete entry.', 'error')
    } else {
      _entries = _entries.filter(e => e.id !== id)
      _renderWeek()
    }
  }

  /* ══════════════════════════════════════════════════════════
     MISSED DAYS — helpers + rendering
  ══════════════════════════════════════════════════════════ */

  function _isHoliday(isoDate) {
    return _holidays.includes(isoDate)
  }

  // Returns array of YYYY-MM-DD strings that are missed/locked for the given month
  function _getMissedDays(year, month, entries, leaves) {
    const today   = new Date()
    const cutoff  = new Date(today)
    cutoff.setDate(cutoff.getDate() - _editLockDays())
    cutoff.setHours(23, 59, 59, 999)

    const daysInMonth = new Date(year, month, 0).getDate()
    const entryDates  = new Set((entries || []).filter(e => e.status === 'submitted' || e.status === 'approved').map(e => e.date))
    const missed      = []

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month - 1, d)
      if (date > cutoff) continue               // still within editable window
      if (date.getDay() === 0) continue          // Sunday
      const iso = _toISO(date)                  // use local time (not UTC) to match stored entry dates
      if (_isHoliday(iso)) continue              // company holiday
      if (_isFullLeaveDay(iso, leaves)) continue // approved full-day leave
      if (!entryDates.has(iso)) missed.push(iso)
    }
    return missed
  }

  function _renderMissedSection(missed, navMonth, onPrev, onNext, compact = false) {
    const monthLabel = navMonth.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    const year       = navMonth.getFullYear()
    const month      = navMonth.getMonth() + 1
    const daysInMonth = new Date(year, month, 0).getDate()
    const missedSet  = new Set(missed)

    // Build mini calendar
    const firstDay  = new Date(year, month - 1, 1).getDay() // 0=Sun
    // Shift so Mon=0 … Sun=6
    const startOffset = firstDay === 0 ? 6 : firstDay - 1

    const dayHeaders = ['M','T','W','T','F','S','S'].map(d =>
      `<div class="ts-missed-cal-hdr">${d}</div>`
    ).join('')

    let cells = ''
    for (let i = 0; i < startOffset; i++) cells += `<div></div>`
    for (let d = 1; d <= daysInMonth; d++) {
      const iso    = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`
      const date   = new Date(year, month - 1, d)
      const isSun  = date.getDay() === 0
      const isHol  = _isHoliday(iso)
      const isMiss = missedSet.has(iso)
      const cls    = isMiss ? 'ts-missed-cal-day--missed'
                   : (isSun || isHol) ? 'ts-missed-cal-day--off'
                   : 'ts-missed-cal-day--ok'
      cells += `<div class="ts-missed-cal-day ${cls}" title="${iso}">${d}</div>`
    }

    return `
      <div class="ts-missed-section${compact ? ' ts-missed-section--compact' : ''}">
        <div class="ts-missed-header">
          <div class="ts-missed-kpi-value${missed.length > 0 ? ' ts-missed-kpi-value--alert' : ''}">${missed.length}</div>
          <div class="ts-missed-nav">
            <button class="btn btn--ghost btn--xs ts-missed-prev">&lsaquo;</button>
            <span class="ts-missed-month-label">${monthLabel}</span>
            <button class="btn btn--ghost btn--xs ts-missed-next">&rsaquo;</button>
          </div>
        </div>
        <div class="ts-missed-kpi-label">Missed Timesheet Day${missed.length !== 1 ? 's' : ''}</div>
        <div class="ts-missed-calendar">
          <div class="ts-missed-cal-grid">
            ${dayHeaders}
            ${cells}
          </div>
          ${missed.length > 0
            ? `<div class="ts-missed-legend"><span class="ts-missed-dot ts-missed-dot--missed"></span> Missed &nbsp; <span class="ts-missed-dot ts-missed-dot--off"></span> Off / Holiday</div>`
            : `<div class="ts-missed-legend" style="color:var(--success);">No missed days this month</div>`
          }
        </div>
      </div>
    `
  }

  /* ══════════════════════════════════════════════════════════
     TEAM'S TIMESHEET TAB — two-panel layout
  ══════════════════════════════════════════════════════════ */
  async function _loadTeamTab() {
    // Reset drill-down state each time the tab loads fresh
    _teamView       = 'list'
    _teamSelEmpObj  = null
    _teamPersonTab  = 'week'
    _teamPersonWeek = _getMondayOf(new Date())

    _updateTeamToolbar()

    // Scaffold the two-panel layout
    const content = document.getElementById('ts-content')
    if (content) {
      content.innerHTML = `
        <div class="ts-team-layout">
          <div class="ts-team-sidebar" id="ts-team-sidebar-panel"></div>
          <div class="ts-team-main" id="ts-team-main-panel">
            <p class="loading-text">Loading…</p>
          </div>
        </div>
      `
    }

    await _fetchTeamWeek()
  }

  /* Update toolbar: week nav in list mode, person week nav in person mode */
  function _updateTeamToolbar() {
    const toolbar = document.getElementById('ts-toolbar-actions')
    if (!toolbar) return

    if (_teamView === 'list') {
      toolbar.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;">
          <button class="btn btn--ghost btn--sm" id="ts-team-prev">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span id="ts-team-week-label" style="font-size:13px;font-weight:600;min-width:180px;text-align:center;">${_weekLabel(_teamWeek)}</span>
          <button class="btn btn--ghost btn--sm" id="ts-team-next">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      `
      document.getElementById('ts-team-prev')?.addEventListener('click', () => {
        _teamWeek.setDate(_teamWeek.getDate() - 7); _fetchTeamWeek()
      })
      document.getElementById('ts-team-next')?.addEventListener('click', () => {
        _teamWeek.setDate(_teamWeek.getDate() + 7); _fetchTeamWeek()
      })
    } else {
      // Person mode: toolbar is empty; week nav is inside the person view header
      toolbar.innerHTML = ''
    }
  }

  async function _fetchTeamWeek() {
    const label = document.getElementById('ts-team-week-label')
    if (label) label.textContent = _weekLabel(_teamWeek)

    const mainPanel = document.getElementById('ts-team-main-panel')
    if (mainPanel) mainPanel.innerHTML = '<p class="loading-text">Loading team submissions…</p>'

    const from = _toISO(_teamWeek)
    const to   = _toISO(_weekEnd(_teamWeek))

    const reporteeIds = _directReports.map(e => e.id)
    // Always fetch ALL statuses (including drafts) for the team view — managers need
    // visibility into who has/hasn't logged time, not just who has submitted.
    // Approval actions gate on 'submitted' status independently.
    const { data, error } = await API.getTeamTimesheetEntries(from, to, _teamEmpId || null, reporteeIds.length ? reporteeIds : null, _user.id, true)
    if (error) { Utils.showToast('Failed to load team data.', 'error'); return }
    _teamEntries = data || []

    _renderTeamSidebar()
    _renderTeamAllView()
  }

  /* ── Sidebar ─────────────────────────────────────────────── */
  function _renderTeamSidebar() {
    const sidebar = document.getElementById('ts-team-sidebar-panel')
    if (!sidebar) return

    // Build per-employee summaries for the sidebar from _teamEntries
    const empMap = {}
    _teamEntries.forEach(e => {
      const empId = e.employee_id
      if (!empMap[empId]) empMap[empId] = { emp: e.employees, hours: 0, pending: 0 }
      empMap[empId].hours   += parseFloat(e.hours || 0)
      if (e.status === 'submitted') empMap[empId].pending++
    })

    // Also include direct reports with no entries this week (so we can drill in)
    _directReports.forEach(dr => {
      if (!empMap[dr.id]) empMap[dr.id] = { emp: dr, hours: 0, pending: 0 }
    })

    const isAllActive = _teamView === 'list'

    const empCards = Object.values(empMap).map(({ emp, hours, pending }) => {
      const name    = emp?.name || 'Unknown'
      const dept    = emp?.department ? emp.department.replace(/_/g, ' ') : ''
      const imgUrl  = emp?.profile_image_url || null
      const empId   = emp?.id || ''
      const isActive = _teamView === 'person' && _teamSelEmpObj?.id === empId

      return `
        <div class="ts-emp-card${isActive ? ' ts-emp-card--active' : ''}" data-emp-id="${empId}">
          <div class="ts-emp-card-avatar">
            ${imgUrl ? `<img src="${Utils.escapeHtml(imgUrl)}" alt="">` : Utils.getInitials(name)}
          </div>
          <div class="ts-emp-card-info">
            <div class="ts-emp-card-name">${Utils.escapeHtml(name)}</div>
            ${dept ? `<div class="ts-emp-card-dept">${Utils.escapeHtml(dept)}</div>` : ''}
          </div>
          <div class="ts-emp-card-meta">
            <span class="ts-emp-card-hours">${hours.toFixed(1)}h</span>
            ${pending ? `<span class="ts-emp-card-pending">${pending} pend.</span>` : ''}
          </div>
        </div>
      `
    }).join('')

    sidebar.innerHTML = `
      <div class="ts-sidebar-all${isAllActive ? ' ts-sidebar-all--active' : ''}" id="ts-sidebar-all-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
        All Submissions
      </div>
      <div class="ts-sidebar-divider">Team Members</div>
      ${empCards}
    `

    // Bind "All Submissions"
    sidebar.querySelector('#ts-sidebar-all-btn')?.addEventListener('click', () => {
      _teamView      = 'list'
      _teamSelEmpObj = null
      _updateTeamToolbar()
      _renderTeamSidebar()
      _renderTeamAllView()
    })

    // Bind employee cards
    sidebar.querySelectorAll('.ts-emp-card[data-emp-id]').forEach(card => {
      card.addEventListener('click', () => {
        const empId  = card.dataset.empId
        const empObj = _teamEntries.find(e => e.employee_id === empId)?.employees
                    || _directReports.find(e => e.id === empId)
        if (!empObj) return
        _teamView            = 'person'
        _teamSelEmpObj       = empObj
        _teamPersonTab       = 'week'
        _teamPersonWeek      = _getMondayOf(new Date())
        _insightsPersonMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
        _missedTeamMonth     = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
        _updateTeamToolbar()
        _renderTeamSidebar()
        _loadPersonWeek()
      })
    })
  }

  /* ── All Submissions view (existing accordion/table) ─────── */
  function _renderTeamAllView() {
    const mainPanel = document.getElementById('ts-team-main-panel')
    if (!mainPanel) return

    const empMap = {}
    _teamEntries.forEach(e => {
      const empId = e.employee_id
      if (!empMap[empId]) empMap[empId] = { emp: e.employees, entries: [] }
      empMap[empId].entries.push(e)
    })
    const groups = Object.values(empMap)

    const submitted = _teamEntries.filter(e => e.status === 'submitted').length
    const approved  = _teamEntries.filter(e => e.status === 'approved').length
    const rejected  = _teamEntries.filter(e => e.status === 'rejected').length
    const drafts    = _teamEntries.filter(e => e.status === 'draft').length
    const totalHrs  = _teamEntries.reduce((s, e) => s + parseFloat(e.hours || 0), 0)

    const statCards = _p.can_approve ? `
        <div class="stat-card">
          <div class="stat-label">Awaiting Review</div>
          <div class="stat-value stat-value--warning">${submitted}</div>
          <div class="stat-delta">need your action</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Approved</div>
          <div class="stat-value stat-value--positive">${approved}</div>
          <div class="stat-delta">confirmed</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Rejected</div>
          <div class="stat-value${rejected > 0 ? ' stat-value--negative' : ''}">${rejected}</div>
          <div class="stat-delta">sent back</div>
        </div>` : `
        <div class="stat-card">
          <div class="stat-label">Drafts</div>
          <div class="stat-value">${drafts}</div>
          <div class="stat-delta">in progress</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Submitted</div>
          <div class="stat-value stat-value--warning">${submitted}</div>
          <div class="stat-delta">awaiting approval</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Approved</div>
          <div class="stat-value stat-value--positive">${approved}</div>
          <div class="stat-delta">confirmed</div>
        </div>`

    mainPanel.innerHTML = `
      <div class="grid-4 mb-4">
        <div class="stat-card">
          <div class="stat-label">Total Hours</div>
          <div class="stat-value">${totalHrs.toFixed(1)}h</div>
          <div class="stat-delta">${_teamEntries.length} entr${_teamEntries.length === 1 ? 'y' : 'ies'}</div>
        </div>
        ${statCards}
      </div>

      ${!groups.length
        ? `<div class="section-card"><div class="section-card-body"><p class="empty-state">No submissions for this week.</p></div></div>`
        : groups.map(g => _renderTeamEmployeeGroup(g)).join('')
      }
    `

    mainPanel.querySelectorAll('.ts-approve-entry').forEach(btn =>
      btn.addEventListener('click', () => _openApproveModal(btn.dataset.id))
    )
    mainPanel.querySelectorAll('.ts-reject-entry').forEach(btn =>
      btn.addEventListener('click', () => _openRejectModal(btn.dataset.id))
    )
    mainPanel.querySelectorAll('.ts-acc-header').forEach(header => {
      header.addEventListener('click', () => {
        const bodyId  = header.dataset.target
        const body    = document.getElementById(bodyId)
        const chevron = header.querySelector('.ts-acc-chevron')
        if (!body) return
        const isOpen = body.style.display !== 'none'
        body.style.display  = isOpen ? 'none' : ''
        header.dataset.open = isOpen ? 'false' : 'true'
        if (chevron) chevron.style.transform = isOpen ? 'rotate(-90deg)' : 'rotate(0deg)'
      })
    })
  }

  /* ── Person drill-down: fetch + render person week ────────── */
  async function _loadPersonWeek() {
    const mainPanel = document.getElementById('ts-team-main-panel')
    if (!mainPanel) return
    mainPanel.innerHTML = '<p class="loading-text">Loading…</p>'

    const from = _toISO(_teamPersonWeek)
    const to   = _toISO(_weekEnd(_teamPersonWeek))
    const [{ data, error }, leaveData] = await Promise.all([
      API.getTimesheetEntries(_teamSelEmpObj.id, from, to),
      API.getApprovedLeaveForEmployee(_teamSelEmpObj.id),
    ])
    if (error) { Utils.showToast('Failed to load entries.', 'error'); return }
    _teamPersonEntries = data || []
    _teamPersonLeaves  = leaveData.leaves
    _teamPersonWfhs    = leaveData.wfhs
    _teamPersonClientVisits = leaveData.clientVisits || []
    _renderPersonView()
  }

  function _renderPersonView() {
    const mainPanel = document.getElementById('ts-team-main-panel')
    if (!mainPanel || !_teamSelEmpObj) return

    const emp     = _teamSelEmpObj
    const name    = emp.name || 'Unknown'
    const dept    = emp.department ? emp.department.replace(/_/g, ' ') : ''
    const imgUrl  = emp.profile_image_url || null

    mainPanel.innerHTML = `
      <div class="ts-person-header">
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="width:40px;height:40px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0;overflow:hidden;">
            ${imgUrl ? `<img src="${Utils.escapeHtml(imgUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;">` : Utils.getInitials(name)}
          </div>
          <div>
            <div style="font-weight:700;font-size:15px;">${Utils.escapeHtml(name)}</div>
            ${dept ? `<div style="font-size:12px;color:var(--text-muted);text-transform:capitalize;">${Utils.escapeHtml(dept)}</div>` : ''}
          </div>
        </div>
        <div class="ts-sub-tabs" id="ts-person-sub-tabs">
          <button class="ts-sub-tab-btn${_teamPersonTab==='week'?' ts-sub-tab-btn--active':''}" data-ptab="week">Week View</button>
          <button class="ts-sub-tab-btn${_teamPersonTab==='history'?' ts-sub-tab-btn--active':''}" data-ptab="history">History</button>
          <button class="ts-sub-tab-btn${_teamPersonTab==='monthly'?' ts-sub-tab-btn--active':''}" data-ptab="monthly">Monthly Summary</button>
          <button class="ts-sub-tab-btn${_teamPersonTab==='insights'?' ts-sub-tab-btn--active':''}" data-ptab="insights">Insights</button>
        </div>
      </div>
      <div id="ts-person-tab-body"></div>
    `

    mainPanel.querySelectorAll('.ts-sub-tab-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        mainPanel.querySelectorAll('.ts-sub-tab-btn').forEach(b => b.classList.remove('ts-sub-tab-btn--active'))
        btn.classList.add('ts-sub-tab-btn--active')
        _teamPersonTab = btn.dataset.ptab
        await _renderPersonTabBody()
      })
    })

    _renderPersonTabBody()
  }

  async function _renderPersonTabBody() {
    const body = document.getElementById('ts-person-tab-body')
    if (!body) return

    if (_teamPersonTab === 'week') {
      _renderPersonWeekView(body)
    } else if (_teamPersonTab === 'history') {
      body.innerHTML = '<p class="loading-text">Loading history…</p>'
      const from = _toISO((() => { const d = new Date(); d.setMonth(d.getMonth() - 3); return _getMondayOf(d) })())
      const to   = _toISO(new Date())
      const { data } = await API.getTimesheetEntries(_teamSelEmpObj.id, from, to)
      _renderPersonHistory(body, data || [])
    } else if (_teamPersonTab === 'monthly') {
      body.innerHTML = '<p class="loading-text">Loading summary…</p>'
      const from = _toISO((() => { const d = new Date(); d.setMonth(d.getMonth() - 6); return _getMondayOf(d) })())
      const to   = _toISO(new Date())
      if (!_missedTeamMonth) _missedTeamMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      const ty  = _missedTeamMonth.getFullYear()
      const tm  = _missedTeamMonth.getMonth() + 1
      const tmS = `${ty}-${String(tm).padStart(2,'0')}-01`
      const tmE = `${ty}-${String(tm).padStart(2,'0')}-${new Date(ty, tm, 0).getDate()}`
      const [{ data }, leaveData, { data: mEntries }] = await Promise.all([
        API.getTimesheetEntries(_teamSelEmpObj.id, from, to),
        API.getApprovedLeaveForEmployee(_teamSelEmpObj.id),
        API.getTimesheetEntries(_teamSelEmpObj.id, tmS, tmE),
      ])
      _renderPersonMonthly(body, data || [], leaveData?.leaves || [], mEntries || [])
    } else if (_teamPersonTab === 'insights') {
      await _loadPersonInsights()
    }
  }

  /* ── Person: Week View sub-tab ───────────────────────────── */
  function _renderPersonWeekView(container) {
    const days = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(_teamPersonWeek)
      d.setDate(d.getDate() + i)
      return d
    })

    const weekEntries = _teamPersonEntries

    container.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:16px;">
        <button class="btn btn--ghost btn--sm" id="ts-person-prev">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span style="font-size:13px;font-weight:600;min-width:180px;text-align:center;">${_weekLabel(_teamPersonWeek)}</span>
        <button class="btn btn--ghost btn--sm" id="ts-person-next">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
      <div class="ts-day-grid" style="flex:1;">
        ${days.map(d => _renderPersonDayCol(d, weekEntries)).join('')}
      </div>
    `

    container.querySelector('#ts-person-prev')?.addEventListener('click', async () => {
      _teamPersonWeek.setDate(_teamPersonWeek.getDate() - 7)
      await _loadPersonWeek()
    })
    container.querySelector('#ts-person-next')?.addEventListener('click', async () => {
      _teamPersonWeek.setDate(_teamPersonWeek.getDate() + 7)
      await _loadPersonWeek()
    })

    // Approve/Reject inline
    container.querySelectorAll('.ts-person-approve').forEach(btn =>
      btn.addEventListener('click', () => _openApproveModal(btn.dataset.id, true))
    )
    container.querySelectorAll('.ts-person-reject').forEach(btn =>
      btn.addEventListener('click', () => _openRejectModal(btn.dataset.id, true))
    )
  }

  function _renderPersonDayCol(day, weekEntries) {
    const iso        = _toISO(day)
    const today      = _toISO(new Date())
    const dayEntries = weekEntries.filter(e => e.date === iso)
    const isToday    = iso === today
    const dayHours   = dayEntries.reduce((s, e) => s + parseFloat(e.hours || 0), 0)
    const isSunday   = day.getDay() === 0
    const isHoliday  = _isHoliday(iso)

    if ((isSunday || isHoliday) && dayEntries.length === 0) {
      const label = isSunday ? 'Day Off' : 'Holiday'
      const color = isSunday ? 'var(--text-muted)' : '#059669'
      const bg    = isSunday ? 'var(--surface-2,#F9FAFB)' : '#F0FDF4'
      return `
        <div class="ts-col${isToday ? ' ts-col--today' : ''}${isSunday ? ' ts-col--off' : ' ts-col--holiday'}">
          <div class="ts-col-header">
            <div class="ts-col-top">
              <span class="ts-col-weekday">${day.toLocaleDateString('en-IN', { weekday:'short' }).toUpperCase()}</span>
              <span class="ts-col-status-icon"><span style="font-size:9px;font-weight:600;background:${bg};color:${color};border-radius:99px;padding:1px 6px;white-space:nowrap;">${label}</span></span>
            </div>
            <span class="ts-col-date${isToday ? ' ts-col-date--today' : ''}">${day.getDate()}</span>
          </div>
          <div class="ts-col-body" style="align-items:center;justify-content:center;flex:1;">
            <div style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:20px 8px;text-align:center;">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              <span style="font-size:11px;font-weight:600;color:${color};">${label}</span>
            </div>
          </div>
          <div class="ts-col-footer"><div class="ts-day-action" style="background:${bg};color:${color};border:none;cursor:default;">${label}</div></div>
        </div>
      `
    }

    // Leave / WFH status for this team member on this day.
    // Half-day leaves are treated as normal working days (employee logs the
    // worked half) — only full-day leave is marked here.
    const isFullLeaveDay = _isFullLeaveDay(iso, _teamPersonLeaves)
    const isWfhDay       = !isFullLeaveDay && _isWfhDay(iso, _teamPersonWfhs)
    const leaveName      = isFullLeaveDay ? _getLeaveName(iso, _teamPersonLeaves) : null
    const halfLeaveDay   = !isFullLeaveDay && _isHalfLeaveDay(iso, _teamPersonLeaves)
    const halfLeavePeriod = halfLeaveDay ? _getHalfDayPeriod(iso, _teamPersonLeaves) : null
    const cvDay          = _clientVisitForDay(iso, _teamPersonClientVisits)
    const cvHalf         = cvDay && cvDay.duration_type !== 'full_day'

    const drafts    = dayEntries.filter(e => e.status === 'draft').length
    const submitted = dayEntries.filter(e => e.status === 'submitted').length
    const approved  = dayEntries.filter(e => e.status === 'approved').length
    const rejected  = dayEntries.filter(e => e.status === 'rejected').length

    let headerIcon = ''
    if (dayEntries.length && approved === dayEntries.length) {
      headerIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1D9E75" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`
    } else if (submitted > 0 && drafts === 0 && rejected === 0) {
      headerIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`
    } else if (rejected > 0) {
      headerIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`
    }

    return `
      <div class="ts-col${isToday ? ' ts-col--today' : ''}${isFullLeaveDay ? ' ts-col--leave' : ''}">
        <div class="ts-col-header">
          <div class="ts-col-top">
            <span class="ts-col-weekday">${day.toLocaleDateString('en-IN', { weekday:'short' }).toUpperCase()}</span>
            <span class="ts-col-status-icon">${headerIcon}${halfLeaveDay ? `<span style="font-size:9px;font-weight:600;background:#EEF2FF;color:#6366F1;border-radius:99px;padding:1px 6px;margin-left:2px;white-space:nowrap;" title="Half-day leave${halfLeavePeriod ? ' — ' + halfLeavePeriod : ''}">½ Leave</span>` : ''}${isWfhDay ? `<span style="font-size:9px;font-weight:600;background:#ECFDF5;color:#059669;border-radius:99px;padding:1px 6px;margin-left:2px;white-space:nowrap;">WFH</span>` : ''}${cvDay ? `<span style="font-size:9px;font-weight:600;background:#E0F2FE;color:#0369A1;border-radius:99px;padding:1px 6px;margin-left:2px;white-space:nowrap;">Visit</span>` : ''}</span>
          </div>
          <span class="ts-col-date${isToday ? ' ts-col-date--today' : ''}">${day.getDate()}</span>
          ${dayHours > 0 ? `<span class="ts-col-hours">${dayHours.toFixed(1)}h</span>` : ''}
        </div>
        <div class="ts-col-body">
          ${isFullLeaveDay && dayEntries.length === 0 ? `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:20px 8px;text-align:center;flex:1;">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6366F1" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              <span style="font-size:11px;font-weight:600;color:#6366F1;">On Leave</span>
              ${leaveName ? `<span style="font-size:10px;color:var(--text-muted);">${Utils.escapeHtml(leaveName)}</span>` : ''}
            </div>
          ` : ''}
          ${cvHalf ? _cvContextBanner(cvDay) : ''}
          ${!isFullLeaveDay || dayEntries.length > 0 ? dayEntries.map(e => _renderPersonCard(e)).join('') : ''}
        </div>
        ${isFullLeaveDay && dayEntries.length === 0 ? `<div class="ts-col-footer"><div class="ts-day-action" style="background:#EEF2FF;color:#6366F1;border:none;cursor:default;">On Leave</div></div>` : ''}
      </div>
    `
  }

  function _renderPersonCard(e) {
    const isInternal = e.work_type === 'internal'
    const projName   = isInternal ? (e.internal_project?.name || 'Internal') : (e.clients?.client_name || null)
    const projCode   = isInternal ? (e.internal_project?.project_code || null) : (e.clients?.project_code || null)
    const entityName = isInternal ? (e.internal_entity?.entity_name || null) : (e.entity?.entity_name || null)
    const desc       = e.work_description || e.task_description || ''
    const lateIcon   = e.is_late ? `<span title="Logged late" style="color:#F59E0B;font-size:11px;">🕐</span>` : ''

    const approveRejectBar = e.status === 'submitted' && _canApproveEmployee(e.employee_id) ? `
      <div class="ts-card-approve-bar">
        <button class="btn btn--xs btn--secondary ts-person-approve" data-id="${e.id}">Approve</button>
        <button class="btn btn--xs btn--danger ts-person-reject" data-id="${e.id}">Reject</button>
      </div>
    ` : ''

    return `
      <div class="ts-card ts-card--${e.status}">
        <div class="ts-card-client">
          ${isInternal ? `<span class="ts-card-type-badge ts-card-type-badge--internal">Internal</span>` : ''}
          ${e.source_client_visit_id ? `<span class="ts-card-type-badge" style="background:#E0F2FE;color:#0369A1;">Client Visit</span>` : ''}
          <span class="ts-card-client-name">${Utils.escapeHtml(projName || '—')}</span>
          ${projCode ? `<span class="ts-card-code">${Utils.escapeHtml(projCode)}</span>` : ''}
          ${lateIcon}
        </div>
        ${entityName ? `<div class="ts-card-entity">${Utils.escapeHtml(entityName)}</div>` : ''}
        ${desc ? `<div class="ts-card-desc" style="white-space:pre-wrap;word-break:break-word;">${Utils.escapeHtml(desc)}</div>` : ''}
        <div class="ts-card-footer">
          <span class="ts-card-hours">${parseFloat(e.hours).toFixed(1)}h</span>
          <span class="badge ${STATUS[e.status]?.cls || 'badge--muted'}">${STATUS[e.status]?.label || e.status}</span>
        </div>
        ${e.rejection_comment ? `
          <div class="ts-card-rejection">
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            ${Utils.escapeHtml(e.rejection_comment)}
          </div>
        ` : ''}
        ${e.approval_comment ? `
          <div class="ts-card-rejection" style="background:var(--success-light,#D1FAE5);color:#065F46;border-color:#6EE7B7;">
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            ${Utils.escapeHtml(e.approval_comment)}
          </div>
        ` : ''}
        ${approveRejectBar}
      </div>
    `
  }

  /* ── Person: History sub-tab ─────────────────────────────── */
  function _renderPersonHistory(container, entries) {
    if (!entries.length) {
      container.innerHTML = `<p class="empty-state">No entries in the last 3 months.</p>`
      return
    }

    // Group by ISO week start (Monday)
    const weekMap = {}
    entries.forEach(e => {
      const ws = _toISO(_getMondayOf(new Date(e.date)))
      if (!weekMap[ws]) weekMap[ws] = []
      weekMap[ws].push(e)
    })

    const weeks = Object.keys(weekMap).sort((a, b) => b.localeCompare(a))

    const rowsHtml = weeks.map(ws => {
      const we      = weekMap[ws]
      const wsDate  = new Date(ws + 'T00:00:00')
      const label   = _weekLabel(wsDate)
      const total   = we.reduce((s, e) => s + parseFloat(e.hours || 0), 0)
      const aCount  = we.filter(e => e.status === 'approved').length
      const pCount  = we.filter(e => e.status === 'submitted').length
      const rCount  = we.filter(e => e.status === 'rejected').length
      const dCount  = we.filter(e => e.status === 'draft').length

      const badges = [
        aCount ? `<span class="badge badge--success" style="font-size:10px;">${aCount} approved</span>` : '',
        pCount ? `<span class="badge badge--warning" style="font-size:10px;">${pCount} pending</span>`  : '',
        rCount ? `<span class="badge badge--danger"  style="font-size:10px;">${rCount} rejected</span>` : '',
        dCount ? `<span class="badge badge--muted"   style="font-size:10px;">${dCount} draft</span>`    : '',
      ].filter(Boolean).join('')

      return `
        <div class="ts-history-week-row">
          <div class="ts-history-week-label">${label}</div>
          <div class="ts-history-week-hours">${total.toFixed(1)}h</div>
          <div class="ts-history-badges">${badges}</div>
        </div>
      `
    }).join('')

    container.innerHTML = `
      <div class="section-card">
        <div class="section-card-body" style="padding:0 18px;">
          ${rowsHtml}
        </div>
      </div>
    `
  }

  /* ── Person: Monthly Summary sub-tab ─────────────────────── */
  function _renderPersonMonthly(container, entries, leaves = [], mEntries = []) {
    if (!entries.length) {
      container.innerHTML = `<p class="empty-state">No entries in the last 6 months.</p>`
    }

    // Group by YYYY-MM
    const monthMap = {}
    entries.forEach(e => {
      const ym = e.date.slice(0, 7)
      if (!monthMap[ym]) monthMap[ym] = []
      monthMap[ym].push(e)
    })

    const months = Object.keys(monthMap).sort((a, b) => b.localeCompare(a))

    const cardsHtml = months.map(ym => {
      const me      = monthMap[ym]
      const total   = me.reduce((s, e) => s + parseFloat(e.hours || 0), 0)
      const approved = me.filter(e => e.status === 'approved').reduce((s, e) => s + parseFloat(e.hours || 0), 0)
      const [y, m]  = ym.split('-')
      const monthName = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-IN', { month:'long', year:'numeric' })

      // Breakdown by project/client
      const projMap = {}
      me.forEach(e => {
        const key = e.work_type === 'internal'
          ? (e.internal_project?.name || 'Internal')
          : (e.clients?.client_name || 'Internal')
        projMap[key] = (projMap[key] || 0) + parseFloat(e.hours || 0)
      })

      const pills = Object.entries(projMap).map(([proj, hrs]) =>
        `<span class="ts-month-proj-pill">${Utils.escapeHtml(proj)}: ${hrs.toFixed(1)}h</span>`
      ).join('')

      return `
        <div class="ts-month-card">
          <div class="ts-month-card-header">
            <div>
              <div class="ts-month-name">${monthName}</div>
              <div class="ts-month-approved">${approved.toFixed(1)}h approved</div>
            </div>
            <div class="ts-month-total">${total.toFixed(1)}h</div>
          </div>
          <div class="ts-month-breakdown">${pills}</div>
        </div>
      `
    }).join('')

    // Missed days section
    if (!_missedTeamMonth) _missedTeamMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    const ty = _missedTeamMonth.getFullYear()
    const tm = _missedTeamMonth.getMonth() + 1
    const missed = _getMissedDays(ty, tm, mEntries, leaves)

    container.innerHTML = `<div id="ts-team-missed-wrap" style="margin-bottom:20px;">${_renderMissedSection(missed, _missedTeamMonth, null, null, true)}</div>` + (entries.length ? cardsHtml : '')

    container.querySelector('.ts-missed-prev')?.addEventListener('click', async () => {
      _missedTeamMonth = new Date(_missedTeamMonth.getFullYear(), _missedTeamMonth.getMonth() - 1, 1)
      const { data: e2 } = await API.getTimesheetEntries(_teamSelEmpObj.id,
        `${_missedTeamMonth.getFullYear()}-${String(_missedTeamMonth.getMonth()+1).padStart(2,'0')}-01`,
        `${_missedTeamMonth.getFullYear()}-${String(_missedTeamMonth.getMonth()+1).padStart(2,'0')}-${new Date(_missedTeamMonth.getFullYear(), _missedTeamMonth.getMonth()+1, 0).getDate()}`)
      const wrap = document.getElementById('ts-team-missed-wrap')
      if (wrap) { wrap.innerHTML = _renderMissedSection(_getMissedDays(_missedTeamMonth.getFullYear(), _missedTeamMonth.getMonth()+1, e2||[], leaves), _missedTeamMonth, null, null, true); _bindTeamMissedNav(leaves) }
    })
    container.querySelector('.ts-missed-next')?.addEventListener('click', async () => {
      const next = new Date(_missedTeamMonth.getFullYear(), _missedTeamMonth.getMonth() + 1, 1)
      if (next > new Date()) return
      _missedTeamMonth = next
      const { data: e2 } = await API.getTimesheetEntries(_teamSelEmpObj.id,
        `${_missedTeamMonth.getFullYear()}-${String(_missedTeamMonth.getMonth()+1).padStart(2,'0')}-01`,
        `${_missedTeamMonth.getFullYear()}-${String(_missedTeamMonth.getMonth()+1).padStart(2,'0')}-${new Date(_missedTeamMonth.getFullYear(), _missedTeamMonth.getMonth()+1, 0).getDate()}`)
      const wrap = document.getElementById('ts-team-missed-wrap')
      if (wrap) { wrap.innerHTML = _renderMissedSection(_getMissedDays(_missedTeamMonth.getFullYear(), _missedTeamMonth.getMonth()+1, e2||[], leaves), _missedTeamMonth, null, null, true); _bindTeamMissedNav(leaves) }
    })
  }

  function _bindTeamMissedNav(leaves) {
    const wrap = document.getElementById('ts-team-missed-wrap')
    if (!wrap) return
    wrap.querySelector('.ts-missed-prev')?.addEventListener('click', async () => {
      _missedTeamMonth = new Date(_missedTeamMonth.getFullYear(), _missedTeamMonth.getMonth() - 1, 1)
      const { data: e2 } = await API.getTimesheetEntries(_teamSelEmpObj.id,
        `${_missedTeamMonth.getFullYear()}-${String(_missedTeamMonth.getMonth()+1).padStart(2,'0')}-01`,
        `${_missedTeamMonth.getFullYear()}-${String(_missedTeamMonth.getMonth()+1).padStart(2,'0')}-${new Date(_missedTeamMonth.getFullYear(), _missedTeamMonth.getMonth()+1, 0).getDate()}`)
      wrap.innerHTML = _renderMissedSection(_getMissedDays(_missedTeamMonth.getFullYear(), _missedTeamMonth.getMonth()+1, e2||[], leaves), _missedTeamMonth, null, null, true)
      _bindTeamMissedNav(leaves)
    })
    wrap.querySelector('.ts-missed-next')?.addEventListener('click', async () => {
      const next = new Date(_missedTeamMonth.getFullYear(), _missedTeamMonth.getMonth() + 1, 1)
      if (next > new Date()) return
      _missedTeamMonth = next
      const { data: e2 } = await API.getTimesheetEntries(_teamSelEmpObj.id,
        `${_missedTeamMonth.getFullYear()}-${String(_missedTeamMonth.getMonth()+1).padStart(2,'0')}-01`,
        `${_missedTeamMonth.getFullYear()}-${String(_missedTeamMonth.getMonth()+1).padStart(2,'0')}-${new Date(_missedTeamMonth.getFullYear(), _missedTeamMonth.getMonth()+1, 0).getDate()}`)
      wrap.innerHTML = _renderMissedSection(_getMissedDays(_missedTeamMonth.getFullYear(), _missedTeamMonth.getMonth()+1, e2||[], leaves), _missedTeamMonth, null, null, true)
      _bindTeamMissedNav(leaves)
    })
  }

  async function _loadPersonInsights() {
    const body = document.getElementById('ts-person-tab-body')
    if (!body || !_teamSelEmpObj) return

    // Destroy existing chart
    if (_personInsightsChart) { try { _personInsightsChart.destroy() } catch(_){} _personInsightsChart = null }

    body.innerHTML = '<p class="loading-text">Loading insights…</p>'

    const emp    = _teamSelEmpObj
    const year   = _insightsPersonMonth.getFullYear()
    const month  = _insightsPersonMonth.getMonth()
    const mStart = new Date(year, month, 1)
    const mEnd   = new Date(year, month + 1, 0)
    const pStart = new Date(year, month - 1, 1)
    const pEnd   = new Date(year, month, 0)
    const mS     = _toISO(mStart)
    const mE     = _toISO(mEnd)
    const pS     = _toISO(pStart)
    const pE     = _toISO(pEnd)

    const monthLabel     = mStart.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    const isCurrentMonth = year === new Date().getFullYear() && month === new Date().getMonth()

    const [
      { data: entries },
      { data: prevEntries },
      leaveData,
      { data: teamEntries },
      deptRes,
    ] = await Promise.all([
      API.getTimesheetEntries(emp.id, mS, mE),
      API.getTimesheetEntries(emp.id, pS, pE),
      API.getApprovedLeaveForEmployee(emp.id),
      _directReports.length
        ? API.getTeamTimesheetEntries(mS, mE, null, _directReports.map(e => e.id), emp.id, true)
        : Promise.resolve({ data: [] }),
      emp.department ? API.getDeptUtilizationAvg(emp.department, mS, mE) : Promise.resolve({ data: null }),
    ])

    const allLeaves = leaveData?.leaves || []

    // ── Working days & leaves ───────────────────────────────────
    const weekdays    = _weekdaysInMonth(year, month)
    const leaveDays   = _leaveDaysInMonth(allLeaves, mS, mE)
    const workingDays = Math.max(0, weekdays - leaveDays.full - leaveDays.half)
    const leavesLabel = leaveDays.total === 0 ? '0' : `${leaveDays.total}`

    // ── Hours ───────────────────────────────────────────────────
    const E = entries || []
    const P = prevEntries || []
    const loggedHours   = E.reduce((s, e) => s + parseFloat(e.hours || 0), 0)
    const prevLogged    = P.reduce((s, e) => s + parseFloat(e.hours || 0), 0)
    const expectedHours = workingDays * 7.5
    const prevExpected  = _weekdaysInMonth(year, month - 1) * 7.5  // approx, no leaves for prev
    const utilPct       = expectedHours > 0 ? Math.round((loggedHours / expectedHours) * 100) : 0
    const prevUtil      = prevExpected > 0 ? Math.round((prevLogged / prevExpected) * 100) : 0
    const utilDelta     = utilPct - prevUtil
    const utilColor     = utilPct >= 85 ? '#1D9E75' : utilPct >= 70 ? '#F59E0B' : '#EF4444'

    // ── Time allocation ─────────────────────────────────────────
    const clientHours   = E.filter(e => e.work_type === 'client').reduce((s, e) => s + parseFloat(e.hours || 0), 0)
    const internalHours = E.filter(e => e.work_type !== 'client').reduce((s, e) => s + parseFloat(e.hours || 0), 0)

    // ── Top entities by effort ───────────────────────────────────
    const hasClientWork = clientHours > 0
    const breakdownMap  = {}
    E.forEach(e => {
      let key
      if (e.work_type === 'client') {
        // Group by client entity name; fall back to client name if entity not set
        key = e.entity?.entity_name || e.clients?.client_name || 'Unknown'
      } else {
        // Group by internal project entity; fall back to project name
        key = e.internal_entity?.entity_name || e.internal_project?.name || 'Internal'
      }
      breakdownMap[key] = (breakdownMap[key] || 0) + parseFloat(e.hours || 0)
    })
    const breakdownEntries = Object.entries(breakdownMap).sort((a, b) => b[1] - a[1]).slice(0, 6)
    const breakdownTotal   = breakdownEntries.reduce((s, [, h]) => s + h, 0)

    // ── Submission compliance ────────────────────────────────────
    const submitted  = E.filter(e => ['submitted','approved','rejected'].includes(e.status))
    const onTime     = submitted.filter(e => !e.is_late)
    const compliance = submitted.length ? Math.round((onTime.length / submitted.length) * 100) : null

    // ── Team average utilization ─────────────────────────────────
    const T = teamEntries || []
    const teamEmpMap = {}
    T.forEach(e => {
      if (!teamEmpMap[e.employee_id]) teamEmpMap[e.employee_id] = 0
      teamEmpMap[e.employee_id] += parseFloat(e.hours || 0)
    })
    _directReports.forEach(dr => { if (!teamEmpMap[dr.id]) teamEmpMap[dr.id] = 0 })
    const teamUtils = Object.values(teamEmpMap).map(h => expectedHours > 0 ? Math.min(Math.round((h / expectedHours) * 100), 150) : 0)
    const teamAvg   = teamUtils.length ? Math.round(teamUtils.reduce((s, u) => s + u, 0) / teamUtils.length) : null
    const deptAvg   = typeof deptRes?.data === 'number' ? Math.round(deptRes.data) : null

    // ── Attention flags ──────────────────────────────────────────
    const flags = []
    if (loggedHours === 0 && !isCurrentMonth) flags.push({ icon: '🔴', msg: 'No hours logged this month.' })
    else if (utilPct < 70 && expectedHours > 0) flags.push({ icon: '🟡', msg: `Underutilized — ${utilPct}% utilization (below 70% threshold).` })
    if (utilPct > 105 && expectedHours > 0) flags.push({ icon: '🟠', msg: `Overloaded — ${utilPct}% utilization exceeds capacity.` })
    if (utilDelta < -20 && prevUtil > 0) flags.push({ icon: '🟡', msg: `Utilization dropped ${Math.abs(utilDelta)} points vs last month.` })
    if (hasClientWork && breakdownEntries.length > 0 && (breakdownEntries[0][1] / clientHours) > 0.75)
      flags.push({ icon: '🔵', msg: `Single client (${breakdownEntries[0][0]}) consuming ${Math.round(breakdownEntries[0][1]/clientHours*100)}% of client hours.` })
    if (compliance !== null && compliance < 70 && submitted.length >= 5)
      flags.push({ icon: '🟡', msg: `Low submission compliance — ${compliance}% of entries submitted on time.` })

    // ── Render ───────────────────────────────────────────────────
    const flagsHtml = flags.length
      ? flags.map(f => `<div style="display:flex;align-items:flex-start;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;"><span>${f.icon}</span><span>${Utils.escapeHtml(f.msg)}</span></div>`).join('')
      : `<div style="display:flex;align-items:center;gap:8px;font-size:13px;color:#1D9E75;"><span>✓</span><span>No concerns this month.</span></div>`

    const breakdownBars = breakdownEntries.map(([name, hrs], i) => {
      const pct = breakdownTotal > 0 ? Math.round((hrs / breakdownTotal) * 100) : 0
      return `
        <div style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
            <span style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%;">${Utils.escapeHtml(name)}</span>
            <span style="color:var(--text-muted);flex-shrink:0;">${hrs.toFixed(1)}h &nbsp; ${pct}%</span>
          </div>
          <div style="height:6px;background:var(--surface);border-radius:99px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${CHART_COLORS[i % CHART_COLORS.length]};border-radius:99px;transition:width .4s;"></div>
          </div>
        </div>`
    }).join('')

    const benchBar = (label, pct, color, bold = false) => pct === null ? '' : `
      <div style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
          <span style="${bold ? 'font-weight:700;' : ''}color:var(--text);">${label}</span>
          <span style="${bold ? 'font-weight:700;' : ''}color:var(--text);">${pct}%</span>
        </div>
        <div style="height:6px;background:var(--surface);border-radius:99px;overflow:hidden;">
          <div style="height:100%;width:${Math.min(pct, 100)}%;background:${color};border-radius:99px;"></div>
        </div>
      </div>`

    const capacityGap  = loggedHours - expectedHours
    const gapColor     = capacityGap >= 0 ? '#EF4444' : '#1D9E75'
    const gapLabel     = capacityGap >= 0 ? `+${capacityGap.toFixed(1)}h over capacity` : `${Math.abs(capacityGap).toFixed(1)}h available capacity`

    body.innerHTML = `
      <div style="padding:20px;">

        <!-- Month selector -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
          <div>
            <div style="font-size:15px;font-weight:700;">Employee Overview</div>
            <div style="font-size:12px;color:var(--text-muted);">${monthLabel}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <button class="btn btn--ghost btn--sm" id="pi-prev">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span style="font-size:13px;font-weight:600;min-width:110px;text-align:center;">${monthLabel}</span>
            <button class="btn btn--ghost btn--sm" id="pi-next" ${isCurrentMonth ? 'disabled' : ''}>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        </div>

        <!-- KPI row -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr) 1.4fr;gap:12px;margin-bottom:20px;">
          <div class="section-card" style="padding:16px;">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:6px;">Working Days</div>
            <div style="font-size:26px;font-weight:800;color:var(--text);">${workingDays}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${weekdays} weekdays − ${leaveDays.total} leave</div>
          </div>
          <div class="section-card" style="padding:16px;">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:6px;">Leaves Taken</div>
            <div style="font-size:26px;font-weight:800;color:var(--text);">${leavesLabel}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">days approved</div>
          </div>
          <div class="section-card" style="padding:16px;">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:6px;">Expected Hours</div>
            <div style="font-size:26px;font-weight:800;color:var(--text);">${expectedHours}h</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${workingDays} days × 7.5h</div>
          </div>
          <div class="section-card" style="padding:16px;">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:6px;">Logged Hours</div>
            <div style="font-size:26px;font-weight:800;color:var(--text);">${loggedHours.toFixed(1)}h</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">recorded</div>
          </div>
          <div class="section-card" style="padding:16px;background:${utilColor};border-color:${utilColor};">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.75);margin-bottom:6px;">Utilization</div>
            <div style="font-size:32px;font-weight:800;color:#fff;">${utilPct}%</div>
            <div style="margin-top:4px;">${(() => {
              const d = utilDelta
              if (prevUtil === 0) return '<span style="font-size:11px;color:rgba(255,255,255,.75);">No prior data</span>'
              return `<span style="font-size:11px;color:rgba(255,255,255,.85);">${d > 0 ? '▲' : d < 0 ? '▼' : '='} ${Math.abs(d)}% vs last month</span>`
            })()}</div>
          </div>
        </div>

        <!-- Attention Required -->
        <div class="section-card" style="padding:16px;margin-bottom:20px;">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:10px;">Attention Required</div>
          ${flagsHtml}
        </div>

        <!-- Time Allocation + Top Clients/Projects -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
          <div class="section-card" style="padding:16px;">
            <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:4px;">Time Allocation</div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:14px;">How hours are distributed</div>
            ${loggedHours > 0 ? `
              <div style="display:flex;align-items:center;gap:20px;">
                <div style="position:relative;width:100px;height:100px;flex-shrink:0;">
                  <canvas id="pi-donut" width="100" height="100"></canvas>
                </div>
                <div style="flex:1;">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                    <div style="width:10px;height:10px;border-radius:50%;background:#0F4799;flex-shrink:0;"></div>
                    <div style="flex:1;font-size:12px;">Client Work</div>
                    <div style="font-size:12px;font-weight:600;">${loggedHours > 0 ? Math.round(clientHours/loggedHours*100) : 0}%</div>
                  </div>
                  <div style="display:flex;align-items:center;gap:8px;">
                    <div style="width:10px;height:10px;border-radius:50%;background:#1D9E75;flex-shrink:0;"></div>
                    <div style="flex:1;font-size:12px;">Internal Work</div>
                    <div style="font-size:12px;font-weight:600;">${loggedHours > 0 ? Math.round(internalHours/loggedHours*100) : 0}%</div>
                  </div>
                </div>
              </div>` : `<p style="font-size:13px;color:var(--text-muted);text-align:center;padding:20px 0;">No entries this month.</p>`}
          </div>
          <div class="section-card" style="padding:16px;">
            <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:4px;">Top Entities by Effort</div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:14px;">Hours logged per entity</div>
            ${breakdownEntries.length ? breakdownBars : `<p style="font-size:13px;color:var(--text-muted);text-align:center;padding:20px 0;">No data for this period.</p>`}
          </div>
        </div>

        <!-- Team Context -->
        <div class="section-card" style="padding:16px;">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:4px;">Team Context</div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:14px;">Utilization comparison</div>
          <div style="max-width:480px;">
            ${benchBar(Utils.escapeHtml(emp.name || 'Employee'), utilPct, utilColor, true)}
            ${teamAvg !== null ? benchBar('Team Avg', teamAvg, '#94A3B8') : ''}
            ${deptAvg !== null ? benchBar('Dept Avg', deptAvg, '#CBD5E1') : ''}
            ${teamAvg === null && deptAvg === null ? '<p style="font-size:13px;color:var(--text-muted);">No benchmark data available.</p>' : ''}
          </div>
        </div>

      </div>
    `

    // Render donut chart
    if (loggedHours > 0) {
      const ctx = document.getElementById('pi-donut')
      if (ctx) {
        _personInsightsChart = new Chart(ctx, {
          type: 'doughnut',
          data: {
            labels: ['Client Work', 'Internal Work'],
            datasets: [{ data: [clientHours, internalHours], backgroundColor: ['#0F4799', '#1D9E75'], borderWidth: 2, borderColor: '#fff' }]
          },
          options: { responsive: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.toFixed(1)}h` } } }, cutout: '65%' }
        })
      }
    }

    // Month navigation
    document.getElementById('pi-prev')?.addEventListener('click', () => {
      _insightsPersonMonth = new Date(_insightsPersonMonth.getFullYear(), _insightsPersonMonth.getMonth() - 1, 1)
      _loadPersonInsights()
    })
    document.getElementById('pi-next')?.addEventListener('click', () => {
      const now = new Date()
      const nextMonth = new Date(_insightsPersonMonth.getFullYear(), _insightsPersonMonth.getMonth() + 1, 1)
      if (nextMonth <= new Date(now.getFullYear(), now.getMonth(), 1)) {
        _insightsPersonMonth = nextMonth
        _loadPersonInsights()
      }
    })
  }

  function _renderTeamEmployeeGroup({ emp, entries }) {
    const empId  = emp?.id || Math.random().toString(36).slice(2)
    const name   = emp?.name || 'Unknown'
    const dept   = emp?.department ? emp.department.replace(/_/g, ' ') : ''
    const total  = entries.reduce((s, e) => s + parseFloat(e.hours || 0), 0)
    const imgUrl = emp?.profile_image_url || null

    const pending   = entries.filter(e => e.status === 'submitted').length
    const approved  = entries.filter(e => e.status === 'approved').length
    const rejected  = entries.filter(e => e.status === 'rejected').length
    const bodyId    = `ts-emp-body-${empId}`

    const summaryBadges = [
      `<span style="font-weight:700;font-size:13px;color:var(--primary);">${total.toFixed(1)}h</span>`,
      pending  ? `<span class="badge badge--warning" style="font-size:11px;">${pending} pending</span>`   : '',
      approved ? `<span class="badge badge--success" style="font-size:11px;">${approved} approved</span>` : '',
      rejected ? `<span class="badge badge--danger"  style="font-size:11px;">${rejected} rejected</span>` : '',
    ].filter(Boolean).join('')

    const rows = entries.map(e => {
      const desc       = e.work_description || e.task_description || '—'
      const isInternal = e.work_type === 'internal'
      const projName   = isInternal ? (e.internal_project?.name || '—') : (e.clients?.client_name || '—')
      const projCode   = isInternal ? (e.internal_project?.project_code || '') : (e.clients?.project_code || '')
      const areaName   = isInternal ? (e.internal_entity?.entity_name || '') : (e.entity?.entity_name || '')
      const lateFlag   = e.is_late ? `<span title="Logged late" style="margin-left:4px;font-size:11px;">🕐</span>` : ''

      return `
        <tr style="vertical-align:top;">
          <td style="white-space:nowrap;font-size:12px;color:var(--text-muted);padding-top:14px;">${Utils.formatDate(e.date)}</td>
          <td style="padding-top:14px;">
            ${isInternal
              ? `<span class="ts-card-type-badge ts-card-type-badge--internal" style="margin-right:4px;">Internal</span>`
              : `<span class="ts-card-type-badge ts-card-type-badge--client" style="margin-right:4px;">Client</span>`
            }
            <span style="font-weight:500;">${Utils.escapeHtml(projName)}</span>
            ${projCode ? `<span class="badge-code" style="margin-left:4px;">${Utils.escapeHtml(projCode)}</span>` : ''}
            ${lateFlag}
            ${areaName ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${Utils.escapeHtml(areaName)}</div>` : ''}
          </td>
          <td style="padding-top:14px;">
            <div style="font-size:12px;white-space:pre-wrap;word-break:break-word;line-height:1.6;">${Utils.escapeHtml(desc)}</div>
          </td>
          <td style="text-align:right;font-weight:700;white-space:nowrap;padding-top:14px;">${parseFloat(e.hours).toFixed(1)}h</td>
          <td style="padding-top:14px;">
            ${_statusBadge(e.status)}
            ${e.submitted_at ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Submitted ${Utils.formatDateTime(e.submitted_at)}</div>` : ''}
            ${e.acted_at && e.approver?.name ? `<div style="font-size:11px;color:var(--text-muted);">${e.status === 'approved' ? 'Approved' : 'Rejected'} by ${Utils.escapeHtml(e.approver.name)} · ${Utils.formatDateTime(e.acted_at)}</div>` : ''}
          </td>
          <td style="white-space:nowrap;padding-top:14px;">
            ${e.status === 'submitted' && _canApproveEmployee(e.employee_id) ? `
              <button class="btn btn--xs btn--secondary ts-approve-entry" data-id="${e.id}" style="margin-right:4px;">Approve</button>
              <button class="btn btn--xs btn--danger ts-reject-entry"  data-id="${e.id}">Reject</button>
            ` : e.status === 'rejected' && e.rejection_comment ? `
              <span style="font-size:11px;color:var(--text-muted);white-space:pre-wrap;word-break:break-word;display:block;">↳ ${Utils.escapeHtml(e.rejection_comment)}</span>
            ` : e.status === 'approved' && e.approval_comment ? `
              <span style="font-size:11px;color:#065F46;white-space:pre-wrap;word-break:break-word;display:block;">✓ ${Utils.escapeHtml(e.approval_comment)}</span>
            ` : ''}
          </td>
        </tr>
      `
    }).join('')

    return `
      <div class="section-card mb-3">
        <div class="section-card-header ts-acc-header"
             data-target="${bodyId}"
             data-open="true"
             style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:34px;height:34px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0;overflow:hidden;">${imgUrl ? `<img src="${Utils.escapeHtml(imgUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;">` : Utils.getInitials(name)}</div>
            <div>
              <div style="font-weight:600;font-size:14px;">${Utils.escapeHtml(name)}</div>
              ${dept ? `<div style="font-size:11px;color:var(--text-muted);text-transform:capitalize;">${Utils.escapeHtml(dept)}</div>` : ''}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="display:flex;align-items:center;gap:6px;">${summaryBadges}</div>
            <svg class="ts-acc-chevron" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text-muted);transition:transform 0.2s ease;flex-shrink:0;"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
        </div>
        <div class="section-card-body" id="${bodyId}" style="padding:0;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Project</th>
                <th>Description</th>
                <th style="text-align:right;">Hours</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `
  }

  /* ══════════════════════════════════════════════════════════
     INSIGHTS TAB
  ══════════════════════════════════════════════════════════ */
  async function _loadInsightsTab() {
    const content = document.getElementById('ts-content')
    if (content) content.innerHTML = '<p class="loading-text">Loading insights…</p>'

    // Date ranges
    const now           = new Date()
    const monthStart    = new Date(now.getFullYear(), now.getMonth(), 1)
    const lastMonthS    = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const lastMonthE    = new Date(now.getFullYear(), now.getMonth(), 0)
    const eightWeeksAgo = _getMondayOf((() => { const d = new Date(); d.setDate(d.getDate() - 49); return d })())
    const sixMonthsAgo  = new Date(now.getFullYear(), now.getMonth() - 5, 1)

    // Personal data fetches
    const personalFetches = [
      API.getTimesheetEntries(_user.id, _toISO(eightWeeksAgo), _toISO(now)),
      API.getTimesheetEntries(_user.id, _toISO(monthStart), _toISO(now)),
      API.getTimesheetEntries(_user.id, _toISO(lastMonthS), _toISO(lastMonthE)),
      API.getTimesheetEntries(_user.id, _toISO(sixMonthsAgo), _toISO(now)),
    ]
    const teamFetch = (_p.can_approve || _isManager) && _directReports.length
      ? API.getTeamTimesheetEntries(_toISO(sixMonthsAgo), _toISO(now), null, _directReports.map(e => e.id), _user.id, true)
      : Promise.resolve({ data: [] })

    const [{ data: weekData }, { data: monthData }, { data: lastMonthData }, { data: sixMonthData }, { data: teamInsightData }] = await Promise.all([...personalFetches, teamFetch])

    const allPersonal   = weekData     || []
    const thisMonth     = monthData    || []
    const lastMonth     = lastMonthData || []
    const sixMonthsData = sixMonthData || []

    // Helper: consistent project name from an entry
    const _getProjName = e => e.work_type === 'internal'
      ? (e.internal_project?.name || 'Internal')
      : (e.clients?.client_name   || 'Client')

    // ── Stat cards ────────────────────────────────────────────
    const thisMonthHrs = thisMonth.reduce((s, e) => s + parseFloat(e.hours || 0), 0)
    const lastMonthHrs = lastMonth.reduce((s, e) => s + parseFloat(e.hours || 0), 0)
    const submitted    = allPersonal.filter(e => ['submitted','approved','rejected'].includes(e.status))
    const approved     = allPersonal.filter(e => e.status === 'approved')
    const approvedRate = submitted.length ? Math.round((approved.length / submitted.length) * 100) : 0
    const onTime       = allPersonal.filter(e => !e.is_late && ['submitted','approved','rejected'].includes(e.status))
    const onTimeRate   = submitted.length ? Math.round((onTime.length / submitted.length) * 100) : 0

    // ── Weekly trend: last 8 weeks ────────────────────────────
    const weeks = []
    for (let i = 7; i >= 0; i--) {
      const ws = _getMondayOf((() => { const d = new Date(); d.setDate(d.getDate() - i * 7); return d })())
      const we = _weekEnd(ws)
      const entries = allPersonal.filter(e => e.date >= _toISO(ws) && e.date <= _toISO(we))
      weeks.push({
        label:    ws.toLocaleDateString('en-IN', { month:'short', day:'numeric' }),
        approved: entries.filter(e => e.status === 'approved').reduce((s, e) => s + parseFloat(e.hours || 0), 0),
        pending:  entries.filter(e => e.status === 'submitted').reduce((s, e) => s + parseFloat(e.hours || 0), 0),
        draft:    entries.filter(e => e.status === 'draft').reduce((s, e) => s + parseFloat(e.hours || 0), 0),
      })
    }

    // ── Donut: hours by project this month ────────────────────
    const projMap = {}
    thisMonth.forEach(e => {
      const key = _getProjName(e)
      projMap[key] = (projMap[key] || 0) + parseFloat(e.hours || 0)
    })

    // ── 6-month allocation: build month buckets ───────────────
    const months6 = []
    for (let i = 5; i >= 0; i--) {
      const s = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const e = new Date(now.getFullYear(), now.getMonth() - i + 1, 0)
      months6.push({
        label: s.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
        start: _toISO(s),
        end:   _toISO(e),
      })
    }

    // { monthLabel: { projName: hours } }
    const monthlyProjMap = {}
    months6.forEach(m => { monthlyProjMap[m.label] = {} })
    sixMonthsData.forEach(e => {
      const proj  = _getProjName(e)
      const month = months6.find(m => e.date >= m.start && e.date <= m.end)
      if (!month) return
      monthlyProjMap[month.label][proj] = (monthlyProjMap[month.label][proj] || 0) + parseFloat(e.hours || 0)
    })

    // Top 7 projects by 6-month total; remainder → "Other"
    const projTotals6 = {}
    sixMonthsData.forEach(e => {
      const p = _getProjName(e)
      projTotals6[p] = (projTotals6[p] || 0) + parseFloat(e.hours || 0)
    })
    let allProjs6 = Object.keys(projTotals6).sort((a, b) => projTotals6[b] - projTotals6[a])
    const MAX_PROJS = 7
    if (allProjs6.length > MAX_PROJS) {
      const keep = allProjs6.slice(0, MAX_PROJS)
      months6.forEach(m => {
        let other = 0
        Object.keys(monthlyProjMap[m.label]).forEach(p => {
          if (!keep.includes(p)) { other += monthlyProjMap[m.label][p]; delete monthlyProjMap[m.label][p] }
        })
        if (other > 0) monthlyProjMap[m.label]['Other'] = other
      })
      allProjs6 = [...keep, 'Other']
    }

    // Chart.js datasets for stacked bar
    const stackedDatasets = allProjs6.map((proj, i) => ({
      label:           proj,
      data:            months6.map(m => +(monthlyProjMap[m.label][proj] || 0).toFixed(1)),
      backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
      stack:           'a',
      borderRadius:    3,
    }))

    // ── Delta table: this month vs last month ─────────────────
    const lastMonthProjMap = {}
    lastMonth.forEach(e => {
      const key = _getProjName(e)
      lastMonthProjMap[key] = (lastMonthProjMap[key] || 0) + parseFloat(e.hours || 0)
    })

    const deltaProjects = [...new Set([...Object.keys(projMap), ...Object.keys(lastMonthProjMap)])]
      .sort((a, b) => (projMap[b] || 0) - (projMap[a] || 0))

    const lastMonthName = lastMonthS.toLocaleDateString('en-IN', { month: 'long' })
    const thisMonthName = monthStart.toLocaleDateString('en-IN', { month: 'long' })

    const deltaRows = deltaProjects.map(proj => {
      const cur  = projMap[proj]         || 0
      const prev = lastMonthProjMap[proj] || 0
      const diff = cur - prev
      let changeHtml
      if (prev === 0 && cur > 0) {
        changeHtml = `<span class="ts-delta-badge ts-delta-new">New</span>`
      } else if (cur === 0 && prev > 0) {
        changeHtml = `<span class="ts-delta-badge ts-delta-down">Dropped off</span>`
      } else {
        const pct   = prev > 0 ? Math.round((diff / prev) * 100) : 0
        const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '—'
        const cls   = diff > 0 ? 'ts-delta-up' : diff < 0 ? 'ts-delta-down' : 'ts-delta-flat'
        changeHtml  = `<span class="ts-delta-badge ${cls}">${arrow} ${Math.abs(pct)}%</span>`
      }
      const dotColor = CHART_COLORS[allProjs6.indexOf(proj) % CHART_COLORS.length] || '#94A3B8'
      return `
        <tr>
          <td>
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="ts-delta-dot" style="background:${dotColor};"></span>
              ${Utils.escapeHtml(proj)}
            </div>
          </td>
          <td><strong>${cur.toFixed(1)}h</strong></td>
          <td style="color:var(--text-muted);">${prev > 0 ? prev.toFixed(1) + 'h' : '—'}</td>
          <td>${changeHtml}</td>
        </tr>`
    }).join('')

    // ── Team section (managers) ───────────────────────────────
    let teamHtml = ''
    let teamBarData = null
    if ((_p.can_approve || _isManager) && _directReports.length) {
      const teamEntries = (teamInsightData || []).filter(e => {
        const d = e.date
        return d >= _toISO(monthStart) && d <= _toISO(now)
      })

      const personMap = {}
      _directReports.forEach(dr => { personMap[dr.id] = { name: dr.name || 'Unknown', hours: 0, pending: 0 } })
      teamEntries.forEach(e => {
        if (!personMap[e.employee_id]) return
        personMap[e.employee_id].hours   += parseFloat(e.hours || 0)
        if (e.status === 'submitted') personMap[e.employee_id].pending++
      })

      teamBarData = Object.values(personMap)

      const pendingRows = teamBarData.filter(p => p.pending > 0).map(p => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
          <span style="font-size:13px;font-weight:600;">${Utils.escapeHtml(p.name)}</span>
          <span class="badge badge--warning">${p.pending} pending</span>
        </div>
      `).join('')

      teamHtml = `
        <div class="ts-insights-section-title">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          Team — This Month
        </div>
        <div class="ts-chart-card">
          <div class="ts-chart-title">Hours by Team Member</div>
          <div class="ts-chart-wrap"><canvas id="ts-insights-team-bar"></canvas></div>
        </div>
        ${pendingRows ? `
          <div class="ts-chart-card">
            <div class="ts-chart-title">Pending Approvals</div>
            ${pendingRows}
          </div>
        ` : ''}
      `
    }

    // ── Team summary section for insights (6-month) ───────────
    const teamInsights = (teamInsightData || [])
    const teamTotalHrs  = teamInsights.reduce((s, e) => s + parseFloat(e.hours || 0), 0)
    const teamSubmitted = teamInsights.filter(e => e.status === 'submitted').length
    const teamApproved  = teamInsights.filter(e => e.status === 'approved').length
    const teamDrafts    = teamInsights.filter(e => e.status === 'draft').length

    // Per-member hours summary
    const teamMemberMap = {}
    teamInsights.forEach(e => {
      const id = e.employee_id
      if (!teamMemberMap[id]) teamMemberMap[id] = { name: e.employees?.name || 'Unknown', hours: 0, approved: 0 }
      teamMemberMap[id].hours    += parseFloat(e.hours || 0)
      if (e.status === 'approved') teamMemberMap[id].approved += parseFloat(e.hours || 0)
    })
    _directReports.forEach(dr => {
      if (!teamMemberMap[dr.id]) teamMemberMap[dr.id] = { name: dr.name, hours: 0, approved: 0 }
    })

    const teamSummaryHtml = (_p.can_approve || _isManager) && _directReports.length ? `
      <div class="section-card mb-4">
        <div class="section-card-header"><h3>Team Overview (Last 6 Months)</h3></div>
        <div class="section-card-body">
          <div class="grid-4 mb-4">
            <div class="stat-card">
              <div class="stat-label">Team Members</div>
              <div class="stat-value">${_directReports.length}</div>
              <div class="stat-delta">direct reports</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Total Hours Logged</div>
              <div class="stat-value">${teamTotalHrs.toFixed(1)}h</div>
              <div class="stat-delta">across all members</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Approved Hours</div>
              <div class="stat-value stat-value--positive">${teamApproved > 0 ? (teamInsights.filter(e=>e.status==='approved').reduce((s,e)=>s+parseFloat(e.hours||0),0)).toFixed(1)+'h' : '0h'}</div>
              <div class="stat-delta">confirmed entries</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Pending Review</div>
              <div class="stat-value${teamSubmitted > 0 ? ' stat-value--warning' : ''}">${teamSubmitted}</div>
              <div class="stat-delta">awaiting approval</div>
            </div>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="border-bottom:1px solid var(--border-color);">
                <th style="text-align:left;padding:8px 0;font-weight:600;color:var(--text-muted);">Member</th>
                <th style="text-align:right;padding:8px 0;font-weight:600;color:var(--text-muted);">Total Hours</th>
                <th style="text-align:right;padding:8px 0;font-weight:600;color:var(--text-muted);">Approved</th>
              </tr>
            </thead>
            <tbody>
              ${Object.values(teamMemberMap).sort((a,b) => b.hours - a.hours).map(m => `
                <tr style="border-bottom:1px solid var(--border-color,#f0f0f0);">
                  <td style="padding:10px 0;font-weight:500;">${Utils.escapeHtml(m.name)}</td>
                  <td style="text-align:right;padding:10px 0;">${m.hours.toFixed(1)}h</td>
                  <td style="text-align:right;padding:10px 0;color:var(--color-success,#22c55e);">${m.approved.toFixed(1)}h</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    ` : ''

    if (!content) return
    content.innerHTML = `
      <div>
        ${teamSummaryHtml}
        <div class="ts-insights-section-title">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Personal
        </div>

        <div class="grid-4 mb-4">
          <div class="stat-card">
            <div class="stat-label">This Month</div>
            <div class="stat-value">${thisMonthHrs.toFixed(1)}h</div>
            <div class="stat-delta">${thisMonth.length} entries</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Last Month</div>
            <div class="stat-value">${lastMonthHrs.toFixed(1)}h</div>
            <div class="stat-delta">${lastMonth.length} entries</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Approved Rate</div>
            <div class="stat-value stat-value--positive">${approvedRate}%</div>
            <div class="stat-delta">${approved.length} / ${submitted.length} submitted</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">On-Time Rate</div>
            <div class="stat-value${onTimeRate < 70 ? ' stat-value--warning' : ' stat-value--positive'}">${onTimeRate}%</div>
            <div class="stat-delta">${onTime.length} on time</div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:16px;">
          <div class="ts-chart-card">
            <div class="ts-chart-title">Weekly Hours — Last 8 Weeks</div>
            <div class="ts-chart-wrap"><canvas id="ts-insights-weekly-bar"></canvas></div>
          </div>
          <div class="ts-chart-card">
            <div class="ts-chart-title">This Month by Project</div>
            <div class="ts-chart-wrap--donut" id="ts-insights-donut-wrap">
              <canvas id="ts-insights-donut" width="160" height="160"></canvas>
              <div class="ts-donut-legend" id="ts-insights-donut-legend"></div>
            </div>
          </div>
        </div>

        <!-- Time Allocation -->
        <div class="ts-insights-section-title">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
          Time Allocation
        </div>

        ${sixMonthsData.length ? `
          <div class="ts-chart-card">
            <div class="ts-chart-title">Monthly Hours by Project — Last 6 Months</div>
            <div class="ts-chart-wrap" style="height:260px;"><canvas id="ts-insights-alloc-bar"></canvas></div>
          </div>
          <div class="ts-chart-card">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
              <div class="ts-chart-title" style="margin:0;">${thisMonthName} vs ${lastMonthName}</div>
            </div>
            ${deltaProjects.length ? `
              <table class="ts-delta-table">
                <thead>
                  <tr>
                    <th>Project / Client</th>
                    <th>${thisMonthName}</th>
                    <th>${lastMonthName}</th>
                    <th>Change</th>
                  </tr>
                </thead>
                <tbody>${deltaRows}</tbody>
              </table>
            ` : `<p style="color:var(--text-muted);font-size:13px;margin:0;">No entries in the last two months.</p>`}
          </div>
        ` : `
          <div class="ts-chart-card">
            <p style="color:var(--text-muted);font-size:13px;margin:0;">No timesheet data yet — come back after logging some entries.</p>
          </div>
        `}

        ${teamHtml}
      </div>
    `

    // ── Render charts (next tick so DOM is ready) ─────────────
    setTimeout(() => {
      if (typeof Chart === 'undefined') return

      // Weekly stacked bar
      const weeklyCanvas = document.getElementById('ts-insights-weekly-bar')
      if (weeklyCanvas) {
        const c = new Chart(weeklyCanvas, {
          type: 'bar',
          data: {
            labels: weeks.map(w => w.label),
            datasets: [
              { label: 'Approved', data: weeks.map(w => w.approved), backgroundColor: '#1D9E75', stack: 'a' },
              { label: 'Pending',  data: weeks.map(w => w.pending),  backgroundColor: '#F59E0B', stack: 'a' },
              { label: 'Draft',    data: weeks.map(w => w.draft),    backgroundColor: '#94A3B8', stack: 'a' },
            ],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 11 } } }, tooltip: { mode: 'index' } },
            scales: { x: { stacked: true, ticks: { font: { size: 10 } } }, y: { stacked: true, ticks: { font: { size: 10 } }, beginAtZero: true } },
          },
        })
        _insightsCharts.push(c)
      }

      // Project donut
      const donutCanvas = document.getElementById('ts-insights-donut')
      const donutLegend = document.getElementById('ts-insights-donut-legend')
      const projLabels  = Object.keys(projMap)
      const projVals    = Object.values(projMap)
      if (donutCanvas && projLabels.length) {
        const c = new Chart(donutCanvas, {
          type: 'doughnut',
          data: {
            labels: projLabels,
            datasets: [{ data: projVals, backgroundColor: CHART_COLORS.slice(0, projVals.length), borderWidth: 2, borderColor: '#fff' }],
          },
          options: {
            cutout: '65%',
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed.toFixed(1)}h` } } },
          },
        })
        _insightsCharts.push(c)
        if (donutLegend) {
          donutLegend.innerHTML = projLabels.map((l, i) => `
            <div class="ts-donut-legend-row">
              <span class="ts-donut-dot" style="background:${CHART_COLORS[i % CHART_COLORS.length]};"></span>
              <span class="ts-donut-name">${Utils.escapeHtml(l)}</span>
              <span class="ts-donut-val">${(projVals[i] || 0).toFixed(1)}h</span>
            </div>
          `).join('')
        }
      } else if (donutLegend) {
        donutLegend.innerHTML = '<p style="font-size:12px;color:var(--text-muted);">No entries this month.</p>'
      }

      // 6-month stacked allocation bar
      const allocCanvas = document.getElementById('ts-insights-alloc-bar')
      if (allocCanvas && stackedDatasets.length) {
        const c = new Chart(allocCanvas, {
          type: 'bar',
          data: {
            labels: months6.map(m => m.label),
            datasets: stackedDatasets,
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { position: 'top', labels: { boxWidth: 10, font: { size: 11 } } },
              tooltip: {
                mode: 'index',
                callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}h` },
              },
            },
            scales: {
              x: { stacked: true, ticks: { font: { size: 11 } } },
              y: { stacked: true, beginAtZero: true, ticks: { font: { size: 10 } } },
            },
          },
        })
        _insightsCharts.push(c)
      }

      // Team horizontal bar
      const teamBarCanvas = document.getElementById('ts-insights-team-bar')
      if (teamBarCanvas && teamBarData) {
        const c = new Chart(teamBarCanvas, {
          type: 'bar',
          data: {
            labels: teamBarData.map(p => p.name),
            datasets: [{ label: 'Hours', data: teamBarData.map(p => p.hours), backgroundColor: '#0F4799', borderRadius: 4 }],
          },
          options: {
            indexAxis: 'y',
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.x.toFixed(1)}h` } } },
            scales: { x: { beginAtZero: true, ticks: { font: { size: 10 } } }, y: { ticks: { font: { size: 11 } } } },
          },
        })
        _insightsCharts.push(c)
      }
    }, 0)
  }

  function _statusBadge(status) {
    const cfg = STATUS[status] || { label: status, cls: 'badge--muted' }
    return `<span class="badge ${cfg.cls}">${cfg.label}</span>`
  }

  function _openApproveModal(entryId, personMode = false) {
    // Look in both team entries and person entries
    const entry = _teamEntries.find(e => e.id === entryId)
               || _teamPersonEntries.find(e => e.id === entryId)
    if (entry?.employee_id === _user.id) {
      Utils.showToast('You cannot approve your own timesheet entries.', 'error')
      return
    }

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Approve Entry</h3>
        <button class="modal-close" onclick="Utils.closeModal()">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">Comment <span style="color:var(--text-muted);font-weight:400;">(optional)</span></label>
          <textarea class="form-input" id="ts-approve-comment" rows="3"
            placeholder="e.g. Looks good, keep it up!"
            style="resize:vertical;"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="ts-approve-confirm">Approve</button>
      </div>
    `)

    document.getElementById('ts-approve-confirm')?.addEventListener('click', async () => {
      const comment = document.getElementById('ts-approve-comment').value.trim()
      const btn     = document.getElementById('ts-approve-confirm')
      btn.disabled    = true
      btn.textContent = 'Approving…'
      await _approveEntry(entryId, comment, personMode)
      btn.disabled    = false
      btn.textContent = 'Approve'
    })
  }

  async function _approveEntry(entryId, comment = '', personMode = false) {
    const entry = _teamEntries.find(e => e.id === entryId)
               || _teamPersonEntries.find(e => e.id === entryId)

    const { error } = await Config.supabase
      .from('timesheets')
      .update({
        status:           'approved',
        approved_by:      _user.id,
        approval_comment: comment || null,
        acted_at:         new Date().toISOString(),
        updated_at:       new Date().toISOString(),
      })
      .eq('id', entryId)
      .eq('status', 'submitted')

    if (error) {
      Utils.showToast('Failed to approve.', 'error')
    } else {
      if (entry?.employee_id) {
        API.createNotification({
          recipient_employee_id: entry.employee_id,
          type: 'approval',
          message: `Your timesheet entry has been approved${comment ? ': ' + comment : '.'}`,
          module: 'timesheet',
          record_id: entryId,
        })
      }
      Utils.closeModal()
      Utils.showToast('Entry approved.', 'success')
      if (personMode) { _loadPersonWeek() } else { _fetchTeamWeek() }
    }
  }

  function _openRejectModal(entryId, personMode = false) {
    const entry = _teamEntries.find(e => e.id === entryId)
               || _teamPersonEntries.find(e => e.id === entryId)
    if (entry?.employee_id === _user.id) {
      Utils.showToast('You cannot reject your own timesheet entries.', 'error')
      return
    }

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Reject Entry</h3>
        <button class="modal-close" onclick="Utils.closeModal()">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">Provide a reason so the employee can fix and resubmit.</p>
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">Reason for rejection</label>
          <textarea class="form-input" id="ts-reject-comment" rows="3"
            placeholder="e.g. Hours don't match the work described…"
            style="resize:vertical;"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--danger" id="ts-reject-confirm">Reject Entry</button>
      </div>
    `)

    document.getElementById('ts-reject-confirm')?.addEventListener('click', async () => {
      const comment = document.getElementById('ts-reject-comment').value.trim()
      const btn     = document.getElementById('ts-reject-confirm')
      btn.disabled    = true
      btn.textContent = 'Rejecting…'

      const { error } = await Config.supabase
        .from('timesheets')
        .update({ status: 'rejected', rejection_comment: comment || null, acted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', entryId)
        .eq('status', 'submitted')

      btn.disabled    = false
      btn.textContent = 'Reject Entry'

      if (error) {
        Utils.showToast('Failed to reject.', 'error')
      } else {
        if (entry?.employee_id) {
          API.createNotification({
            recipient_employee_id: entry.employee_id,
            type: 'rejection',
            message: `Your timesheet entry was rejected${comment ? ': ' + comment : '.'}`,
            module: 'timesheet',
            record_id: entryId,
          })
        }
        Utils.closeModal()
        Utils.showToast('Entry rejected.', 'success')
        if (personMode) { _loadPersonWeek() } else { _fetchTeamWeek() }
      }
    })
  }

  /* ── Date helpers ───────────────────────────────────────── */
  // TEMPORARY: widen the normal 7-day edit lock through 2026-08-08 so the team
  // can backfill 1 Jul – 1 Aug. Self-reverts to the normal 7-day window the
  // day after — no manual follow-up needed. Remove once no longer needed.
  // Requested by Sunil Naudiyal, 2026-08-06 (extends the 2026-08-03 backfill).
  function _editLockDays() {
    const todayISO = _toISO(new Date())
    return todayISO <= '2026-08-08' ? 38 : 7
  }
  function _getMondayOf(date) {
    const d = new Date(date); const day = d.getDay()
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
    d.setHours(0, 0, 0, 0); return d
  }
  function _toISO(date)   {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  function _weekEnd(ws)   { const e = new Date(ws); e.setDate(e.getDate() + 6); return e }
  function _weekLabel(ws) {
    const opts = { month:'short', day:'numeric' }
    return `${ws.toLocaleDateString('en-IN', opts)} – ${_weekEnd(ws).toLocaleDateString('en-IN', { ...opts, year:'numeric' })}`
  }

  return { render, init }
})()

ModuleRegistry.register({
  key:       'timesheet',
  routeId:   'timesheet',
  label:     'Timesheet',
  order:     4,
  icon:      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
  getModule: () => Timesheet,
  features:  {
    log_entry:          'Log Time Entry',
    submit_timesheet:   'Submit Timesheet',
    approve_timesheets: 'Approve Team Timesheets',
  },
})
