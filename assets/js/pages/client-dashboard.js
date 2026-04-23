/* ============================================================
   CLIENT DASHBOARD
   Placeholder: client info, SOW, report status.
   Performance metrics show empty states until data is ingested.
   ============================================================ */

const ClientDashboard = (() => {

  let _user    = null
  let _clients = []

  /* ── render ──────────────────────────────────────────────── */
  function render(user) {
    return `
      <div class="page-inner">
        <div class="page-toolbar">
          <select class="form-select" id="dashboard-client-select" style="max-width:300px;">
            <option value="">— Select a client —</option>
          </select>
          <select class="form-select" id="dashboard-month-select" style="max-width:200px;">
            ${_buildMonthOptions()}
          </select>
        </div>
        <div id="dashboard-content" class="mt-4">
          <div class="empty-state-full">
            <p>Select a client above to view their dashboard</p>
          </div>
        </div>
      </div>
    `
  }

  /* ── init ────────────────────────────────────────────────── */
  async function init(user) {
    _user = user

    const { data } = await API.getClients()
    _clients = data || []

    const sel = document.getElementById('dashboard-client-select')
    if (sel) {
      sel.innerHTML = '<option value="">— Select a client —</option>' +
        _clients.map(c =>
          `<option value="${c.id}">${Utils.escapeHtml(c.client_name)} (${c.project_code})</option>`
        ).join('')
      sel.addEventListener('change', _onClientChange)
    }

    document.getElementById('dashboard-month-select')
      ?.addEventListener('change', _onMonthChange)
  }

  function _onClientChange(e) {
    if (e.target.value) _loadDashboard(e.target.value)
    else document.getElementById('dashboard-content').innerHTML =
      '<div class="empty-state-full"><p>Select a client above to view their dashboard</p></div>'
  }

  function _onMonthChange() {
    const clientId = document.getElementById('dashboard-client-select')?.value
    if (clientId) _loadDashboard(clientId)
  }

  /* ── Load dashboard ──────────────────────────────────────── */
  async function _loadDashboard(clientId) {
    const content = document.getElementById('dashboard-content')
    content.innerHTML = '<p class="loading-text">Loading…</p>'

    const month = document.getElementById('dashboard-month-select')?.value || _currentMonthValue()

    const [clientRes, filesRes] = await Promise.all([
      API.getClientDashboard(clientId),
      API.getMasterFolderFiles(clientId, month, 'reports'),
    ])

    const client    = clientRes.data
    const reports   = filesRes.data || []

    if (!client) {
      content.innerHTML = '<p class="empty-state">Failed to load client data.</p>'
      return
    }

    const hasReport = reports.length > 0
    const sow       = client.scope_of_work || []
    const entities  = client.client_entities || []
    const platforms = client.client_platforms || []

    content.innerHTML = `
      <div class="dashboard-grid">

        <!-- Client Info Card -->
        <div class="section-card dashboard-card--wide">
          <div class="section-card-header">
            <h3>Client Overview</h3>
            <span class="badge badge--${_statusBadgeType(client.status)}">${client.status}</span>
          </div>
          <div class="section-card-body">
            <div class="info-grid-4">
              <div>
                <span class="info-label">Client Name</span>
                <span class="info-value">${Utils.escapeHtml(client.client_name)}</span>
              </div>
              <div>
                <span class="info-label">Project Code</span>
                <span class="info-value"><code>${client.project_code}</code></span>
              </div>
              <div>
                <span class="info-label">Category</span>
                <span class="info-value">${client.category || '—'}</span>
              </div>
              <div>
                <span class="info-label">Account Manager</span>
                <span class="info-value">${Utils.escapeHtml(client.account_manager?.name || '—')}</span>
              </div>
              <div>
                <span class="info-label">Entities</span>
                <span class="info-value">${entities.length
                  ? entities.map(e => Utils.escapeHtml(e.entity_name)).join(', ')
                  : '—'}</span>
              </div>
              <div>
                <span class="info-label">Platforms</span>
                <span class="info-value">${platforms.length
                  ? platforms.map(p => Utils.escapeHtml(p.platform_name)).join(', ')
                  : '—'}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- SOW Card -->
        <div class="section-card">
          <div class="section-card-header">
            <h3>Scope of Work</h3>
            <span class="text-muted text-sm">Committed monthly deliverables</span>
          </div>
          <div class="section-card-body">
            ${sow.length ? `
              <table class="data-table">
                <thead><tr>
                  <th>Platform</th>
                  <th>Deliverable</th>
                  <th>Qty / Month</th>
                </tr></thead>
                <tbody>
                  ${sow.map(s => `
                    <tr>
                      <td>${Utils.escapeHtml(s.platform)}</td>
                      <td>${Utils.escapeHtml(s.deliverable_type)}</td>
                      <td><strong>${s.agreed_monthly_quantity}</strong></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            ` : '<p class="empty-state">No scope of work defined yet.</p>'}
          </div>
        </div>

        <!-- Report Status Card -->
        <div class="section-card">
          <div class="section-card-header">
            <h3>Report Status</h3>
            <span class="text-muted text-sm">${_formatMonthDisplay(month)}</span>
          </div>
          <div class="section-card-body">
            ${hasReport ? `
              <div class="status-check status-check--ok">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                <div>
                  <p class="status-check-title">Report uploaded</p>
                  <p class="status-check-sub">${reports.length} file${reports.length !== 1 ? 's' : ''} · Latest by ${Utils.escapeHtml(reports[0].employees?.name || '—')} on ${Utils.formatDate(reports[0].uploaded_at)}</p>
                </div>
              </div>
            ` : `
              <div class="status-check status-check--pending">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                <div>
                  <p class="status-check-title">No report uploaded yet</p>
                  <p class="status-check-sub">Upload a report in Client Repository to update this status</p>
                </div>
              </div>
            `}
          </div>
        </div>

        <!-- Performance Metrics — Empty State -->
        <div class="section-card dashboard-card--wide">
          <div class="section-card-header">
            <h3>Performance Metrics</h3>
            <span class="text-muted text-sm">${_formatMonthDisplay(month)}</span>
          </div>
          <div class="section-card-body">
            <div class="metrics-empty-state">
              <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
              <p class="metrics-empty-title">Performance data not yet available</p>
              <p class="metrics-empty-sub">Once performance reports are uploaded for this client, metrics will appear here automatically — impressions, engagement rate, follower growth, and top posts per platform.</p>
            </div>
          </div>
        </div>

      </div>
    `
  }

  /* ── Helpers ─────────────────────────────────────────────── */
  function _statusBadgeType(status) {
    const map = { active: 'success', paused: 'warning', inactive: 'muted', archived: 'muted' }
    return map[status] || 'muted'
  }

  function _currentMonthValue() {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  }

  function _buildMonthOptions() {
    const opts = []
    const now  = new Date()
    for (let i = 0; i < 12; i++) {
      const d     = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const label = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
      opts.push(`<option value="${value}"${i === 0 ? ' selected' : ''}>${label}</option>`)
    }
    return opts.join('')
  }

  function _formatMonthDisplay(yyyyMm) {
    const [y, m] = yyyyMm.split('-')
    return new Date(parseInt(y), parseInt(m) - 1, 1)
      .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
  }

  return { render, init }
})()
