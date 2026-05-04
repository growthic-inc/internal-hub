/* ============================================================
   TIMESHEET — Phase 10 Redesign
   Calendar week view + per-day submission + entity support
   Two tabs: My Timesheet · Team's Timesheet (managers)
   ============================================================ */

const Timesheet = (() => {

  /* ── State ──────────────────────────────────────────────── */
  let _user          = null
  let _entries       = []
  let _clients       = []
  let _directReports = []   // employees whose manager_id === _user.id
  let _weekStart     = null
  let _activeTab     = 'mine'
  let _p             = null
  let _sideChart     = null   // Chart.js donut
  // Team tab
  let _teamEntries   = []
  let _teamWeek      = null
  let _teamEmpId     = ''

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

    const { data } = await API.getClients(false)
    _clients = data || []

    // Pre-load direct reports so the Team tab can scope approvals correctly
    if (_p.can_approve) {
      const { data: reports } = await API.getDirectReports(_user.id)
      _directReports = reports || []
    }

    _bindTabs()
    _loadTab('mine')
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
    switch (tab) {
      case 'mine': return _loadMineTab()
      case 'team': return _loadTeamTab()
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

    // Build sidebar data
    const clientHours = {}
    _entries.forEach(e => {
      const name = e.clients?.client_name || 'Internal'
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
    const dayEntries = _entries.filter(e => e.date === iso)
    const isToday    = iso === _toISO(new Date())
    const dayHours   = dayEntries.reduce((s, e) => s + parseFloat(e.hours || 0), 0)

    // Determine day-level status
    const drafts    = dayEntries.filter(e => e.status === 'draft').length
    const submitted = dayEntries.filter(e => e.status === 'submitted').length
    const approved  = dayEntries.filter(e => e.status === 'approved').length
    const rejected  = dayEntries.filter(e => e.status === 'rejected').length

    let headerIcon = ''
    if (dayEntries.length && approved === dayEntries.length) {
      headerIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1D9E75" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
    } else if (submitted > 0 && drafts === 0 && rejected === 0) {
      headerIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`
    } else if (rejected > 0) {
      headerIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`
    }

    let footerHtml = ''
    if (drafts > 0 && _p.can_edit) {
      footerHtml = `<button class="ts-day-action ts-day-action--submit ts-submit-day" data-date="${iso}">Submit ${drafts} Draft${drafts > 1 ? 's' : ''}</button>`
    } else if (approved === dayEntries.length && dayEntries.length > 0) {
      footerHtml = `<div class="ts-day-action ts-day-action--approved">Approved</div>`
    } else if (submitted > 0 && drafts === 0 && rejected === 0) {
      footerHtml = `<div class="ts-day-action ts-day-action--review">In Review</div>`
    } else if (rejected > 0) {
      footerHtml = `<div class="ts-day-action ts-day-action--rejected">Has Rejections</div>`
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
          ${dayEntries.map(e => _renderCard(e)).join('')}
          ${_p.can_create ? `
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
    const canAct     = e.status === 'draft' || e.status === 'rejected'
    const clientName = e.clients?.client_name || null
    const projCode   = e.clients?.project_code || null
    const entityName = e.entity?.entity_name || null
    const desc       = e.work_description || e.task_description || ''

    return `
      <div class="ts-card ts-card--${e.status}">
        ${clientName ? `
          <div class="ts-card-client">
            <span class="ts-card-client-name">${Utils.escapeHtml(clientName)}</span>
            ${projCode ? `<span class="ts-card-code">${Utils.escapeHtml(projCode)}</span>` : ''}
          </div>
        ` : '<div class="ts-card-client"><span class="ts-card-client-name" style="color:var(--text-muted);">Internal</span></div>'}
        ${entityName ? `<div class="ts-card-entity">${Utils.escapeHtml(entityName)}</div>` : ''}
        ${e.activity_type ? `<div class="ts-card-activity">${Utils.escapeHtml(e.activity_type)}</div>` : ''}
        ${desc ? `<div class="ts-card-desc">${Utils.escapeHtml(Utils.truncate(desc, 70))}</div>` : ''}
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

    const { error } = await Config.supabase
      .from('timesheets')
      .update({ status: 'submitted', updated_at: new Date().toISOString() })
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
    const isEdit       = !!existingEntry
    const weekEndISO   = _toISO(_weekEnd(_weekStart))
    const weekStartISO = _toISO(_weekStart)
    const todayISO     = _toISO(new Date())
    const defaultDate  = preDate || (todayISO >= weekStartISO && todayISO <= weekEndISO ? todayISO : weekStartISO)

    // Resolve pre-selected client for edit mode
    const preClientId  = existingEntry?.client_id || ''
    const preClient    = preClientId ? _clients.find(c => c.id === preClientId) : null
    const preEntities  = preClient?.client_entities || []
    const entityOpts   = preEntities.map(en =>
      `<option value="${en.id}" ${existingEntry?.entity_id === en.id ? 'selected' : ''}>${Utils.escapeHtml(en.entity_name)}</option>`
    ).join('')
    // Combobox display value for edit mode
    const preClientDisplay = preClient ? `${preClient.project_code} — ${preClient.client_name}` : ''

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">${isEdit ? 'Edit Entry' : 'Log Time Entry'}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <div id="ts-modal-err" class="alert alert--danger" style="display:none;margin-bottom:12px;"></div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Date <span class="required">*</span></label>
            <input class="form-input" type="date" id="ts-f-date"
              value="${existingEntry?.date || defaultDate}" />
          </div>
          <div class="form-group">
            <label class="form-label">Hours Spent <span class="required">*</span></label>
            <input class="form-input" type="number" id="ts-f-hours"
              min="0.5" max="12" step="0.5"
              value="${existingEntry?.hours || ''}"
              placeholder="e.g. 2.5" />
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Client / Project <span class="required">*</span></label>
          <div class="custom-select-wrap" id="ts-client-wrap" style="min-width:0;">
            <input class="form-input" type="text" id="ts-f-client-search"
              placeholder="Type to search client or project…"
              autocomplete="off"
              value="${Utils.escapeHtml(preClientDisplay)}" />
            <div class="custom-select-dropdown" id="ts-client-dropdown"
                 style="display:none;position:absolute;width:100%;left:0;z-index:200;">
              <div class="custom-select-list" id="ts-client-list"></div>
            </div>
          </div>
          <input type="hidden" id="ts-f-client" value="${preClientId}" />
        </div>

        <div class="form-group" id="ts-entity-wrap" style="${preEntities.length ? '' : 'display:none;'}">
          <label class="form-label">Entity <span class="required">*</span></label>
          <select class="form-select" id="ts-f-entity">
            <option value="">— Select entity —</option>
            ${entityOpts}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Work Description <span class="required">*</span></label>
          <textarea class="form-input" id="ts-f-desc" rows="3"
            placeholder="Describe what you worked on in detail…"
            style="resize:vertical;">${Utils.escapeHtml(existingEntry?.work_description || existingEntry?.task_description || '')}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="ts-modal-save">${isEdit ? 'Update Entry' : 'Save Entry'}</button>
      </div>
    `, { width: '520px' })

    // ── Client combobox ───────────────────────────────────────
    const clientSearch   = document.getElementById('ts-f-client-search')
    const clientDropdown = document.getElementById('ts-client-dropdown')
    const clientList     = document.getElementById('ts-client-list')
    const clientHidden   = document.getElementById('ts-f-client')

    function _renderClientDropdownList(subset) {
      clientList.innerHTML = subset.length
        ? subset.map(c => `
            <div class="custom-select-item"
                 data-id="${c.id}"
                 data-name="${Utils.escapeHtml(c.client_name)}"
                 data-code="${Utils.escapeHtml(c.project_code)}">
              <span>${Utils.escapeHtml(c.client_name)}</span>
              <span class="text-muted text-sm">${Utils.escapeHtml(c.project_code)}</span>
            </div>`).join('')
        : '<div class="custom-select-empty">No clients found</div>'

      clientList.querySelectorAll('.custom-select-item').forEach(item => {
        item.addEventListener('mousedown', e => {
          // mousedown fires before blur — prevent dropdown closing before click registers
          e.preventDefault()
          clientHidden.value   = item.dataset.id
          clientSearch.value   = `${item.dataset.code} — ${item.dataset.name}`
          clientDropdown.style.display = 'none'
          // Cascade entity dropdown
          _onClientSelected(item.dataset.id)
        })
      })
    }

    function _onClientSelected(clientId) {
      const client   = _clients.find(c => c.id === clientId)
      const entities = client?.client_entities || []
      const wrap     = document.getElementById('ts-entity-wrap')
      const sel      = document.getElementById('ts-f-entity')
      if (entities.length) {
        sel.innerHTML = '<option value="">— Select entity —</option>' +
          entities.map(en => `<option value="${en.id}">${Utils.escapeHtml(en.entity_name)}</option>`).join('')
        wrap.style.display = ''
      } else {
        sel.innerHTML = ''
        wrap.style.display = 'none'
      }
    }

    clientSearch.addEventListener('focus', () => {
      _renderClientDropdownList(_clients)
      clientDropdown.style.display = 'block'
    })

    clientSearch.addEventListener('input', () => {
      const q = clientSearch.value.trim().toLowerCase()
      // Clear the hidden id when user types freely (forces them to pick from list)
      clientHidden.value = ''
      _renderClientDropdownList(
        q ? _clients.filter(c =>
              c.client_name.toLowerCase().includes(q) ||
              c.project_code.toLowerCase().includes(q))
          : _clients
      )
      clientDropdown.style.display = 'block'
    })

    clientSearch.addEventListener('blur', () => {
      // Small delay so mousedown on list item fires first
      setTimeout(() => { clientDropdown.style.display = 'none' }, 150)
    })

    // Close dropdown on outside click
    document.addEventListener('click', function _outsideClick(e) {
      if (!document.getElementById('ts-client-wrap')?.contains(e.target)) {
        clientDropdown.style.display = 'none'
        document.removeEventListener('click', _outsideClick)
      }
    })

    // Save
    document.getElementById('ts-modal-save')?.addEventListener('click', async () => {
      const errEl    = document.getElementById('ts-modal-err')
      const saveBtn  = document.getElementById('ts-modal-save')
      const date     = document.getElementById('ts-f-date').value
      const hours    = parseFloat(document.getElementById('ts-f-hours').value)
      const clientId = document.getElementById('ts-f-client').value || null
      const entityId = document.getElementById('ts-f-entity')?.value || null
      const desc     = document.getElementById('ts-f-desc').value.trim()

      errEl.style.display = 'none'

      const errs = []
      if (!date)                          errs.push('Date is required.')
      if (!clientId)                      errs.push('Please select a client.')
      if (!desc)                          errs.push('Work description is required.')
      if (isNaN(hours) || hours <= 0)     errs.push('Hours must be greater than 0.')
      if (hours > 12)                     errs.push('Hours cannot exceed 12 per entry.')

      // Entity required if client has entities
      const clientObj  = _clients.find(c => c.id === clientId)
      const hasEntities = (clientObj?.client_entities || []).length > 0
      if (hasEntities && !entityId)       errs.push('Please select an entity for this client.')

      if (errs.length) { errEl.textContent = errs[0]; errEl.style.display = 'block'; return }

      saveBtn.disabled    = true
      saveBtn.textContent = isEdit ? 'Updating…' : 'Saving…'

      const payload = {
        date,
        hours,
        client_id:        clientId,
        entity_id:        entityId || null,
        project_code:     clientObj?.project_code || null,
        work_description: desc,
        task_description: desc,   // keep populated for backward compat
        updated_at:       new Date().toISOString(),
      }

      let error
      if (isEdit) {
        // Editing a rejected entry resets it to draft for resubmission
        if (existingEntry.status === 'rejected') payload.status = 'draft'
        ;({ error } = await Config.supabase.from('timesheets').update(payload).eq('id', existingEntry.id).eq('employee_id', _user.id))
      } else {
        ;({ error } = await Config.supabase.from('timesheets').insert({ ...payload, employee_id: _user.id, status: 'draft' }))
      }

      saveBtn.disabled    = false
      saveBtn.textContent = isEdit ? 'Update Entry' : 'Save Entry'

      if (error) {
        errEl.textContent   = error.message
        errEl.style.display = 'block'
      } else {
        Utils.closeModal()
        Utils.showToast(isEdit ? 'Entry updated.' : 'Entry logged.', 'success')
        await _loadWeek()
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
     TEAM'S TIMESHEET TAB
  ══════════════════════════════════════════════════════════ */
  async function _loadTeamTab() {
    const toolbar = document.getElementById('ts-toolbar-actions')
    if (toolbar) {
      toolbar.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;">
          <button class="btn btn--ghost btn--sm" id="ts-team-prev">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span id="ts-team-week-label" style="font-size:13px;font-weight:600;min-width:180px;text-align:center;">—</span>
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
    }
    _fetchTeamWeek()
  }

  async function _fetchTeamWeek() {
    const label = document.getElementById('ts-team-week-label')
    if (label) label.textContent = _weekLabel(_teamWeek)

    const content = document.getElementById('ts-content')
    if (content) content.innerHTML = '<p class="loading-text">Loading team submissions…</p>'

    const from = _toISO(_teamWeek)
    const to   = _toISO(_weekEnd(_teamWeek))

    const reporteeIds = _directReports.map(e => e.id)
    const { data, error } = await API.getTeamTimesheetEntries(from, to, _teamEmpId || null, reporteeIds.length ? reporteeIds : null)
    if (error) { Utils.showToast('Failed to load team data.', 'error'); return }
    _teamEntries = data || []
    _renderTeamView()
  }

  function _renderTeamView() {
    const content = document.getElementById('ts-content')
    if (!content) return

    // Group by employee
    const empMap = {}
    _teamEntries.forEach(e => {
      const empId = e.employee_id
      if (!empMap[empId]) empMap[empId] = { emp: e.employees, entries: [] }
      empMap[empId].entries.push(e)
    })

    const groups = Object.values(empMap)

    // Summary row
    const submitted = _teamEntries.filter(e => e.status === 'submitted').length
    const approved  = _teamEntries.filter(e => e.status === 'approved').length
    const rejected  = _teamEntries.filter(e => e.status === 'rejected').length
    const totalHrs  = _teamEntries.reduce((s, e) => s + parseFloat(e.hours || 0), 0)

    content.innerHTML = `
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

    content.querySelectorAll('.ts-approve-entry').forEach(btn =>
      btn.addEventListener('click', () => _approveEntry(btn.dataset.id))
    )
    content.querySelectorAll('.ts-reject-entry').forEach(btn =>
      btn.addEventListener('click', () => _openRejectModal(btn.dataset.id))
    )

    // Bind accordion toggles
    content.querySelectorAll('.ts-acc-header').forEach(header => {
      header.addEventListener('click', () => {
        const bodyId  = header.dataset.target
        const body    = document.getElementById(bodyId)
        const chevron = header.querySelector('.ts-acc-chevron')
        if (!body) return
        const isOpen = body.style.display !== 'none'
        body.style.display    = isOpen ? 'none' : ''
        header.dataset.open   = isOpen ? 'false' : 'true'
        if (chevron) chevron.style.transform = isOpen ? 'rotate(-90deg)' : 'rotate(0deg)'
      })
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
      const desc = e.work_description || e.task_description || '—'
      return `
        <tr>
          <td style="white-space:nowrap;font-size:12px;color:var(--text-muted);">${Utils.formatDate(e.date)}</td>
          <td>
            ${e.clients ? `<span style="font-weight:500;">${Utils.escapeHtml(e.clients.client_name)}</span>
            <span class="badge-code" style="margin-left:4px;">${Utils.escapeHtml(e.clients.project_code)}</span>` : '<span class="text-muted">—</span>'}
            ${e.entity ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${Utils.escapeHtml(e.entity.entity_name)}</div>` : ''}
          </td>
          <td style="color:var(--text-muted);font-size:12px;">${Utils.escapeHtml(e.activity_type || '—')}</td>
          <td style="max-width:220px;">
            <div style="font-size:12px;" title="${Utils.escapeHtml(desc)}">${Utils.escapeHtml(Utils.truncate(desc, 55))}</div>
          </td>
          <td style="text-align:right;font-weight:700;white-space:nowrap;">${parseFloat(e.hours).toFixed(1)}h</td>
          <td>${_statusBadge(e.status)}</td>
          <td style="white-space:nowrap;">
            ${e.status === 'submitted' ? `
              <button class="btn btn--xs btn--secondary ts-approve-entry" data-id="${e.id}" style="margin-right:4px;">Approve</button>
              <button class="btn btn--xs btn--danger ts-reject-entry"  data-id="${e.id}">Reject</button>
            ` : e.status === 'rejected' && e.rejection_comment ? `
              <span style="font-size:11px;color:var(--text-muted);max-width:120px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${Utils.escapeHtml(e.rejection_comment)}">↳ ${Utils.escapeHtml(e.rejection_comment)}</span>
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
                <th>Client</th>
                <th>Activity</th>
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

  function _statusBadge(status) {
    const cfg = STATUS[status] || { label: status, cls: 'badge--muted' }
    return `<span class="badge ${cfg.cls}">${cfg.label}</span>`
  }

  async function _approveEntry(entryId) {
    const entry = _teamEntries.find(e => e.id === entryId)

    const { error } = await Config.supabase
      .from('timesheets')
      .update({ status: 'approved', approved_by: _user.id, acted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', entryId)
      .eq('status', 'submitted')

    if (error) {
      Utils.showToast('Failed to approve.', 'error')
    } else {
      if (entry?.employee_id) {
        API.createNotification({
          recipient_employee_id: entry.employee_id,
          type: 'approval',
          message: 'Your timesheet entry has been approved.',
          module: 'timesheet',
          record_id: entryId,
        })
      }
      Utils.showToast('Entry approved.', 'success')
      _fetchTeamWeek()
    }
  }

  function _openRejectModal(entryId) {
    const entry = _teamEntries.find(e => e.id === entryId)

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
        _fetchTeamWeek()
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
