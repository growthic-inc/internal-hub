/* ============================================================
   TIMESHEET — Phase 5 design language
   Two tabs: My Timesheet (week view) + Team Submissions
   Modals via Utils.openModal().
   ============================================================ */

const Timesheet = (() => {

  let _user      = null
  let _entries   = []
  let _clients   = []
  let _weekStart = null
  let _activeTab = 'mine'
  let _p         = null  // department permissions

  const CAN_APPROVE = ['super_admin', 'founders_office', 'team_lead', 'hr']

  const STATUS_BADGE = {
    draft:     '<span class="badge badge--muted">Draft</span>',
    submitted: '<span class="badge badge--warning">Submitted</span>',
    approved:  '<span class="badge badge--success">Approved</span>',
    rejected:  '<span class="badge badge--danger">Rejected</span>',
  }

  /* ── render ──────────────────────────────────────────────── */
  function render(user) {
    const p = App.getPerms('timesheet')
    const showTeam = CAN_APPROVE.includes(user.role) && p.can_approve
    const tabs = [{ id: 'mine', label: 'My Timesheet' }]
    if (showTeam) tabs.push({ id: 'team', label: 'Team Submissions' })

    return `
      <div class="page-inner">
        <div class="page-toolbar">
          <div class="tabs" id="ts-tabs">
            ${tabs.map(t => `
              <button class="tab-btn${t.id === 'mine' ? ' tab-btn--active' : ''}" data-tab="${t.id}">
                ${t.label}
              </button>`).join('')}
          </div>
          <div id="ts-toolbar-actions"></div>
        </div>
        <div id="ts-content" class="mt-4"></div>
      </div>
    `
  }

  /* ── init ────────────────────────────────────────────────── */
  async function init(user) {
    _user      = user
    _p         = App.getPerms('timesheet')
    _weekStart = _getMondayOf(new Date())
    _activeTab = 'mine'

    const { data } = await API.getClients(false)
    _clients = data || []

    _bindTabs()
    _loadTab('mine')
  }

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
          <button class="btn btn--ghost btn--sm" id="ts-prev">← Prev</button>
          <span id="ts-week-label"
            style="font-size:13px;font-weight:600;min-width:220px;text-align:center;">—</span>
          <button class="btn btn--ghost btn--sm" id="ts-next">Next →</button>
        </div>
        <div style="display:flex;gap:8px;">
          ${_p.can_edit ? `<button class="btn btn--secondary btn--sm" id="ts-submit-btn" style="display:none;">Submit Drafts</button>` : ''}
          ${_p.can_create ? `<button class="btn btn--primary btn--sm" id="ts-log-btn">+ Log Entry</button>` : ''}
        </div>
      `
      document.getElementById('ts-prev').addEventListener('click', () => {
        _weekStart.setDate(_weekStart.getDate() - 7); _loadWeek()
      })
      document.getElementById('ts-next').addEventListener('click', () => {
        _weekStart.setDate(_weekStart.getDate() + 7); _loadWeek()
      })
      if (_p.can_edit)   document.getElementById('ts-submit-btn')?.addEventListener('click', _submitDrafts)
      if (_p.can_create) document.getElementById('ts-log-btn')?.addEventListener('click', _openLogModal)
    }
    _loadWeek()
  }

  async function _loadWeek() {
    const label = document.getElementById('ts-week-label')
    if (label) label.textContent = _weekLabel()

    const content = document.getElementById('ts-content')
    if (content) content.innerHTML = '<p class="loading-text">Loading…</p>'

    const { data, error } = await API.getTimesheetEntries(
      _user.id, _toISO(_weekStart), _toISO(_weekEnd())
    )
    if (error) { Utils.showToast('Failed to load timesheet.', 'error'); return }
    _entries = data || []
    _renderWeek()
    _updateSubmitBtn()
  }

  function _renderWeek() {
    const content = document.getElementById('ts-content')
    if (!content) return

    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(_weekStart)
      d.setDate(d.getDate() + i)
      return d
    })

    const totalHours = _entries.reduce((s, e) => s + parseFloat(e.hours), 0)
    const drafts     = _entries.filter(e => e.status === 'draft').length
    const approved   = _entries.filter(e => e.status === 'approved').length

    content.innerHTML = `
      <div class="grid-3 mb-4">
        <div class="stat-card">
          <div class="stat-label">This Week</div>
          <div class="stat-value">${totalHours.toFixed(1)}h</div>
          <div class="stat-delta">${_entries.length} entr${_entries.length === 1 ? 'y' : 'ies'} logged</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Drafts</div>
          <div class="stat-value">${drafts}</div>
          <div class="stat-delta">pending submission</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Approved</div>
          <div class="stat-value stat-value--positive">${approved}</div>
          <div class="stat-delta">entries confirmed</div>
        </div>
      </div>

      <div class="section-card">
        <div class="section-card-body" style="padding:0;">
          ${days.map(day => {
            const iso        = _toISO(day)
            const dayEntries = _entries.filter(e => e.date === iso)
            const dayLabel   = day.toLocaleDateString('en-IN', {
              weekday: 'long', month: 'short', day: 'numeric',
            })
            const isToday  = iso === _toISO(new Date())
            const dayHours = dayEntries.reduce((s, e) => s + parseFloat(e.hours), 0)

            return `
              <div class="ts-day">
                <div class="ts-day-header">
                  <span class="ts-day-label${isToday ? ' ts-day-label--today' : ''}">
                    ${dayLabel}
                    ${isToday ? '<span class="ts-today-tag">Today</span>' : ''}
                  </span>
                  ${dayHours > 0
                    ? `<span class="ts-day-hours">${dayHours.toFixed(1)}h</span>`
                    : ''}
                </div>
                ${dayEntries.length ? `
                  <table class="data-table">
                    <tbody>
                      ${dayEntries.map(entry => `
                        <tr>
                          <td style="width:110px;">${STATUS_BADGE[entry.status] || entry.status}</td>
                          <td>
                            <div style="font-size:13px;">${Utils.escapeHtml(entry.task_description)}</div>
                            ${entry.clients
                              ? `<div class="text-sm text-muted" style="margin-top:2px;">
                                   ${entry.clients.project_code} — ${Utils.escapeHtml(entry.clients.client_name)}
                                 </div>`
                              : ''}
                            ${entry.rejection_comment
                              ? `<div class="text-sm" style="color:var(--danger);margin-top:2px;">
                                   ↳ ${Utils.escapeHtml(entry.rejection_comment)}
                                 </div>`
                              : ''}
                          </td>
                          <td style="width:60px;text-align:right;font-weight:700;font-size:13px;">
                            ${entry.hours}h
                          </td>
                          <td style="width:40px;text-align:right;">
                            ${entry.status === 'draft' && _p.can_edit ? `
                              <button class="btn btn--xs btn--ghost ts-delete"
                                data-id="${entry.id}" title="Delete entry"
                                style="padding:4px 6px;color:var(--danger);">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"
                                  viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                  stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                  <polyline points="3 6 5 6 21 6"/>
                                  <path d="M19 6l-1 14H6L5 6"/>
                                  <path d="M10 11v6"/><path d="M14 11v6"/>
                                  <path d="M9 6V4h6v2"/>
                                </svg>
                              </button>
                            ` : ''}
                          </td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                ` : `<div class="ts-day-empty">No entries</div>`}
              </div>
            `
          }).join('')}
        </div>
      </div>
    `

    content.querySelectorAll('.ts-delete').forEach(btn =>
      btn.addEventListener('click', () => _deleteEntry(btn.dataset.id))
    )
  }

  function _updateSubmitBtn() {
    if (!_p.can_edit) return
    const btn = document.getElementById('ts-submit-btn')
    if (!btn) return
    const drafts = _entries.filter(e => e.status === 'draft').length
    btn.style.display = drafts > 0 ? 'inline-flex' : 'none'
    if (drafts > 0) btn.textContent = `Submit ${drafts} Draft${drafts > 1 ? 's' : ''}`
  }

  async function _submitDrafts() {
    const draftIds = _entries.filter(e => e.status === 'draft').map(e => e.id)
    if (!draftIds.length) return
    const btn = document.getElementById('ts-submit-btn')
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting…' }

    const { error } = await Config.supabase
      .from('timesheets')
      .update({ status: 'submitted', updated_at: new Date().toISOString() })
      .in('id', draftIds)
      .eq('employee_id', _user.id)

    if (btn) btn.disabled = false
    if (error) {
      Utils.showToast('Failed to submit. Try again.', 'error')
    } else {
      Utils.showToast('Timesheet submitted for approval.', 'success')
      await _loadWeek()
    }
  }

  async function _deleteEntry(id) {
    const { error } = await Config.supabase
      .from('timesheets')
      .delete()
      .eq('id', id)
      .eq('employee_id', _user.id)
      .eq('status', 'draft')

    if (error) {
      Utils.showToast('Failed to delete entry.', 'error')
    } else {
      _entries = _entries.filter(e => e.id !== id)
      _renderWeek()
      _updateSubmitBtn()
    }
  }

  /* ══════════════════════════════════════════════════════════
     LOG ENTRY MODAL
  ══════════════════════════════════════════════════════════ */
  function _openLogModal() {
    const today        = _toISO(new Date())
    const weekStartISO = _toISO(_weekStart)
    const weekEndISO   = _toISO(_weekEnd())
    const defaultDate  = (today >= weekStartISO && today <= weekEndISO) ? today : weekStartISO

    const clientOptions = _clients.map(c =>
      `<option value="${c.id}">${c.project_code} — ${Utils.escapeHtml(c.client_name)}</option>`
    ).join('')

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Log Time Entry</h3>
        <button class="modal-close" onclick="Utils.closeModal()">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <div id="ts-modal-err" class="alert alert--danger" style="display:none;"></div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Date <span class="required">*</span></label>
            <input class="form-input" type="date" id="ts-f-date"
              value="${defaultDate}" min="${weekStartISO}" max="${weekEndISO}" />
          </div>
          <div class="form-group">
            <label class="form-label">Hours <span class="required">*</span></label>
            <input class="form-input" type="number" id="ts-f-hours"
              min="0.5" max="8" step="0.5" placeholder="Max 8h" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Client</label>
          <select class="form-select" id="ts-f-client">
            <option value="">— No client / Internal —</option>
            ${clientOptions}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Task Description <span class="required">*</span></label>
          <textarea class="form-input" id="ts-f-desc" rows="3"
            placeholder="What did you work on?" style="resize:vertical;"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="ts-modal-save">Save Entry</button>
      </div>
    `)

    document.getElementById('ts-modal-save').addEventListener('click', async () => {
      const errEl   = document.getElementById('ts-modal-err')
      const saveBtn = document.getElementById('ts-modal-save')
      const date    = document.getElementById('ts-f-date').value
      const hours   = parseFloat(document.getElementById('ts-f-hours').value)
      const desc    = document.getElementById('ts-f-desc').value.trim()
      const clientId = document.getElementById('ts-f-client').value || null

      errEl.style.display = 'none'
      if (!date)                                    { errEl.textContent = 'Please select a date.';             errEl.style.display = 'block'; return }
      if (!desc)                                    { errEl.textContent = 'Please enter a task description.';  errEl.style.display = 'block'; return }
      if (isNaN(hours) || hours <= 0 || hours > 8)  { errEl.textContent = 'Hours must be between 0.5 and 8.'; errEl.style.display = 'block'; return }

      saveBtn.disabled    = true
      saveBtn.textContent = 'Saving…'

      const { error } = await Config.supabase.from('timesheets').insert({
        employee_id:      _user.id,
        date,
        hours,
        task_description: desc,
        client_id:        clientId,
        project_code:     clientId ? (_clients.find(c => c.id === clientId)?.project_code || null) : null,
        status:           'draft',
      })

      saveBtn.disabled    = false
      saveBtn.textContent = 'Save Entry'

      if (error) {
        errEl.textContent   = error.message
        errEl.style.display = 'block'
      } else {
        Utils.closeModal()
        Utils.showToast('Entry logged.', 'success')
        await _loadWeek()
      }
    })
  }

  /* ══════════════════════════════════════════════════════════
     TEAM SUBMISSIONS TAB
  ══════════════════════════════════════════════════════════ */
  async function _loadTeamTab() {
    const content = document.getElementById('ts-content')
    content.innerHTML = '<p class="loading-text">Loading team submissions…</p>'

    const from = new Date()
    from.setDate(from.getDate() - 30)

    const { data, error } = await API.getTeamTimesheetEntries(_toISO(from), _toISO(new Date()))
    if (error) { Utils.showToast('Failed to load team data.', 'error'); return }

    const entries = data || []

    content.innerHTML = `
      <div class="section-card">
        <div class="section-card-header">
          <h3>Team Submissions</h3>
          <span class="text-muted text-sm">Last 30 days</span>
        </div>
        <div class="section-card-body">
          ${!entries.length
            ? '<p class="empty-state">No submissions in the last 30 days.</p>'
            : `<table class="data-table">
                <thead><tr>
                  <th>Date</th>
                  <th>Employee</th>
                  <th>Client</th>
                  <th>Task</th>
                  <th style="text-align:right;">Hours</th>
                  <th>Status</th>
                  <th></th>
                </tr></thead>
                <tbody>
                  ${entries.map(e => `
                    <tr>
                      <td style="white-space:nowrap;font-size:12px;">${Utils.formatDate(e.date)}</td>
                      <td>${e.employees ? Utils.escapeHtml(e.employees.name) : '—'}</td>
                      <td class="text-sm text-muted">${e.clients ? e.clients.project_code : '—'}</td>
                      <td style="max-width:260px;">
                        ${Utils.escapeHtml(Utils.truncate(e.task_description, 60))}
                      </td>
                      <td style="text-align:right;font-weight:700;">${e.hours}h</td>
                      <td>${STATUS_BADGE[e.status] || e.status}</td>
                      <td style="white-space:nowrap;">
                        ${e.status === 'submitted' ? `
                          <button class="btn btn--xs btn--secondary ts-approve"
                            data-id="${e.id}" style="margin-right:4px;">Approve</button>
                          <button class="btn btn--xs btn--danger ts-reject"
                            data-id="${e.id}">Reject</button>
                        ` : ''}
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>`
          }
        </div>
      </div>
    `

    content.querySelectorAll('.ts-approve').forEach(btn =>
      btn.addEventListener('click', () => _approveEntry(btn.dataset.id))
    )
    content.querySelectorAll('.ts-reject').forEach(btn =>
      btn.addEventListener('click', () => _openRejectModal(btn.dataset.id))
    )
  }

  async function _approveEntry(entryId) {
    const { error } = await Config.supabase
      .from('timesheets')
      .update({ status: 'approved', approved_by: _user.id, updated_at: new Date().toISOString() })
      .eq('id', entryId)
      .eq('status', 'submitted')

    if (error) {
      Utils.showToast('Failed to approve.', 'error')
    } else {
      Utils.showToast('Entry approved.', 'success')
      _loadTeamTab()
    }
  }

  function _openRejectModal(entryId) {
    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Reject Entry</h3>
        <button class="modal-close" onclick="Utils.closeModal()">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">Reason for rejection</label>
          <textarea class="form-input" id="ts-reject-comment" rows="3"
            placeholder="Explain why this entry is being rejected…"
            style="resize:vertical;"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--danger" id="ts-reject-confirm">Reject Entry</button>
      </div>
    `)

    document.getElementById('ts-reject-confirm').addEventListener('click', async () => {
      const comment  = document.getElementById('ts-reject-comment').value.trim()
      const btn      = document.getElementById('ts-reject-confirm')
      btn.disabled    = true
      btn.textContent = 'Rejecting…'

      const { error } = await Config.supabase
        .from('timesheets')
        .update({
          status:            'rejected',
          rejection_comment: comment || null,
          updated_at:        new Date().toISOString(),
        })
        .eq('id', entryId)
        .eq('status', 'submitted')

      btn.disabled    = false
      btn.textContent = 'Reject Entry'

      if (error) {
        Utils.showToast('Failed to reject.', 'error')
      } else {
        Utils.closeModal()
        Utils.showToast('Entry rejected.', 'success')
        _loadTeamTab()
      }
    })
  }

  /* ── Date helpers ──────────────────────────────────────────── */
  function _getMondayOf(date) {
    const d   = new Date(date)
    const day = d.getDay()
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
    d.setHours(0, 0, 0, 0)
    return d
  }

  function _toISO(date) {
    return date.toISOString().split('T')[0]
  }

  function _weekEnd() {
    const e = new Date(_weekStart)
    e.setDate(e.getDate() + 6)
    return e
  }

  function _weekLabel() {
    const opts = { month: 'short', day: 'numeric' }
    const s    = _weekStart.toLocaleDateString('en-IN', opts)
    const e    = _weekEnd().toLocaleDateString('en-IN', { ...opts, year: 'numeric' })
    return `${s} – ${e}`
  }

  return { render, init }
})()
