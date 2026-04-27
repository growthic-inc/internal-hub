/* ============================================================
   CLIENT DASHBOARD
   Real data: client info, SOW, report status, client status.
   Sample data: KPIs, charts, top content (until data ingestion built).
   ============================================================ */

const ClientDashboard = (() => {

  /* ── Sample performance data (placeholder until Upload Data built) ── */
  const SAMPLE = {
    kpi: [
      { key: 'likes',           label: 'Likes',             value: 3240,    delta: 14,  pos: true },
      { key: 'engagement',      label: 'Engagement',        value: 4870,    delta: 9,   pos: true },
      { key: 'impressions',     label: 'Impressions',       value: 112500,  delta: 21,  pos: true },
      { key: 'followersGained', label: 'Followers Gained',  value: 178,     delta: 6,   pos: true },
      { key: 'searchDiscovery', label: 'Search & Discovery',value: 1480,    delta: 18,  pos: true },
      { key: 'engagementRate',  label: 'Engagement Rate',   value: '6.84%', delta: 0.6, pos: true, highlight: true },
    ],
    trendLabels: ['Apr 1', 'Apr 7', 'Apr 14', 'Apr 21'],
    trendDatasets: {
      impressions:     { label: 'Impressions',       data: [24000, 31000, 28000, 35000], color: '#0F4799' },
      engagement:      { label: 'Engagement',        data: [980,   1200,  1050,  1380],  color: '#45BBF0' },
      likes:           { label: 'Likes',             data: [720,   890,   810,   980],   color: '#1D9E75' },
      followersGained: { label: 'Followers Gained',  data: [38,    52,    44,    62],    color: '#F59E0B' },
      searchDiscovery: { label: 'Search & Discovery',data: [310,   380,   355,   435],   color: '#8B5CF6' },
      engagementRate:  { label: 'Engagement Rate',   data: [5.8,   6.2,   5.9,   7.1],  color: '#EF4444' },
    },
    publishing: {
      labels: ['Apr 1–7', 'Apr 8–14', 'Apr 15–21', 'Apr 22–28'],
      data:   [6, 9, 7, 8],
    },
    topContent: [
      { preview: 'How Crystal Crop is transforming Indian agriculture…', platform: 'LinkedIn',  engagement: 1840, impressions: 42300 },
      { preview: 'Meet the MD: Ankur Aggarwal on sustainable farming',   platform: 'LinkedIn',  engagement: 1240, impressions: 31500 },
      { preview: 'Crop protection starts with awareness',                 platform: 'Instagram', engagement: 980,  impressions: 18700 },
    ],
  }

  const METRIC_KEYS = ['impressions', 'engagement', 'likes', 'followersGained', 'searchDiscovery', 'engagementRate']

  let _user            = null
  let _p               = null  // department permissions
  let _clients         = []
  let _currentClient   = null
  let _currentEntity   = null
  let _currentPlatform = 'LinkedIn'
  let _currentRange    = '30'
  let _currentMonth    = _thisMonth()
  let _trendChart      = null
  let _pubChart        = null
  let _activeMetrics   = ['impressions', 'engagement']

  /* ── render ──────────────────────────────────────────────── */
  function render(user) {
    return `
      <div class="page-inner" style="max-width:1400px;">
        <!-- Filter bar -->
        <div class="db-filter-bar" id="db-filter-bar">
          <!-- Client custom dropdown -->
          <div class="db-filter-group" style="min-width:200px;">
            <span class="db-filter-label">Client</span>
            <div class="custom-select-wrap" id="db-client-wrap" style="min-width:0;">
              <button class="custom-select-btn db-filter-select" style="height:34px;font-size:13px;" id="db-client-btn">
                <span id="db-client-label" style="overflow:hidden;text-overflow:ellipsis;">Select client</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </button>
              <div class="custom-select-dropdown" id="db-client-dropdown" style="display:none;min-width:240px;">
                <input class="custom-select-search" id="db-client-search" placeholder="Search client…" autocomplete="off" />
                <div class="custom-select-list" id="db-client-list"></div>
              </div>
            </div>
          </div>

          <!-- Entity (hidden until client with entities selected) -->
          <div class="db-filter-group" id="db-entity-group" style="display:none;min-width:160px;">
            <span class="db-filter-label">Entity</span>
            <select class="db-filter-select" id="db-entity-select"></select>
          </div>

          <!-- Platform -->
          <div class="db-filter-group" style="min-width:120px;">
            <span class="db-filter-label">Platform</span>
            <select class="db-filter-select" id="db-platform-select">
              <option value="LinkedIn">LinkedIn</option>
              <option value="Instagram">Instagram</option>
            </select>
          </div>

          <!-- Project code (readonly) -->
          <div class="db-filter-group" style="min-width:100px;">
            <span class="db-filter-label">Project Code</span>
            <div class="db-filter-readonly" id="db-project-code">—</div>
          </div>

          <div class="db-filter-sep"></div>

          <!-- Date range -->
          <div class="db-filter-group" style="min-width:140px;">
            <span class="db-filter-label">Date Range</span>
            <select class="db-filter-select" id="db-range-select">
              <option value="7">Last 7 Days</option>
              <option value="30" selected>Last 30 Days</option>
              <option value="90">Last 90 Days</option>
              <option value="custom">Custom Range</option>
            </select>
          </div>

          <!-- Actions -->
          <div class="db-filter-actions">
            <button class="btn btn--primary btn--sm" id="db-upload-btn">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
              Upload Data
            </button>
          </div>
        </div>

        <!-- Dashboard body -->
        <div id="db-body">
          <div class="empty-state-full">
            <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--border)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
            <p style="color:var(--text-muted);font-size:14px;">Select a client to view the dashboard</p>
          </div>
        </div>
      </div>
    `
  }

  /* ── init ────────────────────────────────────────────────── */
  async function init(user) {
    _user          = user
    _p             = App.getPerms('client_dashboard')
    _trendChart    = null
    _pubChart      = null
    _currentClient = null

    const { data } = await API.getClients()
    _clients = data || []

    _bindClientDropdown()
    _bindFilters()

    if (_p.can_create) {
      document.getElementById('db-upload-btn')?.addEventListener('click', _openUploadModal)
    } else {
      document.getElementById('db-upload-btn')?.remove()
    }
  }

  /* ── Client dropdown ─────────────────────────────────────── */
  function _bindClientDropdown() {
    const btn      = document.getElementById('db-client-btn')
    const dropdown = document.getElementById('db-client-dropdown')
    const search   = document.getElementById('db-client-search')
    const list     = document.getElementById('db-client-list')

    _renderClientList(_clients)

    btn.addEventListener('click', e => {
      e.stopPropagation()
      const open = dropdown.style.display !== 'none'
      dropdown.style.display = open ? 'none' : 'block'
      if (!open) { search.value = ''; _renderClientList(_clients); search.focus() }
    })

    search.addEventListener('input', () => {
      const q = search.value.toLowerCase()
      _renderClientList(_clients.filter(c => c.client_name.toLowerCase().includes(q) || c.project_code.toLowerCase().includes(q)))
    })

    document.addEventListener('click', e => {
      if (!document.getElementById('db-client-wrap')?.contains(e.target)) {
        if (dropdown) dropdown.style.display = 'none'
      }
    })

    function _renderClientList(clients) {
      list.innerHTML = clients.length
        ? clients.map(c => `
            <div class="custom-select-item" data-id="${c.id}" data-name="${Utils.escapeHtml(c.client_name)}" data-code="${c.project_code}">
              <span>${Utils.escapeHtml(c.client_name)}</span>
              <span class="text-muted text-sm">${c.project_code}</span>
            </div>`).join('')
        : '<div class="custom-select-empty">No clients found</div>'

      list.querySelectorAll('.custom-select-item').forEach(item => {
        item.addEventListener('click', async () => {
          dropdown.style.display = 'none'
          document.getElementById('db-client-label').textContent = item.dataset.name
          document.getElementById('db-project-code').textContent  = item.dataset.code

          const { data: full } = await API.getClientDashboard(item.dataset.id)
          _currentClient = full
          _currentEntity = null

          const entities = full?.client_entities || []
          const entityGroup = document.getElementById('db-entity-group')
          const entitySel   = document.getElementById('db-entity-select')

          if (entities.length > 1) {
            entitySel.innerHTML = entities.map(e =>
              `<option value="${e.id}">${Utils.escapeHtml(e.entity_name)}</option>`
            ).join('')
            _currentEntity = entities[0].id
            entityGroup.style.display = 'flex'
            entitySel.addEventListener('change', () => {
              _currentEntity = entitySel.value
              _loadDashboard()
            })
          } else {
            entityGroup.style.display = 'none'
          }

          _loadDashboard()
        })
      })
    }
  }

  function _bindFilters() {
    document.getElementById('db-platform-select')?.addEventListener('change', e => {
      _currentPlatform = e.target.value
      if (_currentClient) _loadDashboard()
    })
    document.getElementById('db-range-select')?.addEventListener('change', e => {
      _currentRange = e.target.value
      if (_currentClient) _loadDashboard()
    })
  }

  /* ── Load dashboard ──────────────────────────────────────── */
  async function _loadDashboard() {
    const body = document.getElementById('db-body')
    if (!body || !_currentClient) return
    body.innerHTML = '<p class="loading-text">Loading dashboard…</p>'

    const { data: reports } = await API.getMasterFolderFiles(_currentClient.id, _currentMonth, 'reports')
    const reportCount = (reports || []).length

    body.innerHTML = `
      <!-- Sample data notice -->
      <div class="sample-data-banner">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
        Performance metrics are showing sample data. Use <strong>Upload Data</strong> to load real numbers.
      </div>

      <!-- Row 1: Status + KPIs -->
      <div style="display:flex;flex-direction:column;gap:16px;margin-bottom:16px;">
        ${_renderStatusCard()}
        <div class="kpi-grid">${_renderKPICards()}</div>
      </div>

      <!-- Row 2: Charts -->
      <div class="charts-row mb-4">
        <div class="chart-card">
          <div class="chart-card-header">
            <span class="chart-card-title">Performance Trend</span>
            <div class="chart-multi-select" id="trend-pills">
              ${METRIC_KEYS.map(k => `
                <span class="chart-metric-pill${_activeMetrics.includes(k) ? ' active' : ''}" data-metric="${k}">
                  ${SAMPLE.trendDatasets[k].label}
                </span>`).join('')}
            </div>
          </div>
          <div class="chart-canvas-wrap"><canvas id="trend-chart"></canvas></div>
        </div>
        <div class="chart-card">
          <div class="chart-card-header">
            <span class="chart-card-title">Weekly Publishing Activity</span>
          </div>
          <div class="chart-canvas-wrap"><canvas id="pub-chart"></canvas></div>
        </div>
      </div>

      <!-- Row 3: SOW + Top Content -->
      <div class="charts-row mb-4">
        <div class="section-card">
          <div class="section-card-header"><h3>SOW Progress</h3></div>
          <div class="section-card-body">
            ${_renderSOW(reportCount)}
          </div>
        </div>
        <div class="section-card">
          <div class="section-card-header"><h3>Top Performing Content</h3></div>
          <div class="section-card-body" style="padding:0;">
            ${_renderTopContent()}
          </div>
        </div>
      </div>
    `

    _initTrendChart()
    _initPubChart()
    _bindStatusCard()
    _bindTrendPills()
  }

  /* ── Status card ─────────────────────────────────────────── */
  function _renderStatusCard() {
    const c = _currentClient
    const statusVal = c.client_status || 'on_track'
    const statusMap = {
      on_track:  { label: 'On Track',  cls: 'status--on-track'  },
      at_risk:   { label: 'At Risk',   cls: 'status--at-risk'   },
      off_track: { label: 'Off Track', cls: 'status--off-track' },
    }
    const s = statusMap[statusVal]
    const updatedBy  = c.status_updater?.name || null
    const updatedAt  = c.client_status_updated_at ? Utils.formatDate(c.client_status_updated_at) : null

    return `
      <div class="client-status-card">
        <div class="client-status-badge ${s.cls}" id="status-badge">${s.label}</div>
        ${_p.can_edit ? `
          <select class="client-status-select" id="status-select">
            <option value="on_track"  ${statusVal === 'on_track'  ? 'selected' : ''}>On Track</option>
            <option value="at_risk"   ${statusVal === 'at_risk'   ? 'selected' : ''}>At Risk</option>
            <option value="off_track" ${statusVal === 'off_track' ? 'selected' : ''}>Off Track</option>
          </select>
        ` : ''}
        ${updatedBy && updatedAt
          ? `<div class="client-status-meta">Last updated by ${Utils.escapeHtml(updatedBy)} on ${updatedAt}</div>`
          : `<div class="client-status-meta">Status not yet updated</div>`}
      </div>
    `
  }

  function _bindStatusCard() {
    const sel = document.getElementById('status-select')
    const badge = document.getElementById('status-badge')
    if (!sel || !badge) return

    sel.addEventListener('change', async () => {
      const val = sel.value
      const { error } = await API.updateClientStatus(_currentClient.id, val, _user.id)
      if (error) { Utils.showToast('Failed to update status.', 'error'); return }

      const map = { on_track: ['On Track', 'status--on-track'], at_risk: ['At Risk', 'status--at-risk'], off_track: ['Off Track', 'status--off-track'] }
      badge.textContent = map[val][0]
      badge.className = `client-status-badge ${map[val][1]}`
      Utils.showToast('Client status updated.', 'success')
    })
  }

  /* ── KPI cards ───────────────────────────────────────────── */
  function _renderKPICards() {
    return SAMPLE.kpi.map(k => `
      <div class="kpi-card${k.highlight ? ' kpi-card--highlight' : ''}">
        <div class="kpi-label">${k.label}</div>
        <div class="kpi-value">${typeof k.value === 'number' ? k.value.toLocaleString('en-IN') : k.value}</div>
        <div class="kpi-delta kpi-delta--${k.pos ? 'up' : 'down'}">
          ${k.pos
            ? '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>'
            : '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>'}
          ${k.delta}%
        </div>
      </div>
    `).join('')
  }

  /* ── Charts ──────────────────────────────────────────────── */
  function _initTrendChart() {
    if (_trendChart) { _trendChart.destroy(); _trendChart = null }
    const canvas = document.getElementById('trend-chart')
    if (!canvas || typeof Chart === 'undefined') return

    const datasets = _activeMetrics.map(k => {
      const d = SAMPLE.trendDatasets[k]
      return {
        label:           d.label,
        data:            d.data,
        borderColor:     d.color,
        backgroundColor: d.color + '18',
        borderWidth:     2,
        pointRadius:     4,
        pointHoverRadius: 6,
        tension:         0.35,
        fill:            false,
      }
    })

    _trendChart = new Chart(canvas, {
      type: 'line',
      data: { labels: SAMPLE.trendLabels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 11, family: 'Helvetica Neue, Helvetica, Arial, sans-serif' }, boxWidth: 12, padding: 14 } },
          tooltip: { mode: 'index', intersect: false },
        },
        scales: {
          x: { grid: { color: '#F1F5F9' }, ticks: { font: { size: 11 }, color: '#94A3B8' } },
          y: { grid: { color: '#F1F5F9' }, ticks: { font: { size: 11 }, color: '#94A3B8' }, beginAtZero: false },
        },
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
      },
    })
  }

  function _initPubChart() {
    if (_pubChart) { _pubChart.destroy(); _pubChart = null }
    const canvas = document.getElementById('pub-chart')
    if (!canvas || typeof Chart === 'undefined') return

    _pubChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels:   SAMPLE.publishing.labels,
        datasets: [{
          label:           'Posts Published',
          data:            SAMPLE.publishing.data,
          backgroundColor: '#0F4799',
          borderRadius:    4,
          borderSkipped:   false,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y} posts` } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#94A3B8' } },
          y: { grid: { color: '#F1F5F9' }, ticks: { font: { size: 11 }, color: '#94A3B8', stepSize: 2 }, beginAtZero: true },
        },
      },
    })
  }

  function _bindTrendPills() {
    document.querySelectorAll('.chart-metric-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const key = pill.dataset.metric
        if (_activeMetrics.includes(key)) {
          if (_activeMetrics.length === 1) return
          _activeMetrics = _activeMetrics.filter(m => m !== key)
          pill.classList.remove('active')
        } else {
          _activeMetrics.push(key)
          pill.classList.add('active')
        }
        _initTrendChart()
      })
    })
  }

  /* ── SOW progress ────────────────────────────────────────── */
  function _renderSOW(reportCount) {
    const sow = _currentClient.scope_of_work || []
    if (!sow.length) return '<p class="empty-state" style="padding:24px 0;">No scope of work defined.</p>'

    const reportPlanned   = 1
    const reportDelivered = Math.min(reportCount, reportPlanned)
    const reportPct       = Math.round((reportDelivered / reportPlanned) * 100)

    const postSow = sow.find(s => s.deliverable_type?.toLowerCase().includes('post') || s.deliverable_type?.toLowerCase().includes('content'))
    const postPlanned = postSow?.agreed_monthly_quantity || 0

    return `
      <div class="sow-section">
        ${postSow ? `
          <div class="sow-row-item">
            <div class="sow-row-top">
              <span class="sow-row-name">Posts</span>
              <span class="sow-row-fraction">— / ${postPlanned} planned</span>
              <span class="sow-row-pct text-muted">—</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width:0%"></div>
            </div>
          </div>
        ` : ''}
        <div class="sow-row-item">
          <div class="sow-row-top">
            <span class="sow-row-name">Monthly Reports</span>
            <span class="sow-row-fraction">${reportDelivered} / ${reportPlanned} planned</span>
            <span class="sow-row-pct${reportPct === 0 ? ' sow-row-pct--danger' : ''}">${reportPct}%</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill${reportPct === 100 ? ' progress-fill--success' : ''}" style="width:${reportPct}%"></div>
          </div>
          ${reportDelivered === 0 ? '<p style="font-size:11px;color:var(--danger);margin-top:4px;">Not Uploaded</p>' : ''}
        </div>
      </div>
    `
  }

  /* ── Top content ─────────────────────────────────────────── */
  function _renderTopContent() {
    return `
      <table class="data-table">
        <thead><tr>
          <th>Post Preview</th>
          <th>Platform</th>
          <th style="text-align:right;">Engagement</th>
          <th style="text-align:right;">Impressions</th>
        </tr></thead>
        <tbody>
          ${SAMPLE.topContent.map(r => `
            <tr>
              <td>
                <div class="top-content-preview">
                  <div class="top-content-thumb">📝</div>
                  <span class="top-content-text">${Utils.escapeHtml(r.preview)}</span>
                </div>
              </td>
              <td>
                <span class="platform-pill platform-pill--${r.platform.toLowerCase()}">
                  ${Utils.escapeHtml(r.platform)}
                </span>
              </td>
              <td style="text-align:right;font-weight:600;">${r.engagement.toLocaleString('en-IN')}</td>
              <td style="text-align:right;">${r.impressions.toLocaleString('en-IN')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `
  }

  /* ── Upload Data modal (placeholder) ─────────────────────── */
  function _openUploadModal() {
    const clientOpts = _clients.map(c =>
      `<option value="${c.id}"${_currentClient?.id === c.id ? ' selected' : ''}>${Utils.escapeHtml(c.client_name)}</option>`
    ).join('')

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Upload Performance Data</h3>
        <button class="modal-close" onclick="Utils.closeModal()">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Client</label>
          <select class="form-select" id="up-client">${clientOpts}</select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Platform</label>
            <select class="form-select" id="up-platform">
              <option>LinkedIn</option>
              <option>Instagram</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Project Code</label>
            <input class="form-input" type="text" id="up-code" value="${Utils.escapeHtml(_currentClient?.project_code || '')}" readonly style="background:var(--surface);color:var(--text-muted);" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Data File (Excel / CSV)</label>
          <div class="drag-drop-zone" id="up-drop-zone">
            <input type="file" accept=".xlsx,.xls,.csv" id="up-file-input" />
            <div class="drag-drop-icon">📊</div>
            <div class="drag-drop-label">Drop file here or <span>browse</span></div>
            <div class="drag-drop-hint">Accepts .xlsx, .xls, .csv</div>
            <div class="drag-drop-file-name" id="up-file-name" style="display:none;"></div>
          </div>
        </div>
        <div class="alert alert-info" style="margin-bottom:0;">
          <strong>Coming soon.</strong> The data processing pipeline is being built. Upload functionality will be enabled in the next release.
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn-primary" disabled>Upload and Process</button>
      </div>
    `)

    document.getElementById('up-file-input')?.addEventListener('change', e => {
      const file = e.target.files?.[0]
      const nameEl = document.getElementById('up-file-name')
      if (file && nameEl) { nameEl.textContent = file.name; nameEl.style.display = 'block' }
    })

    document.getElementById('up-client')?.addEventListener('change', e => {
      const c = _clients.find(cl => cl.id === e.target.value)
      const codeEl = document.getElementById('up-code')
      if (c && codeEl) codeEl.value = c.project_code
    })
  }

  /* ── Helpers ─────────────────────────────────────────────── */
  function _thisMonth() {
    const n = new Date()
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
  }

  return { render, init }
})()
