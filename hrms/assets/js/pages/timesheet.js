/* ============================================================
   TIMESHEET — HRMS admin console (read-only, payroll verification)
   Company-wide, any-month view of who logged/submitted/missed
   their timesheet. Deliberately read-only — approving/rejecting
   a specific person's entries stays a manager (Tier 2) action in
   Growthic One's own Team's Timesheet tab. This page exists to
   spot gaps before running payroll, not to manage a team.
   ============================================================ */

const Timesheet = (() => {

  const CLOSE_SVG  = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
  const CHEVRON_L  = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`
  const CHEVRON_R  = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`

  // Single source of truth for the Coverage strip's per-day colors, shared
  // with the legend so the two can never drift out of sync. 'future' uses a
  // real, defined variable (not the old --surface-alt, which was undefined
  // and rendered as transparent — invisible against the row background,
  // which made the strip look like it broke into unlabeled fragments).
  const DAY_COLORS = {
    approved:  '#1D9E75',
    submitted: '#F59E0B',
    rejected:  '#F59E0B',
    draft:     '#94A3B8',
    missed:    '#EF4444',
    weekend:   'var(--border)',
    holiday:   '#FBBF24',
    leave:     '#6366F1',
    pending:   '#93C5FD',
    future:    'var(--border-light)',
  }
  // Legend entries only — submitted/rejected share a color and a label,
  // and future/weekend aren't worth explaining in a legend meant to
  // clarify the meaningful statuses.
  const DAY_LEGEND = [
    ['approved',  'Approved'],
    ['submitted', 'Submitted'],
    ['missed',    'Missed'],
    ['leave',     'Leave'],
    ['holiday',   'Holiday'],
    ['draft',     'Draft'],
    ['pending',   'Pending (grace period)'],
  ]

  function _renderCoverageLegend() {
    return `<div style="display:flex;align-items:center;flex-wrap:wrap;gap:14px;padding:12px 20px;border-bottom:1px solid var(--border);">
      ${DAY_LEGEND.map(([status, label]) => `
        <span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--text-muted);">
          <span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${DAY_COLORS[status]};"></span>${label}
        </span>
      `).join('')}
    </div>`
  }

  function _toISO(date) {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  // Matches the same 7-day edit-lock window payroll and Growthic One's
  // own Timesheet tab use, so "missed" here means the same thing it
  // means when payroll actually deducts for it.
  function _editLockDays() { return 7 }

  let _user         = null
  let _employees    = []
  let _selectedMonth = null   // Date, 1st of month
  let _viewMode      = 'overview'   // 'overview' | 'person'
  let _selectedEmpId = null

  /* ── render ──────────────────────────────────────────────── */
  function render(user) {
    return `
      <div class="page-inner">
        <div class="page-toolbar">
          <div id="ts-adm-nav"></div>
          <div></div>
        </div>
        <div id="ts-adm-content" class="mt-4"></div>
      </div>
    `
  }

  /* ── init ────────────────────────────────────────────────── */
  async function init(user) {
    _user          = user
    _selectedMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    _viewMode      = 'overview'

    const { data } = await API.getEmployees()
    _employees = data || []

    _loadOverview()
  }

  function _renderMonthNav() {
    const nav = document.getElementById('ts-adm-nav')
    if (!nav) return
    const label = _selectedMonth.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    const isCurrentMonth = _toISO(_selectedMonth).slice(0, 7) === _toISO(new Date()).slice(0, 7)
    nav.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <button class="btn btn--ghost btn--sm" id="ts-adm-prev">${CHEVRON_L}</button>
        <span style="font-size:14px;font-weight:600;min-width:150px;text-align:center;">${label}</span>
        <button class="btn btn--ghost btn--sm" id="ts-adm-next" ${isCurrentMonth ? 'disabled' : ''}>${CHEVRON_R}</button>
      </div>
    `
    document.getElementById('ts-adm-prev')?.addEventListener('click', () => {
      _selectedMonth = new Date(_selectedMonth.getFullYear(), _selectedMonth.getMonth() - 1, 1)
      _viewMode === 'overview' ? _loadOverview() : _loadPersonMonth(_selectedEmpId)
    })
    document.getElementById('ts-adm-next')?.addEventListener('click', () => {
      const next = new Date(_selectedMonth.getFullYear(), _selectedMonth.getMonth() + 1, 1)
      const now  = new Date()
      if (next <= new Date(now.getFullYear(), now.getMonth(), 1)) {
        _selectedMonth = next
        _viewMode === 'overview' ? _loadOverview() : _loadPersonMonth(_selectedEmpId)
      }
    })
  }

  /* ══════════════════════════════════════════════════════════
     LEVEL 1 — COMPANY MONTH OVERVIEW
  ══════════════════════════════════════════════════════════ */
  async function _loadOverview() {
    _viewMode = 'overview'
    _renderMonthNav()
    const content = document.getElementById('ts-adm-content')
    if (content) content.innerHTML = '<p class="loading-text">Loading…</p>'

    const year   = _selectedMonth.getFullYear()
    const month  = _selectedMonth.getMonth() + 1
    const mStart = _toISO(_selectedMonth)
    const mEnd   = _toISO(new Date(year, month, 0))

    const [entriesRes, leaveRes, holRes] = await Promise.all([
      API.getTeamTimesheetEntries(mStart, mEnd, null, null, null, true),
      API.getAllLeaveRequests({ status: 'approved' }),
      API.getCompanyHolidays(year),
    ])

    const allEntries  = entriesRes.data || []
    const allLeaves    = (leaveRes.data || []).filter(r => !r.is_half_day)
    const holidaySet   = new Set((holRes.data || []).map(h => h.date))

    const activeEmps = _employees.filter(e => e.status === 'active')

    const rows = activeEmps.map(emp => {
      const stats = _computeMonthStats(emp.id, year, month, allEntries, allLeaves, holidaySet)
      return { emp, stats }
    })

    if (content) {
      content.innerHTML = `
        <div class="section-card">
          ${_renderCoverageLegend()}
          <div class="section-card-body" style="padding:0;">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Coverage</th>
                  <th>Hours</th>
                  <th>Draft</th>
                  <th>Submitted</th>
                  <th>Approved</th>
                  <th>Missed</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(({ emp, stats }) => `
                  <tr class="row-clickable" data-emp-id="${emp.id}" style="cursor:pointer;">
                    <td>
                      <div style="display:flex;align-items:center;gap:8px;">
                        <div style="width:26px;height:26px;border-radius:50%;background:var(--primary-light);color:var(--primary);
                          font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;">
                          ${emp.profile_image_url ? `<img src="${Utils.escapeHtml(emp.profile_image_url)}" style="width:100%;height:100%;object-fit:cover;">` : Utils.getInitials(emp.name)}
                        </div>
                        <strong style="font-size:13px;">${Utils.escapeHtml(emp.name)}</strong>
                      </div>
                    </td>
                    <td>${_renderHeatmapStrip(stats.dayStatuses, stats.daysInMonth, year, month)}</td>
                    <td class="text-sm">${stats.hours.toFixed(1)}h</td>
                    <td class="text-sm">${stats.draft}</td>
                    <td class="text-sm">${stats.submitted}</td>
                    <td class="text-sm">${stats.approved}</td>
                    <td class="text-sm" style="${stats.missed > 0 ? 'color:#DC2626;font-weight:700;' : ''}">${stats.missed}${stats.missed > 0 ? ' ⚠' : ''}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `
      content.querySelectorAll('tr[data-emp-id]').forEach(row => {
        row.addEventListener('click', () => _loadPersonMonth(row.dataset.empId))
      })
    }
  }

  // Classifies every day in the month for one employee: weekend/holiday/leave
  // (excluded from missed-day counting) or draft/submitted/approved/missed —
  // "missed" meaning past the edit-lock window with nothing logged, same
  // definition payroll's own deduction calc uses.
  function _computeMonthStats(empId, year, month, allEntries, allLeaves, holidaySet) {
    const daysInMonth = new Date(year, month, 0).getDate()
    const empEntries  = allEntries.filter(e => e.employee_id === empId)

    const entryByDate = {}
    empEntries.forEach(e => {
      const existing = entryByDate[e.date]
      const rank = s => ({ approved: 3, submitted: 2, rejected: 1, draft: 0 }[s] ?? 0)
      if (!existing || rank(e.status) > rank(existing.status)) entryByDate[e.date] = e
    })

    const leaveDates = new Set()
    allLeaves.filter(l => l.employee_id === empId).forEach(l => {
      let d = new Date(l.start_date)
      const end = new Date(l.end_date)
      while (d <= end) { leaveDates.add(_toISO(d)); d.setDate(d.getDate() + 1) }
    })

    const today  = new Date()
    const cutoff = new Date(today)
    cutoff.setDate(cutoff.getDate() - _editLockDays())
    cutoff.setHours(23, 59, 59, 999)

    let hours = 0, draft = 0, submitted = 0, approved = 0, missed = 0
    const dayStatuses = {}

    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month - 1, d)
      const iso     = _toISO(dateObj)
      const isSunday = dateObj.getDay() === 0

      if (isSunday)              { dayStatuses[iso] = 'weekend'; continue }
      if (holidaySet.has(iso))   { dayStatuses[iso] = 'holiday'; continue }
      if (leaveDates.has(iso))   { dayStatuses[iso] = 'leave';   continue }

      const entry = entryByDate[iso]
      if (entry) {
        hours += parseFloat(entry.hours || 0)
        dayStatuses[iso] = entry.status
        if (entry.status === 'draft')     draft++
        else if (entry.status === 'submitted' || entry.status === 'rejected') submitted++
        else if (entry.status === 'approved') approved++
      } else if (dateObj > today) {
        dayStatuses[iso] = 'future'    // hasn't happened yet
      } else if (dateObj > cutoff) {
        dayStatuses[iso] = 'pending'   // today or recent, still inside the edit-lock grace window
      } else {
        dayStatuses[iso] = 'missed'
        missed++
      }
    }

    return { hours, draft, submitted, approved, missed, dayStatuses, daysInMonth }
  }

  function _renderHeatmapStrip(dayStatuses, daysInMonth, year, month) {
    let cells = ''
    for (let d = 1; d <= daysInMonth; d++) {
      const iso    = _toISO(new Date(year, month - 1, d))
      const status = dayStatuses[iso] || 'future'
      cells += `<span title="${d}: ${status}" style="display:inline-block;width:7px;height:14px;margin-right:1px;border-radius:1px;background:${DAY_COLORS[status] || DAY_COLORS.future};"></span>`
    }
    return `<div style="white-space:nowrap;line-height:0;">${cells}</div>`
  }

  /* ══════════════════════════════════════════════════════════
     LEVEL 2 — PERSON MONTH CALENDAR (read-only)
  ══════════════════════════════════════════════════════════ */
  async function _loadPersonMonth(empId) {
    _viewMode      = 'person'
    _selectedEmpId = empId
    _renderMonthNav()

    const emp = _employees.find(e => e.id === empId)
    const content = document.getElementById('ts-adm-content')
    if (content) content.innerHTML = '<p class="loading-text">Loading…</p>'

    const year   = _selectedMonth.getFullYear()
    const month  = _selectedMonth.getMonth() + 1
    const mStart = _toISO(_selectedMonth)
    const mEnd   = _toISO(new Date(year, month, 0))

    const [entriesRes, leaveRes, holRes] = await Promise.all([
      API.getTimesheetEntries(empId, mStart, mEnd),
      API.getAllLeaveRequests({ status: 'approved', employeeId: empId }),
      API.getCompanyHolidays(year),
    ])

    const entries    = entriesRes.data || []
    const leaves      = (leaveRes.data || []).filter(l => !l.is_half_day)
    const holidaySet  = new Set((holRes.data || []).map(h => h.date))
    const stats       = _computeMonthStats(empId, year, month, entries, leaves, holidaySet)

    const entriesByDate = {}
    entries.forEach(e => { (entriesByDate[e.date] ||= []).push(e) })

    const COLORS = {
      approved: { bg: '#D1FAE5', border: '#1D9E75' },
      submitted: { bg: '#FEF3C7', border: '#F59E0B' },
      rejected: { bg: '#FEF3C7', border: '#F59E0B' },
      draft: { bg: 'var(--surface)', border: 'var(--border)' },
      missed: { bg: '#FEE2E2', border: '#EF4444' },
      weekend: { bg: 'var(--surface)', border: 'var(--border)' },
      holiday: { bg: '#FEF3C7', border: '#FBBF24' },
      leave: { bg: '#EEF2FF', border: '#6366F1' },
      pending: { bg: '#EFF6FF', border: '#93C5FD' },
      future: { bg: 'transparent', border: 'var(--border)' },
    }

    const firstDay = new Date(year, month - 1, 1)
    const startDow = (firstDay.getDay() + 6) % 7
    let calCells = ''
    for (let i = 0; i < startDow; i++) calCells += `<div class="att-cal-cell att-cal-cell--empty"></div>`

    for (let d = 1; d <= stats.daysInMonth; d++) {
      const iso    = _toISO(new Date(year, month - 1, d))
      const status = stats.dayStatuses[iso] || 'future'
      const c      = COLORS[status] || COLORS.future
      const dayEntries = entriesByDate[iso] || []
      const dayHours    = dayEntries.reduce((s, e) => s + parseFloat(e.hours || 0), 0)

      calCells += `
        <div class="att-cal-cell${dayEntries.length ? ' att-cal-cell--clickable' : ''}" data-iso="${iso}"
          style="background:${c.bg};border-color:${c.border};">
          <span class="att-cal-day">${d}</span>
          ${dayHours ? `<span class="att-cal-time">${dayHours.toFixed(1)}h</span>` : ''}
          <span class="att-cal-label" style="text-transform:capitalize;">${status}</span>
        </div>`
    }

    if (content) {
      content.innerHTML = `
        <div class="section-card mb-4">
          <div class="section-card-body" style="padding:16px 20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
            <div style="display:flex;align-items:center;gap:10px;">
              <button class="btn btn--ghost btn--sm" id="ts-adm-back">← Back to Overview</button>
              <strong style="font-size:14px;">${Utils.escapeHtml(emp?.name || '')}</strong>
            </div>
            <div style="display:flex;gap:14px;font-size:12px;color:var(--text-muted);">
              <span>${stats.hours.toFixed(1)}h logged</span>
              <span>${stats.draft} draft</span>
              <span>${stats.submitted} submitted</span>
              <span>${stats.approved} approved</span>
              <span style="${stats.missed > 0 ? 'color:#DC2626;font-weight:700;' : ''}">${stats.missed} missed</span>
            </div>
          </div>
        </div>
        <div class="section-card">
          <div class="section-card-body">
            <div class="att-cal-grid att-cal-grid--header">
              ${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => `<div class="att-cal-dow">${d}</div>`).join('')}
            </div>
            <div class="att-cal-grid">${calCells}</div>
          </div>
        </div>
      `
      document.getElementById('ts-adm-back')?.addEventListener('click', _loadOverview)
      content.querySelectorAll('.att-cal-cell--clickable[data-iso]').forEach(cell => {
        cell.addEventListener('click', () => _openDayDetailModal(emp, cell.dataset.iso, entriesByDate[cell.dataset.iso] || []))
      })
    }
  }

  function _openDayDetailModal(emp, iso, dayEntries) {
    const rows = dayEntries.map(e => {
      const projName = e.work_type === 'internal'
        ? (e.internal_project?.name || 'Internal')
        : (e.clients?.client_name || 'Client')
      return `
        <div class="att-day-row">
          <span class="att-day-tag att-day-tag--present" style="text-transform:capitalize;">${e.status}</span>
          <span>${Utils.escapeHtml(projName)} — ${parseFloat(e.hours || 0).toFixed(1)}h</span>
        </div>
        ${e.work_description ? `<div style="font-size:12px;color:var(--text-muted);padding:2px 0 6px;">${Utils.escapeHtml(e.work_description)}</div>` : ''}
      `
    }).join('') || '<p style="font-size:13px;color:var(--text-muted);">No entries.</p>'

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">${Utils.escapeHtml(emp?.name || '')} — ${Utils.formatDate(iso)}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">${CLOSE_SVG}</button>
      </div>
      <div class="modal-body">
        ${rows}
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Close</button>
      </div>
    `)
  }

  return { render, init }
})()

ModuleRegistry.register({
  key:       'timesheet',
  routeId:   'timesheet',
  label:     'Timesheet',
  order:     3,
  icon:      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
  getModule: () => Timesheet,
  access:    (user) => user.role === 'super_admin'
    || HRMSApp.hasAccess('timesheet', 'view_company_timesheets', 'view_only'),
  features:  {
    view_company_timesheets: 'View Company Timesheets (Payroll)',
  },
})
