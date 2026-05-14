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
    const showTeam = App.hasAccess('timesheet', 'approve_timesheets', 'can_approve')
    const tabs = [{ id:'mine', label:'My Timesheet' }]
    if (showTeam) tabs.push({ id:'team', label:"Team's Timesheet" })
    tabs.push({ id:'insights', label:'Insights' })

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
      can_approve: App.hasAccess('timesheet', 'approve_timesheets', 'can_approve'),
    }
    _weekStart = _getMondayOf(new Date())
    _teamWeek  = _getMondayOf(new Date())
    _activeTab = 'mine'

    // Consume any deep-link tab request (e.g. from home page "Review" button)
    const _requestedTab = sessionStorage.getItem('timesheet:tab') || null
    if (_requestedTab) sessionStorage.removeItem('timesheet:tab')

    const [{ data: clients }, { data: internalProjects }] = await Promise.all([
      API.getClients(false),
      API.getInternalProjects(),
    ])
    _clients          = clients || []
    _internalProjects = (internalProjects || []).filter(p => p.status === 'active')

    // Pre-load direct reports so the Team tab can scope approvals correctly
    if (_p.can_approve) {
      const { data: reports } = await API.getDirectReports(_user.id)
      _directReports = reports || []
    }

    _bindTabs()

    // If a valid tab was requested (e.g. "team" from home Review button) and
    // the user has the right permissions, navigate there instead of "mine"
    if (_requestedTab === 'team' && _p.can_approve) {
      _activeTab = 'team'
      document.querySelectorAll('#ts-tabs .tab-btn').forEach(btn => {
        btn.classList.toggle('tab-btn--active', btn.dataset.tab === 'team')
      })
      _loadTab('team')
    } else {
      _loadTab('mine')
    }
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

    // Build sidebar data — group by project name (client or internal)
    const clientHours = {}
    _entries.forEach(e => {
      const name = e.work_type === 'internal'
        ? (e.internal_project?.name || 'Internal')
        : (e.clients?.client_name || 'Internal')
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
  }

  /* ── Day column ─────────────────────────────────────────── */
  function _renderDayCol(day) {
    const iso        = _toISO(day)
    const today      = _toISO(new Date())
    const dayEntries = _entries.filter(e => e.date === iso)
    const isToday    = iso === today
    const dayHours   = dayEntries.reduce((s, e) => s + parseFloat(e.hours || 0), 0)

    // Hard lock: dates more than 7 days in the past, or any future date
    const diffDays  = Math.floor((new Date(today) - new Date(iso)) / 86400000)
    const isFuture  = iso > today
    const isLocked  = diffDays > 7
    // Warn: past weekdays in the current week with 0 hours and no entries
    const isPastNoEntry = !isToday && diffDays > 0 && diffDays <= 7 && dayEntries.length === 0

    // Determine day-level status
    const drafts    = dayEntries.filter(e => e.status === 'draft').length
    const submitted = dayEntries.filter(e => e.status === 'submitted').length
    const approved  = dayEntries.filter(e => e.status === 'approved').length
    const rejected  = dayEntries.filter(e => e.status === 'rejected').length

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
    if (isLocked) {
      footerHtml = `<div class="ts-day-action ts-day-action--locked">Locked</div>`
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
      <div class="ts-col${isToday ? ' ts-col--today' : ''}${isLocked ? ' ts-col--locked' : ''}">
        <div class="ts-col-header">
          <div class="ts-col-top">
            <span class="ts-col-weekday">${day.toLocaleDateString('en-IN', { weekday:'short' }).toUpperCase()}</span>
            <span class="ts-col-status-icon">${headerIcon}</span>
          </div>
          <span class="ts-col-date${isToday ? ' ts-col-date--today' : ''}">${day.getDate()}</span>
          ${dayHours > 0 ? `<span class="ts-col-hours">${dayHours.toFixed(1)}h</span>` : ''}
        </div>

        <div class="ts-col-body">
          ${dayEntries.map(e => _renderCard(e)).join('')}
          ${_p.can_create && !isLocked && !isFuture ? `
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
    `
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
    const minDateISO    = (() => { const d = new Date(); d.setDate(d.getDate() - 7); return _toISO(d) })()
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
            <label class="form-label">Work Area</label>
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
      if (date < minDateISO)          errs.push('Cannot log entries older than 7 days.')
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
    const { data, error } = await API.getTeamTimesheetEntries(from, to, _teamEmpId || null, reporteeIds.length ? reporteeIds : null, _user.id)
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
        _teamView       = 'person'
        _teamSelEmpObj  = empObj
        _teamPersonTab  = 'week'
        _teamPersonWeek = _getMondayOf(new Date())
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
    const totalHrs  = _teamEntries.reduce((s, e) => s + parseFloat(e.hours || 0), 0)

    mainPanel.innerHTML = `
      <div class="grid-4 mb-4">
        <div class="stat-card">
          <div class="stat-label">Total Hours</div>
          <div class="stat-value">${totalHrs.toFixed(1)}h</div>
          <div class="stat-delta">${_teamEntries.length} entr${_teamEntries.length === 1 ? 'y' : 'ies'}</div>
        </div>
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
        </div>
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
    const { data, error } = await API.getTimesheetEntries(_teamSelEmpObj.id, from, to)
    if (error) { Utils.showToast('Failed to load entries.', 'error'); return }
    _teamPersonEntries = data || []
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
      const { data } = await API.getTimesheetEntries(_teamSelEmpObj.id, from, to)
      _renderPersonMonthly(body, data || [])
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
      <div class="ts-col${isToday ? ' ts-col--today' : ''}">
        <div class="ts-col-header">
          <div class="ts-col-top">
            <span class="ts-col-weekday">${day.toLocaleDateString('en-IN', { weekday:'short' }).toUpperCase()}</span>
            <span class="ts-col-status-icon">${headerIcon}</span>
          </div>
          <span class="ts-col-date${isToday ? ' ts-col-date--today' : ''}">${day.getDate()}</span>
          ${dayHours > 0 ? `<span class="ts-col-hours">${dayHours.toFixed(1)}h</span>` : ''}
        </div>
        <div class="ts-col-body">
          ${dayEntries.map(e => _renderPersonCard(e)).join('')}
        </div>
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

    const approveRejectBar = e.status === 'submitted' && e.employee_id !== _user.id ? `
      <div class="ts-card-approve-bar">
        <button class="btn btn--xs btn--secondary ts-person-approve" data-id="${e.id}">Approve</button>
        <button class="btn btn--xs btn--danger ts-person-reject" data-id="${e.id}">Reject</button>
      </div>
    ` : ''

    return `
      <div class="ts-card ts-card--${e.status}">
        <div class="ts-card-client">
          ${isInternal ? `<span class="ts-card-type-badge ts-card-type-badge--internal">Internal</span>` : ''}
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
  function _renderPersonMonthly(container, entries) {
    if (!entries.length) {
      container.innerHTML = `<p class="empty-state">No entries in the last 6 months.</p>`
      return
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

    container.innerHTML = cardsHtml
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
          <td style="padding-top:14px;">${_statusBadge(e.status)}</td>
          <td style="white-space:nowrap;padding-top:14px;">
            ${e.status === 'submitted' && e.employee_id !== _user.id ? `
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
    const now         = new Date()
    const monthStart  = new Date(now.getFullYear(), now.getMonth(), 1)
    const lastMonthS  = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const lastMonthE  = new Date(now.getFullYear(), now.getMonth(), 0)
    const eightWeeksAgo = _getMondayOf((() => { const d = new Date(); d.setDate(d.getDate() - 49); return d })())

    // Personal data: last 8 weeks + current month
    const [{ data: weekData }, { data: monthData }, { data: lastMonthData }] = await Promise.all([
      API.getTimesheetEntries(_user.id, _toISO(eightWeeksAgo), _toISO(now)),
      API.getTimesheetEntries(_user.id, _toISO(monthStart), _toISO(now)),
      API.getTimesheetEntries(_user.id, _toISO(lastMonthS), _toISO(lastMonthE)),
    ])

    const allPersonal  = weekData || []
    const thisMonth    = monthData || []
    const lastMonth    = lastMonthData || []

    // Stat cards
    const thisMonthHrs  = thisMonth.reduce((s, e) => s + parseFloat(e.hours || 0), 0)
    const lastMonthHrs  = lastMonth.reduce((s, e) => s + parseFloat(e.hours || 0), 0)
    const submitted     = allPersonal.filter(e => ['submitted','approved','rejected'].includes(e.status))
    const approved      = allPersonal.filter(e => e.status === 'approved')
    const approvedRate  = submitted.length ? Math.round((approved.length / submitted.length) * 100) : 0
    const onTime        = allPersonal.filter(e => !e.is_late && ['submitted','approved','rejected'].includes(e.status))
    const onTimeRate    = submitted.length ? Math.round((onTime.length / submitted.length) * 100) : 0

    // Weekly trend: last 8 weeks
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

    // Donut: hours by project/client this month
    const projMap = {}
    thisMonth.forEach(e => {
      const key = e.work_type === 'internal'
        ? (e.internal_project?.name || 'Internal')
        : (e.clients?.client_name || 'Internal')
      projMap[key] = (projMap[key] || 0) + parseFloat(e.hours || 0)
    })

    // Team section (managers)
    let teamHtml = ''
    let teamBarData = null
    if (_p.can_approve && _directReports.length) {
      const reporteeIds = _directReports.map(e => e.id)
      const { data: teamMonthData } = await API.getTeamTimesheetEntries(
        _toISO(monthStart), _toISO(now), null,
        reporteeIds.length ? reporteeIds : null, _user.id
      )
      const teamEntries = teamMonthData || []

      // Per-person hours + pending
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
            ${pendingRows || '<p style="color:var(--text-muted);font-size:13px;">All caught up — no pending entries.</p>'}
          </div>
        ` : ''}
      `
    }

    if (!content) return
    content.innerHTML = `
      <div>
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
  function _weekEnd(ws)   { const e = new Date(ws); e.setDate(e.getDate() + 5); return e }
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
