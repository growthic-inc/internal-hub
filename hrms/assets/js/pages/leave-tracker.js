/* ============================================================
   LEAVE & ATTENDANCE — HRMS admin console
   Relocated from /home — Team Overview, Leave Balance Visibility,
   and Settings (leave types, holidays, WFH quotas, leave credits,
   company events, attendance late-threshold). Self-service
   (apply/view own leave, WFH, client visits) and Tier-2 team
   approvals stay in Growthic One — those don't require HR/admin
   authority, just being someone's actual manager.
   ============================================================ */

const LeaveTracker = (() => {

  const currentYear = new Date().getFullYear()

  const CLOSE_SVG  = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
  const CHEVRON_L  = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`
  const CHEVRON_R  = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`

  function _toISO(date) {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  let _user            = null
  let _activeTab        = null
  let _employees        = []
  let _leaveTypes       = []
  let _holidays         = []
  let _events           = []
  let _canViewTeamAtt   = false
  let _canUploadAttendance = false
  let _teamAttMonth     = null
  let _teamAttEmpId     = null
  let _visFilterMonth   = 0
  let _lateThreshold     = '10:30'
  let _lateEffectiveFrom = ''
  let _uploadLog         = []

  function _calcLateMinutes(punchIn, recordDate) {
    if (!punchIn || !_lateThreshold) return 0
    if (_lateEffectiveFrom && recordDate.substring(0, 7) < _lateEffectiveFrom) return 0
    const [ph, pm] = punchIn.split(':').map(Number)
    const [th, tm] = _lateThreshold.split(':').map(Number)
    return Math.max(0, (ph * 60 + pm) - (th * 60 + tm))
  }

  /* ── render ──────────────────────────────────────────────── */
  function render(user) {
    const isHR       = HRMSApp.hasAccess('leave_tracker', 'manage_leave_settings', 'can_manage')
    const canUpload  = HRMSApp.hasAccess('leave_tracker', 'upload_attendance', 'can_manage')

    const tabs = []
    if (isHR) {
      tabs.push({ id: 'team-overview', label: 'Team Overview' })
      tabs.push({ id: 'visibility',    label: 'Visibility' })
      tabs.push({ id: 'settings',      label: 'Settings' })
    }
    if (canUpload) tabs.push({ id: 'attendance-upload', label: 'Attendance Upload' })

    _activeTab = tabs[0]?.id || null

    if (!tabs.length) {
      return `<div class="page-inner"><p class="empty-state">You don't have access to any Leave & Attendance admin views.</p></div>`
    }

    return `
      <div class="page-inner">
        <div class="page-toolbar">
          <div class="tabs" id="lt-tabs">
            ${tabs.map(t => `
              <button class="tab-btn${t.id === _activeTab ? ' tab-btn--active' : ''}" data-tab="${t.id}">
                ${t.label}
              </button>`).join('')}
          </div>
          <div id="lt-toolbar-actions"></div>
        </div>
        <div id="lt-content" class="mt-4"></div>
      </div>
    `
  }

  /* ── init ────────────────────────────────────────────────── */
  async function init(user) {
    _user           = user
    _canViewTeamAtt      = HRMSApp.hasAccess('leave_tracker', 'view_team_attendance', 'view_only')
    _canUploadAttendance = HRMSApp.hasAccess('leave_tracker', 'upload_attendance', 'can_manage')
    _teamAttMonth   = new Date(new Date().getFullYear(), new Date().getMonth(), 1)

    const [empRes, ltRes, holRes, evtRes, attSettingsRes] = await Promise.all([
      API.getAllEmployees(),
      API.getLeaveTypes(true),
      API.getCompanyHolidays(currentYear),
      API.getCompanyEvents(currentYear),
      API.getAppSettings('attendance'),
    ])

    _employees  = empRes.data || []
    _leaveTypes = ltRes.data  || []
    _holidays   = holRes.data || []
    _events     = evtRes.data || []

    ;(attSettingsRes.data || []).forEach(s => {
      if (s.key === 'attendance.late_threshold')      _lateThreshold     = s.value
      if (s.key === 'attendance.late_effective_from') _lateEffectiveFrom = s.value
    })

    if (_canUploadAttendance) {
      const logRes = await API.getAttendanceUploadLog()
      _uploadLog = logRes.data || []
    }

    _bindTabs()
    if (_activeTab) _loadTab(_activeTab)
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
      case 'team-overview':      return _loadTeamOverviewTab()
      case 'visibility':         return _loadVisibilityTab()
      case 'settings':           return _loadSettingsTab()
      case 'attendance-upload':  return _loadAttendanceUploadTab()
    }
  }

  // For every uploaded record that's late beyond attendance.late_threshold,
  // auto-create an approved half-day leave request — unless the employee
  // already has Leave/WFH/Client Visit/a holiday/Sunday that date. Type is
  // picked by checking balance in order Casual -> Mental Health -> Earned,
  // falling back to Unpaid (always accepted, uncapped) if all are exhausted.
  async function _autoMarkLateHalfDays(records, dateFrom, dateTo) {
    const lateRecords = records.filter(r => r.late_minutes > 0)
    if (!lateRecords.length) return { created: 0 }

    const empIds = [...new Set(lateRecords.map(r => r.employee_id))]
    const { leaves, wfhs, clientVisits } = await API.getBulkLeaveOccupancy(empIds, dateFrom, dateTo)

    const occupied = new Set()
    const markOccupied = rows => rows.forEach(r => {
      let d = new Date(r.start_date)
      const end = new Date(r.end_date)
      while (d <= end) { occupied.add(`${r.employee_id}|${_toISO(d)}`); d.setDate(d.getDate() + 1) }
    })
    markOccupied(leaves); markOccupied(wfhs); markOccupied(clientVisits)

    const holidaySet = new Set((_holidays || []).map(h => h.date))

    const byEmp = {}
    lateRecords.forEach(r => { (byEmp[r.employee_id] = byEmp[r.employee_id] || []).push(r) })
    Object.values(byEmp).forEach(list => list.sort((a, b) => a.date.localeCompare(b.date)))

    const clType     = _leaveTypes.find(t => t.name.toLowerCase().includes('casual'))
    const mhType      = _leaveTypes.find(t => t.name.toLowerCase().includes('mental health'))
    const elType      = _leaveTypes.find(t => t.name.toLowerCase().includes('earned'))
    const unpaidType  = _leaveTypes.find(t => t.is_unpaid)
    const cascade     = [clType, mhType, elType].filter(Boolean)

    const rowsToInsert = []
    for (const [empId, list] of Object.entries(byEmp)) {
      const year = new Date(list[0].date).getFullYear()
      const [creditsRes, takenRes] = await Promise.all([
        API.getLeaveCredits(empId, year),
        API.getAllLeaveRequests({ status: 'approved', employeeId: empId }),
      ])
      const credits = creditsRes.data || []
      const taken   = (takenRes.data || []).filter(r => new Date(r.start_date).getFullYear() === year)
      const balMap  = {}
      credits.forEach(c => { balMap[c.leave_type_id] = (balMap[c.leave_type_id] || 0) + Number(c.credited_days) })
      taken.forEach(r => { balMap[r.leave_type_id] = (balMap[r.leave_type_id] || 0) - Number(r.days) })

      const managerId = _employees.find(e => e.id === empId)?.manager_id || null

      for (const rec of list) {
        const iso = rec.date
        if (new Date(iso + 'T00:00:00').getDay() === 0) continue // Sunday
        if (holidaySet.has(iso)) continue
        if (occupied.has(`${empId}|${iso}`)) continue

        const chosen = cascade.find(t => (balMap[t.id] || 0) >= 0.5) || unpaidType
        if (!chosen) continue // no leave types configured — skip safely

        if (chosen !== unpaidType) balMap[chosen.id] = (balMap[chosen.id] || 0) - 0.5

        rowsToInsert.push({
          employee_id:      empId,
          leave_type_id:    chosen.id,
          start_date:       iso,
          end_date:         iso,
          days:             0.5,
          is_half_day:      true,
          half_day_period:  'morning',
          reason:           `Auto-marked — arrived ${rec.late_minutes} min after the threshold`,
          status:           'approved',
          approver_id:      managerId,
          is_late_half_day: true,
        })
      }
    }

    if (rowsToInsert.length) await API.createLeaveRequestsBulk(rowsToInsert)
    return { created: rowsToInsert.length }
  }

  /* ══════════════════════════════════════════════════════════
     TAB: ATTENDANCE UPLOAD
  ══════════════════════════════════════════════════════════ */
  function _loadAttendanceUploadTab() {
    const content = document.getElementById('lt-content')
    if (!content) return

    const historyRows = _uploadLog.map(log => `
      <tr>
        <td class="text-sm">${new Date(log.uploaded_at).toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}</td>
        <td class="text-sm">${Utils.escapeHtml(log.uploader?.name || '—')}</td>
        <td class="text-sm">${Utils.escapeHtml(log.file_name)}</td>
        <td class="text-sm">${log.date_from ? log.date_from + ' → ' + log.date_to : '—'}</td>
        <td class="text-sm">${log.records_processed}</td>
        <td class="text-sm">${log.records_matched} matched, ${log.records_skipped} skipped</td>
        <td><span class="badge ${log.status === 'success' ? 'badge--success' : log.status === 'partial' ? 'badge--warning' : 'badge--danger'}">${log.status === 'partial' ? 'Partial' : log.status === 'success' ? 'Success' : 'Failed'}</span></td>
      </tr>`).join('')

    content.innerHTML = `
      <div class="section-card mb-4">
        <div class="section-card-header" style="justify-content:space-between;">
          <h3>Upload Attendance</h3>
          <label class="btn btn--primary btn--sm" style="cursor:pointer;">
            Upload XLS / XLSX
            <input type="file" id="att-upload-input" accept=".xls,.xlsx" style="display:none;">
          </label>
        </div>
        <div class="section-card-body">
          <p style="font-size:13px;color:var(--text-muted);margin:0;">
            Upload the biometric attendance report. Punch times are read from the "Att.log report" sheet (first punch = in, last punch = out), matched by Bio ID. Existing entries for the same date are overwritten.
          </p>
          <div id="att-upload-result" style="margin-top:10px;"></div>
        </div>
      </div>

      <div class="section-card">
        <div class="section-card-header"><h3>Upload History</h3></div>
        <div class="section-card-body" style="padding:0;">
          ${_uploadLog.length ? `
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr>
                <th>Date & Time</th><th>Uploaded By</th><th>File</th><th>Date Range</th>
                <th>Processed</th><th>Result</th><th>Status</th>
              </tr></thead>
              <tbody>${historyRows}</tbody>
            </table>
          </div>` : '<p style="padding:16px;font-size:13px;color:var(--text-muted);">No uploads yet.</p>'}
        </div>
      </div>
    `

    document.getElementById('att-upload-input')?.addEventListener('change', async (e) => {
      const file = e.target.files[0]
      if (!file) return
      await _processAttendanceUpload(file)
      e.target.value = ''
    })
  }

  async function _processAttendanceUpload(file) {
    const resultEl = document.getElementById('att-upload-result')
    if (resultEl) resultEl.innerHTML = '<p style="font-size:13px;color:var(--text-muted);">Processing…</p>'

    try {
      // Parse XLS using XLSX (globally loaded)
      const data = await file.arrayBuffer()
      const wb   = XLSX.read(data, { type: 'array', cellDates: true })

      // Source sheet: "Att.log report" — holds every raw punch per day.
      // We take the FIRST punch as punch-in and the LAST as punch-out,
      // ignoring any punches in between.
      const sheetName = wb.SheetNames.find(n => n.toLowerCase().includes('log'))
      if (!sheetName) {
        if (resultEl) resultEl.innerHTML = '<p style="color:#EF4444;font-size:13px;">Could not find the "Att.log report" sheet in the file.</p>'
        return
      }

      const ws   = wb.Sheets[sheetName]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

      // ── Determine the date range start ─────────────────────────
      // Row 2 holds e.g. "2026-06-01 ~ 2026-06-09". Parse the start date.
      let rangeStart = null, rangeEnd = null
      for (const r of rows.slice(0, 6)) {
        for (const cell of r) {
          const m = String(cell).match(/(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/)
          if (m) { rangeStart = m[1]; rangeEnd = m[2]; break }
        }
        if (rangeStart) break
      }
      if (!rangeStart) {
        if (resultEl) resultEl.innerHTML = '<p style="color:#EF4444;font-size:13px;">Could not read the date range from the file header.</p>'
        return
      }

      const startDate = new Date(rangeStart + 'T00:00:00')
      const endDate   = new Date(rangeEnd  + 'T00:00:00')
      const numDays   = Math.round((endDate - startDate) / 86400000) + 1
      // Column i of a punch row maps to startDate + i days.
      const dateForCol = i => {
        const d = new Date(startDate)
        d.setDate(d.getDate() + i)
        return _toISO(d)
      }

      // Split a concatenated cell like "10:1619:08" into ["10:16","19:08"].
      // Times are fixed-width HH:MM (5 chars).
      const splitPunches = v => {
        const s = String(v).replace(/\s+/g, '')
        const out = []
        for (let i = 0; i + 5 <= s.length; i += 5) {
          const chunk = s.slice(i, i + 5)
          if (/^\d{2}:\d{2}$/.test(chunk)) out.push(chunk)
        }
        return out
      }

      // ── Walk employee blocks: an "ID:" row, then its punch row ──
      // ID row has the bio id at the cell following an "ID:" label.
      const blocks = [] // { bioId, punchRow }
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        const idLabelCol = row.findIndex(c => String(c).trim().toUpperCase() === 'ID:')
        if (idLabelCol < 0) continue
        // bio id is the next non-empty cell after the label
        let bioId = null
        for (let c = idLabelCol + 1; c < row.length; c++) {
          const val = String(row[c]).trim()
          if (val !== '') { bioId = parseInt(val, 10); break }
        }
        if (bioId == null || isNaN(bioId)) continue
        // The punch row is the next row that is NOT another ID row.
        const punchRow = rows[i + 1] && rows[i + 1].findIndex(c => String(c).trim().toUpperCase() === 'ID:') < 0
          ? rows[i + 1]
          : null
        blocks.push({ bioId, punchRow })
      }

      if (!blocks.length) {
        if (resultEl) resultEl.innerHTML = '<p style="color:#EF4444;font-size:13px;">No employee punch blocks found in the sheet.</p>'
        return
      }

      // Fetch employee bio_id map
      const { data: empData } = await API.getEmployeesWithBioId()
      const bioMap = {}
      ;(empData || []).forEach(e => { bioMap[e.bio_id] = e.id })

      let matched = 0, skipped = 0, skippedEmps = 0
      const records = []
      const dateFrom = rangeStart, dateTo = rangeEnd

      for (const { bioId, punchRow } of blocks) {
        const empId = bioMap[bioId]
        if (!empId) { skippedEmps++; continue }
        if (!punchRow) continue

        for (let col = 0; col < numDays; col++) {
          const cell    = punchRow[col]
          const recDate = dateForCol(col)
          const punches = (cell === '' || cell == null) ? [] : splitPunches(cell)

          if (!punches.length) {
            // No punch data for this day — mark as absent so calendar shows "Absent"
            // not blank "No Data". Calendar rendering checks Sunday/Holiday/Leave first,
            // so those days still display correctly regardless of is_absent.
            records.push({
              employee_id:         empId,
              date:                recDate,
              punch_in:            null,
              punch_out:           null,
              late_minutes:        0,
              early_leave_minutes: 0,
              is_absent:           true,
              uploaded_by:         _user.id,
              uploaded_at:         new Date().toISOString(),
            })
            matched++
            continue
          }

          const punchIn  = punches[0]
          const punchOut = punches.length > 1 ? punches[punches.length - 1] : null

          records.push({
            employee_id:         empId,
            date:                recDate,
            punch_in:            punchIn,
            punch_out:           punchOut,
            late_minutes:        _calcLateMinutes(punchIn, recDate),
            early_leave_minutes: 0,
            is_absent:           false,
            uploaded_by:         _user.id,
            uploaded_at:         new Date().toISOString(),
          })
          matched++
        }
      }

      // "skipped" reported to the user = punch records belonging to unmapped Bio IDs.
      // Approximate by counting days for skipped employees is noisy, so report employees.
      skipped = skippedEmps
      const processed = matched + skippedEmps
      const status = matched === 0 ? 'failed' : skippedEmps > 0 ? 'partial' : 'success'

      // Upsert records
      if (records.length) {
        const { error } = await API.upsertAttendanceRecords(records)
        if (error) {
          if (resultEl) resultEl.innerHTML = `<p style="color:#EF4444;font-size:13px;">Upload failed: ${Utils.escapeHtml(error.message)}</p>`
          return
        }
      }

      // Auto half-day for anyone late beyond threshold — best-effort, doesn't
      // block reporting the attendance upload itself as successful.
      let halfDaysCreated = 0
      try {
        halfDaysCreated = (await _autoMarkLateHalfDays(records, dateFrom, dateTo)).created
      } catch (err) {
        console.error('[Late Half-Day]', err)
      }

      // Log the upload
      await API.insertAttendanceUploadLog({
        uploaded_by:       _user.id,
        file_name:         file.name,
        records_processed: processed,
        records_matched:   matched,
        records_skipped:   skipped,
        date_from:         dateFrom,
        date_to:           dateTo,
        status,
      })

      // Refresh log and reload tab
      const logRes = await API.getAttendanceUploadLog()
      _uploadLog = logRes.data || []

      const msg = `Upload complete — ${matched} day-records saved${halfDaysCreated ? `, ${halfDaysCreated} late half-day${halfDaysCreated === 1 ? '' : 's'} marked` : ''}${skippedEmps > 0 ? `, ${skippedEmps} employee(s) skipped (Bio ID not mapped)` : ''}.`
      Utils.showToast(msg, status === 'failed' ? 'error' : 'success')
      _loadAttendanceUploadTab()

    } catch (err) {
      console.error('[Attendance Upload]', err)
      if (resultEl) resultEl.innerHTML = `<p style="color:#EF4444;font-size:13px;">Error: ${Utils.escapeHtml(err.message)}</p>`
    }
  }

  /* ══════════════════════════════════════════════════════════
     TAB: TEAM OVERVIEW
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
            <div style="font-size:11px;color:var(--text-muted);">${Utils.escapeHtml(emp.designation || Utils.getDeptLabel(emp.department) || '—')} · ${Utils.escapeHtml(typeLabel)}</div>
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

      ${_canViewTeamAtt ? `
      <div class="section-card mt-4">
        <div class="section-card-header" style="justify-content:space-between;align-items:center;gap:12px;">
          <h3 style="margin:0;white-space:nowrap;">Employee Attendance</h3>
          <select id="lt-team-att-emp" class="form-control" style="width:220px;font-size:13px;">
            <option value="">Select employee…</option>
            ${_employees.filter(e => e.status === 'active').sort((a,b) => a.name.localeCompare(b.name)).map(e =>
              `<option value="${e.id}"${e.id === _teamAttEmpId ? ' selected' : ''}>${Utils.escapeHtml(e.name)}</option>`
            ).join('')}
          </select>
        </div>
        <div class="section-card-body">
          <div id="lt-team-att-cal">
            <p class="empty-state" style="padding:16px 0;">Select an employee to view their attendance.</p>
          </div>
        </div>
      </div>
      ` : ''}
    `

    if (_canViewTeamAtt) {
      document.getElementById('lt-team-att-emp')?.addEventListener('change', e => {
        _teamAttEmpId = e.target.value || null
        _loadTeamAttCal()
      })
      if (_teamAttEmpId) _loadTeamAttCal()
    }
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
              <td class="text-muted" style="font-size:12px;white-space:pre-wrap;word-break:break-word;max-width:220px;">${Utils.escapeHtml(r.reason || '—')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `
  }

  async function _loadTeamAttCal() {
    const wrap = document.getElementById('lt-team-att-cal')
    if (!wrap) return

    if (!_teamAttEmpId) {
      wrap.innerHTML = '<p class="empty-state" style="padding:16px 0;">Select an employee to view their attendance.</p>'
      return
    }

    wrap.innerHTML = '<p class="loading-text" style="padding:16px 0;">Loading…</p>'

    const month  = _teamAttMonth
    const mStart = _toISO(month)
    const mEnd   = _toISO(new Date(month.getFullYear(), month.getMonth() + 1, 0))

    const [attRes, leaveData] = await Promise.all([
      API.getEmployeeAttendance(_teamAttEmpId, mStart, mEnd),
      API.getApprovedLeaveForEmployee(_teamAttEmpId),
    ])

    const attRecs = attRes.data || []
    const { leaves = [], wfhs = [], clientVisits = [] } = leaveData

    const attMap = {}
    attRecs.forEach(r => { attMap[r.date] = r })

    const leaveMap = {}
    leaves.forEach(r => {
      let d = new Date(r.start_date)
      const end = new Date(r.end_date)
      while (d <= end) {
        const iso = _toISO(d)
        leaveMap[iso] = {
          id: r.id, leave_type_id: r.leave_type_id, start_date: r.start_date, end_date: r.end_date, days: r.days,
          name: r.leave_types?.name || 'Leave', is_half_day: r.is_half_day, half_day_period: r.half_day_period, status: r.status,
          is_late_half_day: r.is_late_half_day,
        }
        d.setDate(d.getDate() + 1)
      }
    })

    const wfhMap = {}
    wfhs.forEach(r => {
      let d = new Date(r.start_date)
      const end = new Date(r.end_date)
      while (d <= end) { wfhMap[_toISO(d)] = true; d.setDate(d.getDate() + 1) }
    })

    const clientVisitMap = {}
    clientVisits.forEach(r => {
      let d = new Date(r.start_date)
      const end = new Date(r.end_date)
      while (d <= end) { clientVisitMap[_toISO(d)] = r; d.setDate(d.getDate() + 1) }
    })

    const holidayMap = {}
    _holidays.forEach(h => { holidayMap[h.date] = h.name })

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

    const today    = _toISO(new Date())
    const year     = month.getFullYear()
    const mo       = month.getMonth()
    const firstDay = new Date(year, mo, 1)
    const lastDay  = new Date(year, mo + 1, 0)
    const startDow = (firstDay.getDay() + 6) % 7

    let calCells = ''
    for (let i = 0; i < startDow; i++) calCells += `<div class="att-cal-cell att-cal-cell--empty"></div>`

    for (let day = 1; day <= lastDay.getDate(); day++) {
      const dateObj   = new Date(year, mo, day)
      const iso       = _toISO(dateObj)
      const isSunday  = dateObj.getDay() === 0
      const isFuture  = iso > today
      const att       = attMap[iso]
      const leave     = leaveMap[iso]
      const isWfh     = wfhMap[iso]
      const cv        = clientVisitMap[iso]
      const holiday   = holidayMap[iso]
      const dayEvents = eventMap[iso] || []

      let cellClass   = 'att-cal-cell att-cal-cell--clickable'
      let cellContent = `<span class="att-cal-day">${day}</span>`
      let dayState    = 'future'

      const dayStatus = Utils.computeDayStatus(iso, { holiday, leave, isWfh, cv, attendance: att, todayISO: today })

      switch (dayStatus.state) {
        case 'off':
          cellClass += ' att-cal-cell--weekend'
          cellContent += `<span class="att-cal-label">Weekly Off</span>`
          dayState = 'weekend'
          break
        case 'holiday':
          cellClass += ' att-cal-cell--holiday'
          cellContent += `<span class="att-cal-label">${Utils.escapeHtml(dayStatus.label)}</span>`
          dayState = 'holiday'
          break
        case 'wfh':
          cellClass += ' att-cal-cell--wfh'
          if (dayStatus.pendingLeave) {
            const lbl = dayStatus.pendingLeave.is_half_day ? `½ ${Utils.escapeHtml(dayStatus.pendingLeave.name)}` : Utils.escapeHtml(dayStatus.pendingLeave.name)
            cellContent += `<span class="att-cal-label">WFH / Pending ${lbl}</span>`
          } else {
            cellContent += `<span class="att-cal-label">WFH</span>`
          }
          dayState = 'wfh'
          break
        case 'cv': {
          cellClass += ' att-cal-cell--client-visit'
          const half = cv.duration_type !== 'full_day'
          if (dayStatus.pendingLeave) {
            const lbl = dayStatus.pendingLeave.is_half_day ? `½ ${Utils.escapeHtml(dayStatus.pendingLeave.name)}` : Utils.escapeHtml(dayStatus.pendingLeave.name)
            cellContent += `<span class="att-cal-label">${half ? '½ ' : ''}Client Visit / Pending ${lbl}</span>`
          } else {
            cellContent += `<span class="att-cal-label">${half ? '½ ' : ''}Client Visit</span>`
            cellContent += `<span class="att-cal-time att-cal-time--cv">${Utils.escapeHtml(cv.clients?.client_name || 'Client')}</span>`
            if (att && !att.is_absent && att.punch_in) {
              cellContent += `<span class="att-cal-time">${att.punch_in.substring(0,5)}${att.punch_out ? '–' + att.punch_out.substring(0,5) : ''}</span>`
            }
          }
          dayState = 'client-visit'
          break
        }
        case 'leave':
        case 'leave-pending': {
          cellClass += leave.status === 'pending' ? ' att-cal-cell--leave att-cal-cell--leave-pending' : ' att-cal-cell--leave'
          const lbl = leave.is_half_day ? `½ ${Utils.escapeHtml(leave.name)}${leave.is_late_half_day ? ' (Late)' : ''}` : Utils.escapeHtml(leave.name)
          cellContent += `<span class="att-cal-label">${lbl}${leave.status === 'pending' ? ' <em style="font-size:10px;font-style:normal;opacity:0.7;">(Pending)</em>' : ''}</span>`
          dayState = 'leave'
          break
        }
        case 'present':
          cellClass += ' att-cal-cell--present'
          if (dayStatus.exempted) {
            const inT  = att.punch_in  ? att.punch_in.slice(0, 5)  : '—'
            const outT = att.punch_out ? att.punch_out.slice(0, 5) : '—'
            cellContent += `<span class="att-cal-time">${inT}</span>`
            cellContent += `<span class="att-cal-time att-cal-time--out">${outT}</span>`
          } else {
            cellContent += `<span class="att-cal-time">${att.punch_in.substring(0,5)}</span>`
            cellContent += `<span class="att-cal-time att-cal-time--out">${att.punch_out.substring(0,5)}</span>`
          }
          dayState = 'present'
          break
        case 'late':
          cellClass += ' att-cal-cell--late'
          cellContent += `<span class="att-cal-time att-cal-time--late">${att.punch_in.substring(0,5)} ▲</span>`
          cellContent += `<span class="att-cal-time att-cal-time--out">${att.punch_out ? att.punch_out.substring(0,5) : '—'}</span>`
          dayState = 'late'
          break
        case 'partial':
          cellClass += ' att-cal-cell--partial'
          cellContent += `<span class="att-cal-time">${att.punch_in.substring(0,5)}</span>`
          cellContent += `<span class="att-cal-time att-cal-time--out">—</span>`
          dayState = 'partial'
          break
        case 'absent':
          cellClass += ' att-cal-cell--absent'
          cellContent += `<span class="att-cal-label">Absent</span>`
          dayState = 'absent'
          break
        case 'blank':
          dayState = 'blank'
          break
        case 'no-data':
          cellClass += ' att-cal-cell--no-data'
          dayState = 'no-data'
          break
        case 'future':
          dayState = 'future'
          break
      }

      if (dayEvents.length) {
        cellContent += `<span class="att-cal-event-dot" title="${dayEvents.map(e => Utils.escapeHtml(e.title) + (_eventDurationLabel(e) ? ` (${_eventDurationLabel(e)})` : '')).join(', ')}"></span>`
      }
      if (att?.is_exempted) {
        cellContent += `<span class="att-cal-exempt-badge" title="${att.exemption_reason ? Utils.escapeHtml(att.exemption_reason) : 'Correction applied'}">✓</span>`
      }
      if (iso === today) cellClass += ' att-cal-cell--today'

      calCells += `<div class="${cellClass}" data-iso="${iso}" data-state="${dayState}">${cellContent}</div>`
    }

    const monthLabel = month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

    wrap.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <span style="font-size:14px;font-weight:600;">${monthLabel}</span>
        <div style="display:flex;align-items:center;gap:6px;">
          <button class="btn btn--ghost btn--sm" id="lt-team-att-prev">${CHEVRON_L}</button>
          <button class="btn btn--ghost btn--sm" id="lt-team-att-next" ${_toISO(_teamAttMonth).slice(0,7) >= today.slice(0,7) ? 'disabled' : ''}>${CHEVRON_R}</button>
        </div>
      </div>
      <div class="att-cal-grid att-cal-grid--header">
        ${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => `<div class="att-cal-dow">${d}</div>`).join('')}
      </div>
      <div class="att-cal-grid">${calCells}</div>
      <div class="att-legend" style="margin-top:12px;">
        <span class="att-legend-item"><span class="att-legend-dot" style="background:#D1FAE5;border:1.5px solid #1D9E75;border-radius:3px;"></span>Present</span>
        <span class="att-legend-item"><span class="att-legend-dot" style="background:#FEE2E2;border:1.5px solid #FECACA;border-radius:3px;"></span>Late</span>
        <span class="att-legend-item"><span class="att-legend-dot" style="background:#FEF3C7;border:1.5px solid #F59E0B;border-radius:3px;"></span>Partial</span>
        <span class="att-legend-item"><span class="att-legend-dot" style="background:#FEE2E2;border:1.5px solid #EF4444;border-radius:3px;"></span>Absent</span>
        <span class="att-legend-item"><span class="att-legend-dot" style="background:#EEF2FF;border:1.5px solid #6366F1;border-radius:3px;"></span>Leave</span>
        <span class="att-legend-item"><span class="att-legend-dot" style="background:#ECFDF5;border:1.5px solid #059669;border-radius:3px;"></span>WFH</span>
        <span class="att-legend-item"><span class="att-legend-dot" style="background:#E0F2FE;border:1.5px solid #0EA5E9;border-radius:3px;"></span>Client Visit</span>
        <span class="att-legend-item"><span class="att-legend-dot" style="background:#FEF3C7;border:1.5px solid #F59E0B;border-radius:3px;"></span>Holiday</span>
      </div>
    `

    document.getElementById('lt-team-att-prev')?.addEventListener('click', () => {
      _teamAttMonth = new Date(_teamAttMonth.getFullYear(), _teamAttMonth.getMonth() - 1, 1)
      _loadTeamAttCal()
    })
    document.getElementById('lt-team-att-next')?.addEventListener('click', () => {
      const next = new Date(_teamAttMonth.getFullYear(), _teamAttMonth.getMonth() + 1, 1)
      const now  = new Date()
      if (next <= new Date(now.getFullYear(), now.getMonth(), 1)) {
        _teamAttMonth = next
        _loadTeamAttCal()
      }
    })

    // Day click → detail modal
    wrap.querySelectorAll('.att-cal-cell--clickable[data-iso]').forEach(cell => {
      cell.addEventListener('click', () => {
        const iso   = cell.dataset.iso
        const state = cell.dataset.state
        _openTeamDayModal({
          iso, state,
          att:          attMap[iso],
          leave:        leaveMap[iso],
          isWfh:        !!wfhMap[iso],
          cv:           clientVisitMap[iso],
          holiday:      holidayMap[iso],
          dayEvents:    eventMap[iso] || [],
          empId:        _teamAttEmpId,
          leaveTypes:   _leaveTypes,
        })
      })
    })
  }

  async function _openTeamDayModal({ iso, state, att, leave, isWfh, cv, holiday, dayEvents, empId, leaveTypes }) {
    const existing = document.getElementById('lt-team-day-overlay')
    if (existing) existing.remove()

    const emp        = _employees.find(e => e.id === empId)
    const empName    = emp?.name || '—'
    const dateLabel  = new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    // Late arrivals go through the auto half-day + manager-approved correction
    // flow instead. Absent/No-Data/Partial have no automation at all — HR
    // reviews manually and marks a real leave from balance here if warranted.
    const canMark    = (state === 'absent' || state === 'no-data' || state === 'partial') && iso < _toISO(new Date())
    const canChangeType = state === 'leave' && (leave?.status === 'pending' || leave?.status === 'approved')

    // Attendance row
    let attRows = ''
    if (att && !att.is_absent && att.punch_in) {
      const isLate = att.late_minutes > 0
      attRows += `
        <div class="att-day-row"><span class="att-day-tag att-day-tag--present${isLate ? '" style="background:#FEE2E2;color:#B91C1C;' : ''}">Punch In${isLate ? ' · Late ' + att.late_minutes + ' min' : ''}</span><span>${att.punch_in.substring(0,5)}</span></div>
        <div class="att-day-row"><span class="att-day-tag att-day-tag--present">Punch Out</span><span>${att.punch_out ? att.punch_out.substring(0,5) : '—'}</span></div>`
    } else if (att?.is_absent) {
      attRows += `<div class="att-day-row"><span class="att-day-tag" style="background:#FEE2E2;color:#B91C1C;">No Punch Recorded</span></div>`
    } else {
      attRows += `<div class="att-day-row"><span class="att-day-tag" style="background:var(--surface);color:var(--text-muted);">No Attendance Data</span></div>`
    }

    if (att?.is_exempted) {
      attRows += `<div class="att-day-row"><span class="att-cal-exempt-badge" style="position:static;font-size:11px;padding:2px 8px;border-radius:20px;">✓ Correction Applied</span>${att.exemption_reason ? `<span style="font-size:13px;">${Utils.escapeHtml(att.exemption_reason)}</span>` : ''}</div>`
    }
    if (leave)    attRows += `<div class="att-day-row"><span class="att-day-tag att-day-tag--leave">${leave.status === 'pending' ? 'Pending Leave' : 'On Leave'}</span><span>${Utils.escapeHtml(leave.name)}${leave.is_half_day ? ' (½ day)' : ''}${leave.is_late_half_day ? ' — Late' : ''}</span></div>`
    if (isWfh)   attRows += `<div class="att-day-row"><span class="att-day-tag att-day-tag--wfh">WFH</span></div>`
    if (cv)      attRows += `<div class="att-day-row"><span class="att-day-tag att-day-tag--client-visit">Client Visit</span><span>${Utils.escapeHtml(cv.clients?.client_name || 'Client')}</span></div>`
    if (holiday) attRows += `<div class="att-day-row"><span class="att-day-tag att-day-tag--holiday">Holiday</span><span>${Utils.escapeHtml(holiday)}</span></div>`

    // Mark as Leave — the only tool for Absent/No-Data/Partial, HR-manual only
    let markSection = ''
    if (canMark) {
      const year = new Date(iso).getFullYear()
      const [creditsRes, takenRes] = await Promise.all([
        API.getLeaveCredits(empId, year),
        API.getAllLeaveRequests({ status: 'approved', employeeId: empId }),
      ])

      if (creditsRes) {
        const credits  = creditsRes.data  || []
        const taken    = (takenRes?.data  || []).filter(r => new Date(r.start_date).getFullYear() === year)
        const balMap   = {}
        credits.forEach(c => { balMap[c.leave_type_id] = (balMap[c.leave_type_id] || 0) + Number(c.credited_days) })
        taken.forEach(r => { balMap[r.leave_type_id] = (balMap[r.leave_type_id] || 0) - Number(r.days) })
        const eligibleTypes = (leaveTypes || _leaveTypes)
          .filter(t => t.is_active && (t.is_unpaid || (balMap[t.id] || 0) > 0))
          .sort((a, b) => {
            const aC = a.name.toLowerCase().includes('casual')
            const bC = b.name.toLowerCase().includes('casual')
            if (aC && !bC) return -1
            if (!aC && bC) return 1
            if (a.is_unpaid && !b.is_unpaid) return 1
            if (!a.is_unpaid && b.is_unpaid) return -1
            return a.name.localeCompare(b.name)
          })
        if (eligibleTypes.length) {
          const opts = eligibleTypes.map(t => {
            const bal = t.is_unpaid ? null : (balMap[t.id] || 0)
            return `<option value="${t.id}">${Utils.escapeHtml(t.name)}${bal !== null ? ' (' + bal + ' days remaining)' : ' (Unpaid)'}</option>`
          }).join('')
          markSection += `
            <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);">
              <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);margin-bottom:10px;">Mark as Leave</div>
              <div id="lt-mark-leave-err" class="alert alert--danger" style="display:none;margin-bottom:10px;font-size:13px;"></div>
              <div style="display:flex;flex-direction:column;gap:10px;">
                <select id="lt-mark-leave-type" class="form-control" style="font-size:13px;">${opts}</select>
                <input id="lt-mark-leave-reason" class="form-input" type="text" placeholder="Reason (optional)" style="font-size:13px;">
                <button class="btn btn--primary btn--sm" id="lt-mark-leave-confirm" style="align-self:flex-start;">Apply Leave</button>
              </div>
            </div>`
        } else {
          markSection += `
            <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);font-size:13px;color:var(--text-muted);">
              No leave balance available for this employee.
            </div>`
        }
      }
    }

    // Change Leave Type — applies to the whole request (every date in it),
    // not just the day clicked. Hard-blocks the save if the new type doesn't
    // have enough balance to cover the request's day count.
    let changeTypeSection = ''
    let changeTypeBalMap  = {}
    let changeTypeOptions = []
    if (canChangeType) {
      const year = new Date(leave.start_date).getFullYear()
      const [creditsRes, takenRes] = await Promise.all([
        API.getLeaveCredits(empId, year),
        API.getAllLeaveRequests({ status: 'approved', employeeId: empId }),
      ])
      const credits = creditsRes.data || []
      const taken   = (takenRes.data || []).filter(r => r.id !== leave.id && new Date(r.start_date).getFullYear() === year)
      credits.forEach(c => { changeTypeBalMap[c.leave_type_id] = (changeTypeBalMap[c.leave_type_id] || 0) + Number(c.credited_days) })
      taken.forEach(r => { changeTypeBalMap[r.leave_type_id] = (changeTypeBalMap[r.leave_type_id] || 0) - Number(r.days) })

      changeTypeOptions = (leaveTypes || _leaveTypes).filter(t => t.is_active)
      const rangeLabel = leave.start_date === leave.end_date
        ? Utils.formatDate(leave.start_date)
        : `${Utils.formatDate(leave.start_date)} – ${Utils.formatDate(leave.end_date)}`
      const dayLabel = `${leave.days} day${Number(leave.days) === 1 ? '' : 's'}`
      const opts = changeTypeOptions.map(t =>
        `<option value="${t.id}"${t.id === leave.leave_type_id ? ' selected' : ''}>${Utils.escapeHtml(t.name)}${t.is_unpaid ? ' (Unpaid)' : ''}</option>`
      ).join('')
      changeTypeSection = `
        <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);margin-bottom:6px;">Change Leave Type</div>
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">Updates the entire request: ${rangeLabel} (${dayLabel})</div>
          <div id="lt-change-type-err" class="alert alert--danger" style="display:none;margin-bottom:8px;font-size:13px;"></div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <select id="lt-change-type-select" class="form-control" style="font-size:13px;">${opts}</select>
            <button class="btn btn--ghost btn--sm" id="lt-change-type-confirm" style="align-self:flex-start;">Save</button>
          </div>
        </div>`
    }

    // Company Events — view what's on file for this date, and quick-create
    // a new one right here instead of switching to Settings.
    const eventsListHtml = (dayEvents && dayEvents.length)
      ? dayEvents.map(ev => `<div style="font-size:12px;margin-bottom:4px;"><strong>${Utils.escapeHtml(ev.title)}</strong>${_eventDurationLabel(ev) ? ` (${_eventDurationLabel(ev)})` : ''}${ev.description ? ` — ${Utils.escapeHtml(ev.description)}` : ''}</div>`).join('')
      : '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">No events on this date.</div>'
    const eventSection = `
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);margin-bottom:8px;">Company Events</div>
        ${eventsListHtml}
        <button class="btn btn--ghost btn--sm" id="lt-team-day-add-event-btn">+ Create Event</button>
        <div id="lt-team-day-event-form" style="display:none;margin-top:10px;">
          <div id="lt-team-evt-err" class="alert alert--danger" style="display:none;margin-bottom:8px;font-size:13px;"></div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <input class="form-input" type="text" id="lt-team-evt-title" placeholder="Event title" style="font-size:13px;">
            <select class="form-input" id="lt-team-evt-duration" style="font-size:13px;">
              <option value="full_day">Full Day</option>
              <option value="first_half">First Half</option>
              <option value="second_half">Second Half</option>
              <option value="specific_time">Specific Time</option>
            </select>
            <div style="display:none;gap:8px;" id="lt-team-evt-time-wrap">
              <input class="form-input" type="time" id="lt-team-evt-time-start" style="font-size:13px;">
              <input class="form-input" type="time" id="lt-team-evt-time-end" style="font-size:13px;">
            </div>
            <textarea class="form-input" id="lt-team-evt-desc" placeholder="Description (optional)" rows="2" style="font-size:13px;resize:vertical;"></textarea>
            <button class="btn btn--primary btn--sm" id="lt-team-evt-save-btn" style="align-self:flex-start;">Save Event</button>
          </div>
        </div>
      </div>`

    const overlay = document.createElement('div')
    overlay.id        = 'lt-team-day-overlay'
    overlay.className = 'modal-overlay'
    overlay.innerHTML = `
      <div class="modal" style="max-width:440px;">
        <div class="modal-header" style="border-bottom:1px solid var(--border);padding-bottom:14px;margin-bottom:0;">
          <div>
            <h3 class="modal-title" style="font-size:15px;font-weight:700;margin:0;">${Utils.escapeHtml(empName)}</h3>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${dateLabel}</div>
          </div>
          <button class="btn btn--ghost btn--sm" id="lt-team-day-close" style="margin-left:auto;">${CLOSE_SVG}</button>
        </div>
        <div class="modal-body" style="padding:16px 0 4px;">
          ${attRows}
          ${changeTypeSection}
          ${markSection}
          ${eventSection}
        </div>
      </div>
    `

    document.body.appendChild(overlay)
    overlay.querySelector('#lt-team-day-close').addEventListener('click', () => overlay.remove())
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })

    overlay.querySelector('#lt-team-day-add-event-btn')?.addEventListener('click', () => {
      const form = overlay.querySelector('#lt-team-day-event-form')
      form.style.display = form.style.display === 'none' ? 'block' : 'none'
    })
    overlay.querySelector('#lt-team-evt-duration')?.addEventListener('change', () => {
      const isTime = overlay.querySelector('#lt-team-evt-duration').value === 'specific_time'
      overlay.querySelector('#lt-team-evt-time-wrap').style.display = isTime ? 'flex' : 'none'
    })
    overlay.querySelector('#lt-team-evt-save-btn')?.addEventListener('click', async () => {
      const title      = overlay.querySelector('#lt-team-evt-title').value.trim()
      const duration   = overlay.querySelector('#lt-team-evt-duration').value
      const timeStart  = duration === 'specific_time' ? (overlay.querySelector('#lt-team-evt-time-start').value || null) : null
      const timeEnd    = duration === 'specific_time' ? (overlay.querySelector('#lt-team-evt-time-end').value || null)   : null
      const desc       = overlay.querySelector('#lt-team-evt-desc').value.trim()
      const errEl      = overlay.querySelector('#lt-team-evt-err')
      const saveBtn    = overlay.querySelector('#lt-team-evt-save-btn')
      if (!title) { errEl.style.display = ''; errEl.textContent = 'Enter an event title.'; return }

      errEl.style.display = 'none'
      saveBtn.disabled = true; saveBtn.textContent = 'Saving…'
      const { error } = await API.createCompanyEvent({
        title, start_date: iso, end_date: iso, description: desc || null,
        duration_type: duration, start_time: timeStart, end_time: timeEnd,
        created_by: _user.id,
      })
      if (error) {
        errEl.style.display = ''; errEl.textContent = error.message
        saveBtn.disabled = false; saveBtn.textContent = 'Save Event'
        return
      }
      overlay.remove()
      Utils.showToast('Event created.', 'success')
      const evtRes = await API.getCompanyEvents(new Date(iso).getFullYear())
      _events = evtRes.data || []
      _loadTeamAttCal()
    })

    const changeTypeBtn = overlay.querySelector('#lt-change-type-confirm')
    if (changeTypeBtn) {
      changeTypeBtn.addEventListener('click', async () => {
        const newTypeId = overlay.querySelector('#lt-change-type-select')?.value
        const errEl     = overlay.querySelector('#lt-change-type-err')
        if (!newTypeId) return

        const newType = changeTypeOptions.find(t => t.id === newTypeId)
        if (newType && !newType.is_unpaid) {
          const bal = changeTypeBalMap[newTypeId] || 0
          if (bal < Number(leave.days)) {
            errEl.style.display = ''
            errEl.textContent = `Insufficient ${newType.name} balance — ${bal} day${bal === 1 ? '' : 's'} remaining, ${leave.days} needed.`
            return
          }
        }

        errEl.style.display = 'none'
        changeTypeBtn.disabled = true; changeTypeBtn.textContent = 'Saving…'
        const { error } = await API.updateLeaveRequest(leave.id, { leave_type_id: newTypeId })
        if (error) {
          errEl.style.display = ''; errEl.textContent = error.message || 'Failed to save.'
          changeTypeBtn.disabled = false; changeTypeBtn.textContent = 'Save'
          return
        }
        overlay.remove()
        Utils.showToast('Leave type updated.', 'success')
        _loadTeamAttCal()
      })
    }

    const confirmBtn = overlay.querySelector('#lt-mark-leave-confirm')
    if (confirmBtn) {
      confirmBtn.addEventListener('click', async () => {
        const typeId = overlay.querySelector('#lt-mark-leave-type')?.value
        const reason = overlay.querySelector('#lt-mark-leave-reason')?.value?.trim() || ''
        const errEl  = overlay.querySelector('#lt-mark-leave-err')
        if (!typeId) return

        confirmBtn.disabled = true
        confirmBtn.textContent = 'Saving…'

        const { error } = await API.createLeaveRequest({
          employee_id:  empId,
          leave_type_id: typeId,
          start_date:   iso,
          end_date:     iso,
          days:         1,
          is_half_day:  false,
          reason:       reason || 'Marked by HR',
          status:       'approved',
          approver_id:  _user.id,
        })

        if (error) {
          if (errEl) { errEl.style.display = ''; errEl.textContent = error.message || 'Failed to save leave.' }
          confirmBtn.disabled = false
          confirmBtn.textContent = 'Apply Leave'
          return
        }

        overlay.remove()
        _loadTeamAttCal()
      })
    }
  }

  function _getMondayOf(date) {
    const d   = new Date(date)
    const dow = d.getDay()
    d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow))
    d.setHours(0, 0, 0, 0)
    return d
  }

  /* ══════════════════════════════════════════════════════════
     TAB: VISIBILITY
     Centralised leave balance view — all employees × all
     active leave types for the current year.
  ══════════════════════════════════════════════════════════ */
  async function _loadVisibilityTab() {
    const content = document.getElementById('lt-content')
    if (!content) return
    content.innerHTML = '<p class="loading-text">Loading visibility data…</p>'

    const [creditsRes, requestsRes, ltRes] = await Promise.all([
      API.getAllLeaveCredits(currentYear),
      API.getAllLeaveRequests({ status: 'approved' }),
      API.getLeaveTypes(true),
    ])

    const allCredits  = creditsRes.data  || []
    const allRequests = requestsRes.data || []
    const allTypes    = ltRes.data       || []

    if (!allTypes.length) {
      content.innerHTML = '<p class="empty-state">No active leave types configured. Add them in the Settings tab.</p>'
      return
    }

    // All approved requests for the current year
    const yearRequests = allRequests.filter(r =>
      new Date(r.start_date).getFullYear() === currentYear ||
      new Date(r.end_date).getFullYear() === currentYear
    )

    // Filter by selected month (for "Taken" column only; Remaining is always annual)
    const getFilteredRequests = () => {
      if (!_visFilterMonth) return yearRequests
      const mStr   = String(_visFilterMonth).padStart(2, '0')
      const mStart = `${currentYear}-${mStr}-01`
      const mEnd   = _toISO(new Date(currentYear, _visFilterMonth, 0))
      return yearRequests.filter(r => r.start_date <= mEnd && r.end_date >= mStart)
    }

    const _rebuildTable = () => {
      const filtered = getFilteredRequests()

      // Annual balance map: empId → typeId → { credited, annualTaken }
      const balanceMap = {}
      allCredits.forEach(c => {
        if (!balanceMap[c.employee_id]) balanceMap[c.employee_id] = {}
        if (!balanceMap[c.employee_id][c.leave_type_id])
          balanceMap[c.employee_id][c.leave_type_id] = { credited: 0, annualTaken: 0 }
        balanceMap[c.employee_id][c.leave_type_id].credited += Number(c.credited_days)
      })
      yearRequests.forEach(r => {
        if (!balanceMap[r.employee_id]) balanceMap[r.employee_id] = {}
        if (!balanceMap[r.employee_id][r.leave_type_id])
          balanceMap[r.employee_id][r.leave_type_id] = { credited: 0, annualTaken: 0 }
        balanceMap[r.employee_id][r.leave_type_id].annualTaken += Number(r.days)
      })

      // Filtered taken map: empId → typeId → days taken in selected period
      const filteredTakenMap = {}
      filtered.forEach(r => {
        if (!filteredTakenMap[r.employee_id]) filteredTakenMap[r.employee_id] = {}
        filteredTakenMap[r.employee_id][r.leave_type_id] =
          (filteredTakenMap[r.employee_id][r.leave_type_id] || 0) + Number(r.days)
      })

      const activeEmps = _employees
        .filter(e => e.status === 'active')
        .sort((a, b) => a.name.localeCompare(b.name))

      const tbody = document.getElementById('lt-vis-tbody')
      if (!tbody) return

      tbody.innerHTML = activeEmps.map(emp => {
        const empBal     = balanceMap[emp.id] || {}
        const empFiltered = filteredTakenMap[emp.id] || {}
        return `
          <tr>
            <td class="lt-vis-td-sticky">
              <div style="display:flex;align-items:center;gap:8px;">
                <div class="lt-vis-avatar">
                  ${emp.profile_image_url
                    ? `<img src="${Utils.escapeHtml(emp.profile_image_url)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
                    : Utils.getInitials(emp.name || '?')}
                </div>
                <span style="font-size:13px;font-weight:500;">${Utils.escapeHtml(emp.name)}</span>
              </div>
            </td>
            <td style="font-size:12px;color:var(--text-muted);">${Utils.escapeHtml(Utils.getDeptLabel(emp.department) || emp.department || '—')}</td>
            ${allTypes.map(t => {
              const b        = empBal[t.id]
              const taken    = empFiltered[t.id] || 0
              const takenHtml = taken > 0
                ? `<span class="lt-vis-taken-link" data-emp-id="${emp.id}" data-emp-name="${Utils.escapeHtml(emp.name)}" data-type-id="${t.id}" data-type-name="${Utils.escapeHtml(t.name)}" title="Click to see dates">${taken}</span>`
                : `<span style="color:var(--text-muted);">0</span>`

              // Unpaid Leave isn't credited by HR and has no ceiling — it's
              // deducted from pay instead, so "Remaining" doesn't apply.
              // Always show what was actually taken, never gate on credited
              // days like the paid types below (which have none to check).
              if (t.is_unpaid) {
                return `
                  <td class="lt-vis-cell">${takenHtml}</td>
                  <td class="lt-vis-cell lt-vis-cell--na" title="Unpaid leave has no balance — always available">—</td>
                `
              }

              if (!b || b.credited === 0) return `<td class="lt-vis-cell lt-vis-cell--na">—</td><td class="lt-vis-cell lt-vis-cell--na">—</td>`
              const remaining = b.credited - b.annualTaken
              const remCls    = remaining < 0 ? 'lt-vis-neg' : remaining === 0 ? 'lt-vis-zero' : 'lt-vis-pos'
              return `
                <td class="lt-vis-cell">${takenHtml}</td>
                <td class="lt-vis-cell ${remCls}">${remaining}</td>
              `
            }).join('')}
          </tr>
        `
      }).join('')

      // Wire click on taken links
      tbody.querySelectorAll('.lt-vis-taken-link').forEach(el => {
        el.addEventListener('click', () => {
          const empId   = el.dataset.empId
          const typeId  = el.dataset.typeId
          const empName = el.dataset.empName
          const typeName = el.dataset.typeName
          const reqs = filtered.filter(r => r.employee_id === empId && r.leave_type_id === typeId)
          _openLeaveDetailModal(empName, typeName, reqs)
        })
      })
    }

    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

    const activeEmps = _employees.filter(e => e.status === 'active')

    content.innerHTML = `
      <div class="section-card">
        <div class="section-card-header" style="justify-content:space-between;align-items:center;gap:12px;">
          <div>
            <h3 style="margin:0;">Leave Balance Visibility — ${currentYear}</h3>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">
              ${activeEmps.length} active employee${activeEmps.length !== 1 ? 's' : ''} · ${allTypes.length} leave type${allTypes.length !== 1 ? 's' : ''}
            </div>
          </div>
          <select id="lt-vis-month-filter" class="form-control" style="width:160px;font-size:13px;flex-shrink:0;">
            <option value="0"${_visFilterMonth === 0 ? ' selected' : ''}>Full Year ${currentYear}</option>
            ${MONTHS.map((m, i) => `<option value="${i+1}"${_visFilterMonth === i+1 ? ' selected' : ''}>${m}</option>`).join('')}
          </select>
        </div>
        <div class="section-card-body" style="padding:0;overflow-x:auto;">
          <table class="data-table lt-vis-table">
            <thead>
              <tr>
                <th class="lt-vis-th-sticky lt-vis-th-emp">Employee</th>
                <th class="lt-vis-th-dept">Department</th>
                ${allTypes.map(t => `<th class="lt-vis-th-type" colspan="2">${Utils.escapeHtml(t.name)}</th>`).join('')}
              </tr>
              <tr class="lt-vis-subrow">
                <th class="lt-vis-th-sticky"></th>
                <th></th>
                ${allTypes.map(() => `<th class="lt-vis-sub">Taken</th><th class="lt-vis-sub">Remaining</th>`).join('')}
              </tr>
            </thead>
            <tbody id="lt-vis-tbody"></tbody>
          </table>
        </div>
        <div style="padding:8px 16px;font-size:11px;color:var(--text-muted);border-top:1px solid var(--border);">
          Taken reflects the selected period. Remaining is always the annual balance.
          Click any taken number to see exact dates.
        </div>
      </div>
    `

    _rebuildTable()

    document.getElementById('lt-vis-month-filter')?.addEventListener('change', e => {
      _visFilterMonth = Number(e.target.value)
      _rebuildTable()
    })
  }

  function _openLeaveDetailModal(empName, typeName, requests) {
    const existing = document.getElementById('lt-leave-detail-overlay')
    if (existing) existing.remove()

    const overlay = document.createElement('div')
    overlay.id        = 'lt-leave-detail-overlay'
    overlay.className = 'modal-overlay'

    const rows = requests.length
      ? requests.sort((a, b) => a.start_date.localeCompare(b.start_date)).map(r => `
          <tr>
            <td style="font-size:13px;">${Utils.formatDate(r.start_date)}${r.start_date !== r.end_date ? ' – ' + Utils.formatDate(r.end_date) : ''}</td>
            <td style="font-size:13px;">${r.days} day${r.days !== 1 ? 's' : ''}${r.is_half_day ? ' (½)' : ''}</td>
            <td style="font-size:12px;color:var(--text-muted);max-width:200px;word-break:break-word;">${Utils.escapeHtml(r.reason || '—')}</td>
          </tr>`).join('')
      : `<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:16px;">No leaves found for this period.</td></tr>`

    overlay.innerHTML = `
      <div class="modal" style="max-width:520px;">
        <div class="modal-header" style="border-bottom:1px solid var(--border);padding-bottom:14px;margin-bottom:0;">
          <div>
            <h3 class="modal-title" style="font-size:15px;font-weight:700;margin:0;">${Utils.escapeHtml(empName)}</h3>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${Utils.escapeHtml(typeName)}</div>
          </div>
          <button class="btn btn--ghost btn--sm" id="lt-leave-detail-close" style="margin-left:auto;">${CLOSE_SVG}</button>
        </div>
        <div class="modal-body" style="padding:16px 0 4px;max-height:400px;overflow-y:auto;">
          <table class="data-table">
            <thead><tr><th>Dates</th><th>Days</th><th>Reason</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `

    document.body.appendChild(overlay)
    overlay.querySelector('#lt-leave-detail-close').addEventListener('click', () => overlay.remove())
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })
  }

  /* ══════════════════════════════════════════════════════════
     TAB: SETTINGS
  ══════════════════════════════════════════════════════════ */
  async function _loadSettingsTab() {
    const content = document.getElementById('lt-content')
    if (!content) return
    content.innerHTML = '<p class="loading-text">Loading settings…</p>'

    const now      = new Date()
    const curMonth = now.getMonth() + 1
    const curYear  = now.getFullYear()

    const [ltRes, holRes, evtRes, quotaRes, creditsRes, attSettingsRes] = await Promise.all([
      API.getLeaveTypes(),
      API.getCompanyHolidays(curYear),
      API.getCompanyEvents(curYear),
      API.getWfhQuotas(null, curYear),
      API.getAllLeaveCredits(curYear),
      API.getAppSettings('attendance'),
    ])

    const attSettings = {}
    ;(attSettingsRes.data || []).forEach(s => { attSettings[s.key] = s.value })

    const allLeaveTypes = ltRes.data       || []
    const allHolidays   = holRes.data      || []
    const allEvents     = evtRes.data      || []
    const allQuotas     = quotaRes.data    || []
    const allCredits    = creditsRes.data  || []

    const curThreshold    = attSettings['attendance.late_threshold']     || '10:30'
    const curEffectiveFrom = attSettings['attendance.late_effective_from'] || ''

    content.innerHTML = `
      <!-- ── Attendance Settings ── -->
      <div class="lt-settings-section section-card mb-4">
        <div class="section-card-header">
          <h3>Attendance Settings</h3>
        </div>
        <div class="section-card-body" style="padding:16px 20px;">
          <div style="display:flex;align-items:flex-start;gap:32px;flex-wrap:wrap;">
            <div>
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);margin-bottom:4px;">Late Arrival Threshold</div>
              <div style="font-size:20px;font-weight:700;color:var(--text);">${curThreshold} AM</div>
              ${curEffectiveFrom ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px;">Effective from ${curEffectiveFrom}</div>` : ''}
            </div>
            <div style="margin-left:auto;">
              <button class="btn btn--ghost btn--sm" id="att-settings-edit-btn">Change Threshold</button>
            </div>
          </div>
          <div id="att-settings-form" style="display:none;margin-top:16px;padding-top:16px;border-top:1px solid var(--border);">
            <div id="att-settings-err" class="alert alert--danger" style="display:none;margin-bottom:12px;"></div>
            <div style="display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap;">
              <div class="form-group" style="margin-bottom:0;">
                <label class="form-label">New Threshold Time</label>
                <input class="form-input" type="time" id="att-new-threshold" value="${curThreshold}" style="width:140px;">
              </div>
              <div class="form-group" style="margin-bottom:0;">
                <label class="form-label">Effective From Month</label>
                <input class="form-input" type="month" id="att-new-effective"
                  value="${curEffectiveFrom || new Date().toISOString().substring(0,7)}" style="width:160px;">
              </div>
              <button class="btn btn--primary btn--sm" id="att-settings-save-btn">Save</button>
              <button class="btn btn--ghost btn--sm" id="att-settings-cancel-btn">Cancel</button>
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:10px;">
              Attendance uploads for months before the effective month will not be affected.
            </div>
          </div>
        </div>
      </div>

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

      <!-- ── Leave Policy (Auto-credit) ── -->
      <div class="lt-settings-section section-card mb-4">
        <div class="section-card-header" style="justify-content:space-between;align-items:center;">
          <div>
            <h3>Leave Policy — Auto-credit</h3>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">
              Set once a year. Credits full-time employees automatically on the 1st of the month.
            </div>
          </div>
          <button class="btn btn--primary btn--sm" id="lt-policy-save-btn">Save Policy</button>
        </div>
        <div class="section-card-body" style="padding:0;">
          ${_renderLeavePolicyTable(allLeaveTypes)}
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
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px;">
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">Duration</label>
              <select class="form-input" id="lt-new-evt-duration">
                <option value="full_day">Full Day</option>
                <option value="first_half">First Half</option>
                <option value="second_half">Second Half</option>
                <option value="specific_time">Specific Time</option>
              </select>
            </div>
            <div class="form-group" style="margin-bottom:0;display:none;" id="lt-evt-time-start-wrap">
              <label class="form-label">Start Time</label>
              <input class="form-input" type="time" id="lt-new-evt-time-start" />
            </div>
            <div class="form-group" style="margin-bottom:0;display:none;" id="lt-evt-time-end-wrap">
              <label class="form-label">End Time</label>
              <input class="form-input" type="time" id="lt-new-evt-time-end" />
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

  /* ── Leave Policy table ───────────────────────────────── */
  function _renderLeavePolicyTable(types) {
    const active = types.filter(t => t.is_active)
    if (!active.length) return '<p class="empty-state">No active leave types.</p>'

    const FREQ_LABELS = {
      monthly:    'Monthly',
      quarterly:  'Quarterly',
      half_yearly:'Half Yearly',
      yearly:     'Yearly',
    }

    function _creditSchedule(days, freq) {
      if (!freq || !days || days <= 0) return '<span class="badge badge--muted">Not auto-credited</span>'
      const d = parseFloat(days)
      const f = n => Number.isInteger(n) ? n : parseFloat(n.toFixed(2))
      if (freq === 'monthly')     return `<span class="badge badge--success">${f(d/12)} day${f(d/12)!==1?'s':''}/month</span>`
      if (freq === 'quarterly')   return `<span class="badge badge--success">${f(d/4)} day${f(d/4)!==1?'s':''}/quarter</span>`
      if (freq === 'half_yearly') return `<span class="badge badge--success">${f(d/2)} day${f(d/2)!==1?'s':''} on Jan & Jul</span>`
      if (freq === 'yearly')      return `<span class="badge badge--warning">${d} day${d!==1?'s':''} on Jan 1</span>`
      return '<span class="badge badge--muted">—</span>'
    }

    return `
      <table class="data-table">
        <thead>
          <tr>
            <th>Leave type</th>
            <th style="width:110px;">Annual days</th>
            <th style="width:160px;">Accrual frequency</th>
            <th>Credit schedule</th>
          </tr>
        </thead>
        <tbody>
          ${active.map(t => {
            const isManual = !t.accrual_frequency
            return `
              <tr data-policy-row="${t.id}">
                <td><strong>${Utils.escapeHtml(t.name)}</strong></td>
                <td>
                  ${isManual
                    ? `<span style="font-size:12px;color:var(--text-muted);">—</span>`
                    : `<input class="form-input lt-policy-days" type="number" min="0" max="365" step="0.5"
                         value="${t.annual_days ?? ''}" placeholder="0"
                         style="width:80px;padding:4px 8px;font-size:13px;"
                         oninput="this.closest('tr').querySelector('.lt-policy-pill').innerHTML=_ltPolicyPill(this.value,this.closest('tr').querySelector('.lt-policy-freq').value)">`}
                </td>
                <td>
                  <select class="form-select lt-policy-freq" style="font-size:13px;padding:4px 8px;"
                    onchange="this.closest('tr').querySelector('.lt-policy-pill').innerHTML=_ltPolicyPill(this.closest('tr').querySelector('.lt-policy-days')?.value,this.value)">
                    <option value="">— None —</option>
                    <option value="monthly"     ${t.accrual_frequency==='monthly'    ?'selected':''}>Monthly</option>
                    <option value="quarterly"   ${t.accrual_frequency==='quarterly'  ?'selected':''}>Quarterly</option>
                    <option value="half_yearly" ${t.accrual_frequency==='half_yearly'?'selected':''}>Half Yearly</option>
                    <option value="yearly"      ${t.accrual_frequency==='yearly'     ?'selected':''}>Yearly</option>
                  </select>
                </td>
                <td class="lt-policy-pill">${_creditSchedule(t.annual_days, t.accrual_frequency)}</td>
              </tr>`
          }).join('')}
        </tbody>
      </table>
    `
  }

  /* exposed helper called from inline oninput/onchange above */
  window._ltPolicyPill = function(days, freq) {
    if (!freq || !days || parseFloat(days) <= 0) return '<span class="badge badge--muted">Not auto-credited</span>'
    const d = parseFloat(days)
    const f = n => Number.isInteger(n) ? n : parseFloat(n.toFixed(2))
    if (freq === 'monthly')     return `<span class="badge badge--success">${f(d/12)} day${f(d/12)!==1?'s':''}/month</span>`
    if (freq === 'quarterly')   return `<span class="badge badge--success">${f(d/4)} day${f(d/4)!==1?'s':''}/quarter</span>`
    if (freq === 'half_yearly') return `<span class="badge badge--success">${f(d/2)} day${f(d/2)!==1?'s':''} on Jan & Jul</span>`
    if (freq === 'yearly')      return `<span class="badge badge--warning">${d} day${d!==1?'s':''} on Jan 1</span>`
    return '<span class="badge badge--muted">—</span>'
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
  // Human-friendly duration label for an event — blank for a plain full-day
  // event, since that's the default and needs no extra callout.
  function _eventDurationLabel(ev) {
    if (!ev.duration_type || ev.duration_type === 'full_day') return ''
    if (ev.duration_type === 'first_half')  return 'First Half'
    if (ev.duration_type === 'second_half') return 'Second Half'
    if (ev.duration_type === 'specific_time' && ev.start_time) {
      const fmt = t => {
        const [h, m] = t.split(':').map(Number)
        const hh = ((h + 11) % 12) + 1
        return `${hh}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
      }
      return ev.end_time ? `${fmt(ev.start_time)} – ${fmt(ev.end_time)}` : fmt(ev.start_time)
    }
    return ''
  }

  function _renderEventsTable(events) {
    if (!events.length) return '<p class="empty-state">No events added.</p>'
    return `
      <table class="data-table">
        <thead><tr><th>Title</th><th>Dates</th><th>Duration</th><th>Description</th><th></th></tr></thead>
        <tbody>
          ${events.map(ev => `
            <tr data-event-id="${ev.id}">
              <td>${Utils.escapeHtml(ev.title)}</td>
              <td style="white-space:nowrap;font-size:12px;">
                ${Utils.formatDate(ev.start_date)}${ev.end_date && ev.end_date !== ev.start_date ? ' – ' + Utils.formatDate(ev.end_date) : ''}
              </td>
              <td style="white-space:nowrap;font-size:12px;">${_eventDurationLabel(ev) || 'Full Day'}</td>
              <td class="text-muted" style="font-size:12px;white-space:pre-wrap;word-break:break-word;max-width:200px;">${Utils.escapeHtml(ev.description || '—')}</td>
              <td style="white-space:nowrap;">
                <button class="btn btn--xs btn--ghost" data-edit-event="${ev.id}"
                  data-title="${Utils.escapeHtml(ev.title)}"
                  data-start="${ev.start_date}"
                  data-end="${ev.end_date || ''}"
                  data-desc="${Utils.escapeHtml(ev.description || '')}"
                  data-duration="${ev.duration_type || 'full_day'}"
                  data-time-start="${ev.start_time || ''}"
                  data-time-end="${ev.end_time || ''}">Edit</button>
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
  function _renderCreditsTable(credits, leaveTypes, editingId = null) {
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
          ${credits.map(c => {
            if (c.id === editingId) {
              return `
                <tr data-credit-row="${c.id}">
                  <td>${Utils.escapeHtml(c.employees?.name || '—')}</td>
                  <td>${Utils.escapeHtml(c.leave_types?.name || '—')}</td>
                  <td><input type="number" id="edit-days-${c.id}" value="${c.credited_days}" min="0" step="0.5"
                    style="width:60px;padding:2px 4px;border:1px solid var(--border);border-radius:4px;font-weight:600;"></td>
                  <td>${c.year}</td>
                  <td><input type="text" id="edit-notes-${c.id}" value="${Utils.escapeHtml(c.notes || '')}"
                    style="width:100%;padding:2px 4px;border:1px solid var(--border);border-radius:4px;font-size:12px;"></td>
                  <td style="font-size:12px;">${Utils.escapeHtml(c.credited_by_emp?.name || '—')}</td>
                  <td style="white-space:nowrap;">
                    <button class="btn btn--xs btn--primary" data-save-credit="${c.id}">Save</button>
                    <button class="btn btn--xs btn--ghost" data-cancel-credit="${c.id}" style="margin-left:4px;">Cancel</button>
                  </td>
                </tr>
              `
            }
            return `
              <tr data-credit-row="${c.id}">
                <td>${Utils.escapeHtml(c.employees?.name || '—')}</td>
                <td>${Utils.escapeHtml(c.leave_types?.name || '—')}</td>
                <td><strong>${c.credited_days}</strong></td>
                <td>${c.year}</td>
                <td class="text-muted" style="font-size:12px;">${Utils.escapeHtml(c.notes || '—')}</td>
                <td style="font-size:12px;">${Utils.escapeHtml(c.credited_by_emp?.name || '—')}</td>
                <td style="white-space:nowrap;">
                  <button class="btn btn--xs btn--ghost" data-edit-credit="${c.id}" style="margin-right:4px;">Edit</button>
                  <button class="btn btn--xs btn--ghost" data-delete-credit="${c.id}"
                    style="color:var(--danger);">Delete</button>
                </td>
              </tr>
            `
          }).join('')}
        </tbody>
      </table>
    `
  }

  /* ── Settings event binding ───────────────────────────── */
  function _bindSettingsActions(allLeaveTypes, allQuotas, allHolidays, allEvents, allCredits, curMonth, curYear) {

    /* ── Leave Policy (Auto-credit) ── */
    document.getElementById('lt-policy-save-btn')?.addEventListener('click', async () => {
      const rows = document.querySelectorAll('[data-policy-row]')
      if (!rows.length) return

      const btn = document.getElementById('lt-policy-save-btn')
      btn.disabled = true; btn.textContent = 'Saving…'

      const updates = Array.from(rows).map(row => {
        const id   = row.dataset.policyRow
        const daysEl = row.querySelector('.lt-policy-days')
        const freqEl = row.querySelector('.lt-policy-freq')
        const days = daysEl ? (parseFloat(daysEl.value) || null) : null
        const freq = freqEl?.value || null
        return API.updateLeaveType(id, {
          annual_days:       days,
          accrual_frequency: freq || null,
        })
      })

      const results = await Promise.all(updates)
      const failed  = results.filter(r => r.error)

      btn.disabled = false; btn.textContent = 'Save Policy'

      if (failed.length) {
        Utils.showToast('Some updates failed — please try again.', 'error')
      } else {
        Utils.showToast('Leave policy saved.', 'success')
      }
    })

    /* ── Attendance Settings ── */
    document.getElementById('att-settings-edit-btn')?.addEventListener('click', () => {
      document.getElementById('att-settings-form').style.display = 'block'
      document.getElementById('att-settings-edit-btn').style.display = 'none'
    })
    document.getElementById('att-settings-cancel-btn')?.addEventListener('click', () => {
      document.getElementById('att-settings-form').style.display = 'none'
      document.getElementById('att-settings-edit-btn').style.display = ''
    })
    document.getElementById('att-settings-save-btn')?.addEventListener('click', async () => {
      const errEl     = document.getElementById('att-settings-err')
      errEl.style.display = 'none'
      const threshold = document.getElementById('att-new-threshold').value.trim()
      const effFrom   = document.getElementById('att-new-effective').value.trim()
      if (!threshold) { errEl.textContent = 'Please set a threshold time.'; errEl.style.display = 'block'; return }
      if (!effFrom)   { errEl.textContent = 'Please select the effective from month.'; errEl.style.display = 'block'; return }

      if (!confirm(`Set late arrival threshold to ${threshold} AM, effective from ${effFrom}?\n\nExisting uploaded records before ${effFrom} will not be changed.`)) return

      const btn = document.getElementById('att-settings-save-btn')
      btn.disabled = true; btn.textContent = 'Saving…'

      const [r1, r2] = await Promise.all([
        API.upsertAppSetting('attendance.late_threshold',     threshold, 'attendance', 'Late Arrival Threshold',                     _user.id),
        API.upsertAppSetting('attendance.late_effective_from', effFrom,  'attendance', 'Late Marking Effective From (YYYY-MM)', _user.id),
      ])

      btn.disabled = false; btn.textContent = 'Save'

      if (r1.error || r2.error) {
        errEl.textContent = (r1.error || r2.error).message
        errEl.style.display = 'block'
        return
      }

      _lateThreshold     = threshold
      _lateEffectiveFrom = effFrom
      Utils.showToast('Attendance settings saved.', 'success')
      _loadSettingsTab()
    })

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
    const _toggleEvtTimeFields = () => {
      const isTime = document.getElementById('lt-new-evt-duration')?.value === 'specific_time'
      document.getElementById('lt-evt-time-start-wrap').style.display = isTime ? '' : 'none'
      document.getElementById('lt-evt-time-end-wrap').style.display   = isTime ? '' : 'none'
    }
    document.getElementById('lt-new-evt-duration')?.addEventListener('change', _toggleEvtTimeFields)

    document.getElementById('lt-add-event-btn')?.addEventListener('click', () => {
      // Clear any existing editing state
      document.getElementById('lt-new-evt-title').value = ''
      document.getElementById('lt-new-evt-start').value = ''
      document.getElementById('lt-new-evt-end').value   = ''
      document.getElementById('lt-new-evt-desc').value  = ''
      document.getElementById('lt-new-evt-duration').value = 'full_day'
      document.getElementById('lt-new-evt-time-start').value = ''
      document.getElementById('lt-new-evt-time-end').value   = ''
      _toggleEvtTimeFields()
      document.getElementById('lt-save-event-btn').dataset.editEventId = ''
      document.getElementById('lt-add-event-form').style.display = 'block'
    })
    document.getElementById('lt-cancel-event-btn')?.addEventListener('click', () => {
      document.getElementById('lt-add-event-form').style.display = 'none'
      document.getElementById('lt-save-event-btn').dataset.editEventId = ''
    })
    document.getElementById('lt-save-event-btn')?.addEventListener('click', async () => {
      const title    = document.getElementById('lt-new-evt-title').value.trim()
      const start    = document.getElementById('lt-new-evt-start').value
      const end      = document.getElementById('lt-new-evt-end').value
      const desc     = document.getElementById('lt-new-evt-desc').value.trim()
      const duration = document.getElementById('lt-new-evt-duration').value
      const timeStart = duration === 'specific_time' ? (document.getElementById('lt-new-evt-time-start').value || null) : null
      const timeEnd   = duration === 'specific_time' ? (document.getElementById('lt-new-evt-time-end').value || null)   : null
      const editId  = document.getElementById('lt-save-event-btn').dataset.editEventId

      if (!title) { Utils.showToast('Enter an event title.', 'error'); return }
      if (!start) { Utils.showToast('Select a start date.', 'error'); return }

      const btn = document.getElementById('lt-save-event-btn')
      btn.disabled = true

      const payload = {
        title, start_date: start, end_date: end || start, description: desc || null,
        duration_type: duration, start_time: timeStart, end_time: timeEnd,
      }

      let error
      if (editId) {
        ;({ error } = await API.updateCompanyEvent(editId, payload))
      } else {
        ;({ error } = await API.createCompanyEvent({ ...payload, created_by: _user.id }))
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
        document.getElementById('lt-new-evt-duration').value = btn.dataset.duration || 'full_day'
        document.getElementById('lt-new-evt-time-start').value = btn.dataset.timeStart || ''
        document.getElementById('lt-new-evt-time-end').value   = btn.dataset.timeEnd || ''
        _toggleEvtTimeFields()
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
    async function _refreshCreditsBody(editingId = null) {
      const yr    = parseInt(document.getElementById('lt-credits-year')?.value || new Date().getFullYear(), 10)
      const [res, ltRes] = await Promise.all([API.getAllLeaveCredits(yr), API.getLeaveTypes()])
      const body  = document.getElementById('lt-credits-body')
      if (body) body.innerHTML = _renderCreditsTable(res.data || [], ltRes.data || [], editingId)
      _bindCreditDeleteButtons()
    }

    document.querySelectorAll('[data-edit-credit]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const yr    = parseInt(document.getElementById('lt-credits-year')?.value || new Date().getFullYear(), 10)
        const [res, ltRes] = await Promise.all([API.getAllLeaveCredits(yr), API.getLeaveTypes()])
        const body  = document.getElementById('lt-credits-body')
        if (body) body.innerHTML = _renderCreditsTable(res.data || [], ltRes.data || [], btn.dataset.editCredit)
        _bindCreditDeleteButtons()
        document.getElementById(`edit-days-${btn.dataset.editCredit}`)?.focus()
      })
    })

    document.querySelectorAll('[data-cancel-credit]').forEach(btn => {
      btn.addEventListener('click', () => _refreshCreditsBody())
    })

    document.querySelectorAll('[data-save-credit]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id    = btn.dataset.saveCredit
        const days  = parseFloat(document.getElementById(`edit-days-${id}`)?.value)
        const notes = document.getElementById(`edit-notes-${id}`)?.value.trim()
        if (isNaN(days) || days < 0) { Utils.showToast('Enter a valid number of days.', 'error'); return }
        btn.disabled = true
        btn.textContent = 'Saving…'
        const { error } = await API.updateLeaveCredit(id, { credited_days: days, notes: notes || null })
        if (error) { Utils.showToast('Failed: ' + error.message, 'error'); btn.disabled = false; btn.textContent = 'Save'; return }
        Utils.showToast('Allocation updated.', 'success')
        _refreshCreditsBody()
      })
    })

    document.querySelectorAll('[data-delete-credit]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this leave allocation? This will reduce the employee\'s leave balance.')) return
        const { error } = await API.deleteLeaveCredit(btn.dataset.deleteCredit)
        if (error) { Utils.showToast('Failed: ' + error.message, 'error'); return }
        Utils.showToast('Allocation deleted.', 'success')
        _refreshCreditsBody()
      })
    })
  }

  return { render, init }
})()

ModuleRegistry.register({
  key:       'leave_tracker',
  routeId:   'leave-tracker',
  label:     'Leave & Attendance',
  order:     2,
  icon:      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`,
  getModule: () => LeaveTracker,
  access:    (user) => user.role === 'super_admin'
    || HRMSApp.hasAccess('leave_tracker', 'manage_leave_settings', 'view_only')
    || HRMSApp.hasAccess('leave_tracker', 'view_team_attendance', 'view_only')
    || HRMSApp.hasAccess('leave_tracker', 'upload_attendance', 'view_only'),
  features:  {
    manage_leave_settings: 'Manage Leave Types & Holidays',
    view_team_attendance:  'View Team Attendance Calendars',
    upload_attendance:     'Upload Attendance Data',
  },
})
