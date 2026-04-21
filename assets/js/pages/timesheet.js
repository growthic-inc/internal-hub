/* ============================================================
   TIMESHEET — Phase 1
   ============================================================ */

const Timesheet = (() => {

  let _user      = null
  let _entries   = []
  let _clients   = []
  let _weekStart = null
  let _activeTab = 'my'

  const CAN_APPROVE = ['super_admin', 'founders_office', 'team_lead', 'hr']

  const STATUS_BADGE = {
    draft:     'badge--muted',
    submitted: 'badge--warning',
    approved:  'badge--success',
    rejected:  'badge--danger',
  }

  function render(user) {
    const showTeam = CAN_APPROVE.includes(user.role)

    return `
      <div class="page-inner">

        ${showTeam ? `
          <div class="tabs">
            <button class="tab-btn tab-btn--active" id="ts-tab-my">My Timesheet</button>
            <button class="tab-btn" id="ts-tab-team">Team Submissions</button>
          </div>
        ` : ''}

        <!-- My Week Panel -->
        <div id="ts-my-panel">
          <div class="page-header">
            <div style="display:flex;align-items:center;gap:10px;">
              <button class="btn btn-secondary btn-sm" id="ts-prev">← Prev</button>
              <span id="ts-week-label" style="font-size:13px;font-weight:600;min-width:220px;text-align:center;">—</span>
              <button class="btn btn-secondary btn-sm" id="ts-next">Next →</button>
            </div>
            <div style="display:flex;gap:8px;">
              <button class="btn btn-secondary btn-sm" id="ts-submit-btn" style="display:none;">Submit Drafts</button>
              <button class="btn btn-primary btn-sm" id="ts-log-btn">+ Log Entry</button>
            </div>
          </div>
          <div id="ts-week-view" class="page-loading">Loading…</div>
        </div>

        <!-- Team Panel -->
        ${showTeam ? `
          <div id="ts-team-panel" style="display:none;">
            <div id="ts-team-view" class="page-loading">Loading…</div>
          </div>
        ` : ''}

      </div>

      <!-- Log Entry Modal -->
      <div class="modal-overlay" id="ts-modal-bg" style="display:none;">
        <div class="modal">
          <div class="modal-header">
            <h3 class="modal-title">Log Time Entry</h3>
            <button class="modal-close" id="ts-modal-x">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="modal-body">
            <div id="ts-modal-err" class="alert alert-danger" style="display:none;"></div>
            <div class="grid-2">
              <div class="form-group">
                <label class="form-label">Date <span style="color:var(--danger)">*</span></label>
                <input class="form-input" type="date" id="ts-f-date">
              </div>
              <div class="form-group">
                <label class="form-label">Hours <span style="color:var(--danger)">*</span></label>
                <input class="form-input" type="number" id="ts-f-hours" min="0.5" max="8" step="0.5" placeholder="Max 8h">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Client</label>
              <select class="form-select" id="ts-f-client">
                <option value="">— No client / Internal —</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Task Description <span style="color:var(--danger)">*</span></label>
              <textarea class="form-input form-textarea" id="ts-f-desc" placeholder="What did you work on?"></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" id="ts-modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="ts-modal-save">Save Entry</button>
          </div>
        </div>
      </div>

      <!-- Reject Comment Modal -->
      <div class="modal-overlay" id="ts-reject-bg" style="display:none;">
        <div class="modal">
          <div class="modal-header">
            <h3 class="modal-title">Reject Entry</h3>
            <button class="modal-close" id="ts-reject-x">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="modal-body">
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">Reason for rejection</label>
              <textarea class="form-input form-textarea" id="ts-reject-comment" placeholder="Explain why this entry is being rejected…"></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" id="ts-reject-cancel">Cancel</button>
            <button class="btn btn-danger" id="ts-reject-confirm">Reject Entry</button>
          </div>
        </div>
      </div>
    `
  }

  async function init(user) {
    _user      = user
    _weekStart = _getMondayOf(new Date())
    _activeTab = 'my'

    const [, clientRes] = await Promise.all([
      _loadWeek(),
      API.getClients(false),
    ])
    _clients = clientRes.data || []

    _bindWeekNav()
    _bindLogModal()

    if (CAN_APPROVE.includes(user.role)) {
      _bindTeamTabs()
    }
  }

  // ── Date helpers ─────────────────────────────────────────────

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

  // ── Load & render week ────────────────────────────────────────

  async function _loadWeek() {
    const label = document.getElementById('ts-week-label')
    if (label) label.textContent = _weekLabel()

    const view = document.getElementById('ts-week-view')
    if (view) { view.className = 'page-loading'; view.textContent = 'Loading…' }

    const { data, error } = await API.getTimesheetEntries(
      _user.id, _toISO(_weekStart), _toISO(_weekEnd())
    )
    if (error) { Utils.showToast('Failed to load timesheet', 'error'); return }
    _entries = data || []
    _renderWeek()
    _updateSubmitBtn()
  }

  function _renderWeek() {
    const view = document.getElementById('ts-week-view')
    if (!view) return

    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(_weekStart)
      d.setDate(d.getDate() + i)
      return d
    })

    const totalHours = _entries.reduce((s, e) => s + parseFloat(e.hours), 0)
    const drafts     = _entries.filter(e => e.status === 'draft').length
    const approved   = _entries.filter(e => e.status === 'approved').length

    view.className = ''
    view.innerHTML = `
      <div class="grid-3" style="margin-bottom:20px;">
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

      ${days.map(day => {
        const iso        = _toISO(day)
        const dayEntries = _entries.filter(e => e.date === iso)
        const dayLabel   = day.toLocaleDateString('en-IN', { weekday: 'long', month: 'short', day: 'numeric' })
        const isToday    = iso === _toISO(new Date())
        const dayHours   = dayEntries.reduce((s, e) => s + parseFloat(e.hours), 0)

        return `
          <div style="margin-bottom:16px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--border-light);">
              <span style="font-size:13px;font-weight:600;color:${isToday ? 'var(--primary)' : 'var(--text)'};">
                ${dayLabel}${isToday ? ' <span style="font-size:11px;font-weight:400;color:var(--secondary);">Today</span>' : ''}
              </span>
              ${dayHours > 0 ? `<span style="font-size:12px;font-weight:600;color:var(--text-muted);">${dayHours.toFixed(1)}h</span>` : ''}
            </div>
            ${dayEntries.length ? `
              <div class="table-wrap">
                <table class="table">
                  <tbody>
                    ${dayEntries.map(entry => `
                      <tr>
                        <td style="width:1%;white-space:nowrap;">
                          <span class="badge ${STATUS_BADGE[entry.status]}">${entry.status}</span>
                        </td>
                        <td>
                          <div style="font-size:13px;">${Utils.escapeHtml(entry.task_description)}</div>
                          ${entry.clients
                            ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${entry.clients.project_code} — ${entry.clients.client_name}</div>`
                            : ''}
                          ${entry.rejection_comment
                            ? `<div style="font-size:12px;color:var(--danger);margin-top:2px;">↳ ${Utils.escapeHtml(entry.rejection_comment)}</div>`
                            : ''}
                        </td>
                        <td style="width:1%;white-space:nowrap;text-align:right;font-weight:700;font-size:13px;">${entry.hours}h</td>
                        <td style="width:1%;white-space:nowrap;">
                          ${entry.status === 'draft' ? `
                            <button class="btn-icon-sm ts-delete" data-id="${entry.id}" title="Delete entry">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                            </button>
                          ` : ''}
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            ` : `
              <div style="font-size:13px;color:var(--text-muted);padding:8px 0;">No entries</div>
            `}
          </div>
        `
      }).join('')}
    `

    view.querySelectorAll('.ts-delete').forEach(btn =>
      btn.addEventListener('click', () => _deleteEntry(btn.dataset.id))
    )
  }

  function _updateSubmitBtn() {
    const btn    = document.getElementById('ts-submit-btn')
    if (!btn) return
    const drafts = _entries.filter(e => e.status === 'draft').length
    btn.style.display = drafts > 0 ? 'inline-flex' : 'none'
    if (drafts > 0) btn.textContent = `Submit ${drafts} Draft${drafts > 1 ? 's' : ''}`
  }

  // ── Week navigation ──────────────────────────────────────────

  function _bindWeekNav() {
    document.getElementById('ts-prev').addEventListener('click', () => {
      _weekStart.setDate(_weekStart.getDate() - 7)
      _loadWeek()
    })
    document.getElementById('ts-next').addEventListener('click', () => {
      _weekStart.setDate(_weekStart.getDate() + 7)
      _loadWeek()
    })
    const sub = document.getElementById('ts-submit-btn')
    if (sub) sub.addEventListener('click', _submitDrafts)
  }

  // ── Submit drafts ────────────────────────────────────────────

  async function _submitDrafts() {
    const drafts = _entries.filter(e => e.status === 'draft').map(e => e.id)
    if (!drafts.length) return
    const btn = document.getElementById('ts-submit-btn')
    btn.disabled    = true
    btn.textContent = 'Submitting…'

    const { error } = await Config.supabase
      .from('timesheets')
      .update({ status: 'submitted', updated_at: new Date().toISOString() })
      .in('id', drafts)
      .eq('employee_id', _user.id)

    btn.disabled = false
    if (error) {
      Utils.showToast('Failed to submit. Try again.', 'error')
    } else {
      Utils.showToast('Timesheet submitted for approval', 'success')
      await _loadWeek()
    }
  }

  // ── Delete entry ─────────────────────────────────────────────

  async function _deleteEntry(id) {
    const { error } = await Config.supabase
      .from('timesheets')
      .delete()
      .eq('id', id)
      .eq('employee_id', _user.id)
      .eq('status', 'draft')

    if (error) {
      Utils.showToast('Failed to delete entry', 'error')
    } else {
      _entries = _entries.filter(e => e.id !== id)
      _renderWeek()
      _updateSubmitBtn()
    }
  }

  // ── Log Entry modal ──────────────────────────────────────────

  function _bindLogModal() {
    const bg      = document.getElementById('ts-modal-bg')
    const saveBtn = document.getElementById('ts-modal-save')

    const _open = () => {
      const today        = _toISO(new Date())
      const weekStartISO = _toISO(_weekStart)
      const weekEndISO   = _toISO(_weekEnd())
      const defaultDate  = (today >= weekStartISO && today <= weekEndISO) ? today : weekStartISO

      document.getElementById('ts-f-date').value  = defaultDate
      document.getElementById('ts-f-date').min    = weekStartISO
      document.getElementById('ts-f-date').max    = weekEndISO
      document.getElementById('ts-f-hours').value = ''
      document.getElementById('ts-f-desc').value  = ''
      document.getElementById('ts-modal-err').style.display = 'none'

      const sel = document.getElementById('ts-f-client')
      sel.innerHTML = '<option value="">— No client / Internal —</option>' +
        _clients.map(c =>
          `<option value="${c.id}">${c.project_code} — ${Utils.escapeHtml(c.client_name)}</option>`
        ).join('')

      bg.style.display = 'flex'
    }

    const _close = () => { bg.style.display = 'none' }

    document.getElementById('ts-log-btn').addEventListener('click', _open)
    document.getElementById('ts-modal-x').addEventListener('click', _close)
    document.getElementById('ts-modal-cancel').addEventListener('click', _close)
    bg.addEventListener('click', e => { if (e.target === bg) _close() })

    saveBtn.addEventListener('click', async () => {
      const errEl    = document.getElementById('ts-modal-err')
      const date     = document.getElementById('ts-f-date').value
      const hours    = parseFloat(document.getElementById('ts-f-hours').value)
      const desc     = document.getElementById('ts-f-desc').value.trim()
      const clientId = document.getElementById('ts-f-client').value || null

      errEl.style.display = 'none'
      if (!date)                              { errEl.textContent = 'Please select a date.';                    errEl.style.display = 'block'; return }
      if (!desc)                              { errEl.textContent = 'Please enter a task description.';         errEl.style.display = 'block'; return }
      if (isNaN(hours) || hours <= 0 || hours > 8) { errEl.textContent = 'Hours must be between 0.5 and 8.'; errEl.style.display = 'block'; return }

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
        _close()
        Utils.showToast('Entry logged', 'success')
        await _loadWeek()
      }
    })
  }

  // ── Team tabs ────────────────────────────────────────────────

  function _bindTeamTabs() {
    const myBtn    = document.getElementById('ts-tab-my')
    const teamBtn  = document.getElementById('ts-tab-team')
    const myPanel  = document.getElementById('ts-my-panel')
    const teamPanel = document.getElementById('ts-team-panel')

    myBtn.addEventListener('click', () => {
      myBtn.classList.add('tab-btn--active')
      teamBtn.classList.remove('tab-btn--active')
      myPanel.style.display   = 'block'
      teamPanel.style.display = 'none'
      _activeTab = 'my'
    })

    teamBtn.addEventListener('click', async () => {
      teamBtn.classList.add('tab-btn--active')
      myBtn.classList.remove('tab-btn--active')
      myPanel.style.display   = 'none'
      teamPanel.style.display = 'block'
      _activeTab = 'team'
      await _loadTeamView()
    })
  }

  async function _loadTeamView() {
    const view = document.getElementById('ts-team-view')
    if (!view) return
    view.className   = 'page-loading'
    view.textContent = 'Loading team submissions…'

    const from = new Date()
    from.setDate(from.getDate() - 30)

    const { data, error } = await Config.supabase
      .from('timesheets')
      .select('*, employees(name), clients(client_name, project_code)')
      .in('status', ['submitted', 'approved', 'rejected'])
      .gte('date', _toISO(from))
      .order('date', { ascending: false })

    if (error) { Utils.showToast('Failed to load team data', 'error'); return }

    const entries = data || []
    view.className = ''

    if (!entries.length) {
      view.innerHTML = `<div class="empty-state"><h3>No submissions</h3><p>No submitted timesheets in the last 30 days.</p></div>`
      return
    }

    view.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Employee</th>
              <th>Client</th>
              <th>Task</th>
              <th style="text-align:right">Hours</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${entries.map(e => `
              <tr>
                <td style="white-space:nowrap;font-size:12px;">${e.date}</td>
                <td>${e.employees ? Utils.escapeHtml(e.employees.name) : '—'}</td>
                <td style="font-size:12px;color:var(--text-muted);">${e.clients ? e.clients.project_code : '—'}</td>
                <td style="max-width:260px;">${Utils.truncate(e.task_description, 60)}</td>
                <td style="text-align:right;font-weight:700;">${e.hours}h</td>
                <td><span class="badge ${STATUS_BADGE[e.status]}">${e.status}</span></td>
                <td style="white-space:nowrap;">
                  ${e.status === 'submitted' ? `
                    <button class="btn btn-secondary btn-sm ts-approve" data-id="${e.id}" style="margin-right:4px;">Approve</button>
                    <button class="btn btn-danger btn-sm ts-reject" data-id="${e.id}">Reject</button>
                  ` : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `

    view.querySelectorAll('.ts-approve').forEach(btn =>
      btn.addEventListener('click', () => _approveEntry(btn.dataset.id))
    )
    view.querySelectorAll('.ts-reject').forEach(btn =>
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
      Utils.showToast('Failed to approve', 'error')
    } else {
      Utils.showToast('Entry approved', 'success')
      await _loadTeamView()
    }
  }

  function _openRejectModal(entryId) {
    const bg = document.getElementById('ts-reject-bg')
    document.getElementById('ts-reject-comment').value = ''
    bg.style.display = 'flex'

    const confirmBtn = document.getElementById('ts-reject-confirm')
    const _close     = () => { bg.style.display = 'none' }

    document.getElementById('ts-reject-x').onclick      = _close
    document.getElementById('ts-reject-cancel').onclick = _close
    bg.onclick = e => { if (e.target === bg) _close() }

    // Replace confirm button to remove stale listeners
    const fresh = confirmBtn.cloneNode(true)
    confirmBtn.parentNode.replaceChild(fresh, confirmBtn)

    fresh.addEventListener('click', async () => {
      const comment = document.getElementById('ts-reject-comment').value.trim()
      fresh.disabled    = true
      fresh.textContent = 'Rejecting…'

      const { error } = await Config.supabase
        .from('timesheets')
        .update({
          status:            'rejected',
          rejection_comment: comment || null,
          updated_at:        new Date().toISOString(),
        })
        .eq('id', entryId)
        .eq('status', 'submitted')

      fresh.disabled    = false
      fresh.textContent = 'Reject Entry'

      if (error) {
        Utils.showToast('Failed to reject', 'error')
      } else {
        _close()
        Utils.showToast('Entry rejected', 'success')
        await _loadTeamView()
      }
    })
  }

  return { render, init }
})()
