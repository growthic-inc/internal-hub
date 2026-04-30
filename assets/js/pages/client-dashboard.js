/* ============================================================
   CLIENT DASHBOARD — real Supabase data
   KPIs, charts, top content, LinkedIn XLS upload pipeline.
   ============================================================ */

const ClientDashboard = (() => {

  const METRIC_CONFIG = {
    impressions:     { label: 'Impressions',     color: '#0F4799', field: 'impressions' },
    clicks:          { label: 'Clicks',          color: '#45BBF0', field: 'clicks' },
    reactions:       { label: 'Reactions',       color: '#1D9E75', field: 'reactions' },
    engagement_rate: { label: 'Engagement Rate', color: '#EF4444', field: 'engagement_rate', scale: 100 },
    comments:        { label: 'Comments',        color: '#8B5CF6', field: 'comments' },
    reposts_shares:  { label: 'Reposts',         color: '#F59E0B', field: 'reposts_shares' },
  }
  const METRIC_KEYS = Object.keys(METRIC_CONFIG)

  let _user = null, _p = null, _clients = [], _currentClient = null, _currentEntity = null
  let _currentPlatform = 'LinkedIn', _currentRange = '30', _currentMonth = _thisMonth()
  let _trendChart = null, _pubChart = null, _activeMetrics = ['impressions', 'clicks']

  /* ── render ─────────────────────────────────────────────── */
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

  /* ── init ───────────────────────────────────────────────── */
  async function init(user) {
    _user = user
    _p = {
      can_create: App.hasAccess('client_dashboard', 'upload_performance_data', 'can_upload'),
      can_edit:   App.hasAccess('client_dashboard', 'update_client_status',    'can_edit'),
    }
    _trendChart = null; _pubChart = null; _currentClient = null
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

  /* ── Client dropdown ────────────────────────────────────── */
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
      if (!document.getElementById('db-client-wrap')?.contains(e.target)) dropdown.style.display = 'none'
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
          document.getElementById('db-project-code').textContent = item.dataset.code
          const { data: full } = await API.getClientDashboard(item.dataset.id)
          _currentClient = full; _currentEntity = null
          const entities    = full?.client_entities || []
          const entityGroup = document.getElementById('db-entity-group')
          const entitySel   = document.getElementById('db-entity-select')
          if (entities.length > 1) {
            entitySel.innerHTML = entities.map(e => `<option value="${e.id}">${Utils.escapeHtml(e.entity_name)}</option>`).join('')
            _currentEntity = entities[0].id
            entityGroup.style.display = 'flex'
            entitySel.addEventListener('change', () => { _currentEntity = entitySel.value; _loadDashboard() })
          } else {
            entityGroup.style.display = 'none'
          }
          _loadDashboard()
        })
      })
    }
  }

  function _bindFilters() {
    document.getElementById('db-platform-select')?.addEventListener('change', e => { _currentPlatform = e.target.value; if (_currentClient) _loadDashboard() })
    document.getElementById('db-range-select')?.addEventListener('change',   e => { _currentRange    = e.target.value; if (_currentClient) _loadDashboard() })
  }

  function _getDateRange() {
    const dateTo = new Date(), dateFrom = new Date()
    dateFrom.setDate(dateTo.getDate() - (parseInt(_currentRange, 10) || 30))
    return { dateFrom: dateFrom.toISOString().split('T')[0], dateTo: dateTo.toISOString().split('T')[0] }
  }

  /* ── Load dashboard ─────────────────────────────────────── */
  async function _loadDashboard() {
    const body = document.getElementById('db-body')
    if (!body || !_currentClient) return
    body.innerHTML = '<p class="loading-text">Loading dashboard…</p>'

    const { dateFrom, dateTo } = _getDateRange()

    const [metricsRes, postsRes, reportsRes, uploadLogRes] = await Promise.all([
      API.getSocialMetrics(_currentClient.id, _currentPlatform, dateFrom, dateTo),
      API.getSocialPosts(_currentClient.id, _currentPlatform, dateFrom, dateTo),
      API.getMasterFolderFiles(_currentClient.id, _currentMonth, 'reports'),
      API.getAnalyticsUploadLog(_currentClient.id, _currentPlatform),
    ])
    const metrics   = metricsRes.data   || []
    const posts     = postsRes.data     || []
    const reports   = reportsRes.data   || []
    const uploadLog = uploadLogRes.data  || []

    if (!metrics.length && !posts.length) { _renderEmptyState(body); return }

    const kpis        = _computeKPIs(metrics, posts)
    const reportCount = reports.length

    body.innerHTML = `
      ${_renderDataBanner(uploadLog, dateFrom, dateTo)}

      <!-- Row 1: Status + KPIs -->
      <div style="display:flex;flex-direction:column;gap:16px;margin-bottom:16px;">
        ${_renderStatusCard()}
        <div class="kpi-grid">${_renderKPICards(kpis)}</div>
      </div>

      <!-- Row 2: Charts -->
      <div class="charts-row mb-4">
        <div class="chart-card">
          <div class="chart-card-header">
            <span class="chart-card-title">Performance Trend</span>
            <div class="chart-multi-select" id="trend-pills">
              ${METRIC_KEYS.map(k => `
                <span class="chart-metric-pill${_activeMetrics.includes(k) ? ' active' : ''}" data-metric="${k}">
                  ${Utils.escapeHtml(METRIC_CONFIG[k].label)}
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
            ${_renderTopContent(posts)}
          </div>
        </div>
      </div>
    `

    _initTrendChart(metrics)
    _initPubChart(posts)
    _bindStatusCard()
    _bindTrendPills(metrics)
  }

  /* ── Empty state ────────────────────────────────────────── */
  function _renderEmptyState(body) {
    body.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;text-align:center;">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--border)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:16px;"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
        <h3 style="margin:0 0 8px;font-size:16px;font-weight:600;color:var(--text);">No data uploaded yet</h3>
        <p style="margin:0 0 20px;font-size:14px;color:var(--text-muted);max-width:380px;">Upload a LinkedIn or Instagram analytics export to see performance data.</p>
        ${_p.can_create ? `<button class="btn btn--primary btn--sm" onclick="document.getElementById('db-upload-btn')?.click()">Upload Data</button>` : ''}
      </div>
    `
  }

  /* ── Data banner ────────────────────────────────────────── */
  function _renderDataBanner(uploadLog, dateFrom, dateTo) {
    const last = uploadLog[0]
    let lastText = ''
    if (last) {
      const name    = Utils.escapeHtml(last.uploaded_by_emp?.name || 'someone')
      const daysAgo = Math.round((Date.now() - new Date(last.uploaded_at).getTime()) / 86400000)
      const ago     = daysAgo === 0 ? 'today' : daysAgo === 1 ? '1 day ago' : `${daysAgo} days ago`
      lastText      = ` · Last uploaded ${ago} by ${name}`
    }
    return `
      <div class="sample-data-banner" style="background:var(--surface-alt,#f0f7ff);border-color:var(--primary,#0F4799)20;">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        Showing data for <strong>${Utils.escapeHtml(_currentPlatform)}</strong> · ${Utils.formatDate(dateFrom)} – ${Utils.formatDate(dateTo)}${lastText}
      </div>`
  }

  /* ── Status card ────────────────────────────────────────── */
  function _renderStatusCard() {
    const c         = _currentClient
    const statusVal = c.client_status || 'on_track'
    const statusMap = { on_track: ['On Track', 'status--on-track'], at_risk: ['At Risk', 'status--at-risk'], off_track: ['Off Track', 'status--off-track'] }
    const [slabel, scls] = statusMap[statusVal] || statusMap.on_track
    const updatedBy  = c.status_updater?.name || null
    const updatedAt  = c.client_status_updated_at ? Utils.formatDate(c.client_status_updated_at) : null
    return `
      <div class="client-status-card">
        <div class="client-status-badge ${scls}" id="status-badge">${slabel}</div>
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
    const sel = document.getElementById('status-select'), badge = document.getElementById('status-badge')
    if (!sel || !badge) return
    const statusMap = { on_track: ['On Track', 'status--on-track'], at_risk: ['At Risk', 'status--at-risk'], off_track: ['Off Track', 'status--off-track'] }
    sel.addEventListener('change', async () => {
      const val = sel.value
      const { error } = await API.updateClientStatus(_currentClient.id, val, _user.id)
      if (error) { Utils.showToast('Failed to update status.', 'error'); return }
      badge.textContent = statusMap[val][0]
      badge.className   = `client-status-badge ${statusMap[val][1]}`
      Utils.showToast('Client status updated.', 'success')
    })
  }

  /* ── KPI computation + cards ────────────────────────────── */
  function _computeKPIs(metrics, posts) {
    const sum  = (arr, key) => arr.reduce((a, r) => a + _num(r[key]), 0)
    const loc  = n => n.toLocaleString('en-IN')
    const avgEng = metrics.length ? ((sum(metrics, 'engagement_rate') / metrics.length) * 100).toFixed(2) + '%' : '0.00%'
    return [
      { label: 'Impressions',     value: loc(sum(metrics, 'impressions')), highlight: false },
      { label: 'Clicks',          value: loc(sum(metrics, 'clicks')),      highlight: false },
      { label: 'Reactions',       value: loc(sum(metrics, 'reactions')),   highlight: false },
      { label: 'Engagement Rate', value: avgEng,                           highlight: true  },
      { label: 'Posts Published', value: loc(posts.length),                highlight: false },
      { label: 'Total Follows',   value: loc(sum(posts, 'follows')),       highlight: false },
    ]
  }

  function _renderKPICards(kpis) {
    return kpis.map(k => `
      <div class="kpi-card${k.highlight ? ' kpi-card--highlight' : ''}">
        <div class="kpi-label">${Utils.escapeHtml(k.label)}</div>
        <div class="kpi-value">${Utils.escapeHtml(String(k.value))}</div>
      </div>`).join('')
  }

  /* ── Trend chart ────────────────────────────────────────── */
  function _initTrendChart(metrics) {
    if (_trendChart) { _trendChart.destroy(); _trendChart = null }
    const canvas = document.getElementById('trend-chart')
    if (!canvas || typeof Chart === 'undefined') return

    const labels   = metrics.map(r => _shortDate(r.date))
    const datasets = _activeMetrics.map(k => {
      const cfg   = METRIC_CONFIG[k]
      const scale = cfg.scale || 1
      return {
        label:            cfg.label,
        data:             metrics.map(r => _num(r[cfg.field]) * scale),
        borderColor:      cfg.color,
        backgroundColor:  cfg.color + '18',
        borderWidth:      2,
        pointRadius:      metrics.length > 60 ? 2 : 4,
        pointHoverRadius: 6,
        tension:          0.35,
        fill:             false,
      }
    })

    _trendChart = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend:  { position: 'bottom', labels: { font: { size: 11, family: 'Helvetica Neue, Helvetica, Arial, sans-serif' }, boxWidth: 12, padding: 14 } },
          tooltip: { mode: 'index', intersect: false },
        },
        scales: {
          x: { grid: { color: '#F1F5F9' }, ticks: { font: { size: 11 }, color: '#94A3B8', maxTicksLimit: 10 } },
          y: { grid: { color: '#F1F5F9' }, ticks: { font: { size: 11 }, color: '#94A3B8' }, beginAtZero: false },
        },
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
      },
    })
  }

  /* ── Publishing chart ───────────────────────────────────── */
  function _initPubChart(posts) {
    if (_pubChart) { _pubChart.destroy(); _pubChart = null }
    const canvas = document.getElementById('pub-chart')
    if (!canvas || typeof Chart === 'undefined') return

    const weekMap = {}
    posts.forEach(p => {
      if (!p.created_date) return
      const d = new Date(p.created_date), day = d.getDay()
      const mon = new Date(d); mon.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
      const key = mon.toISOString().split('T')[0]
      weekMap[key] = (weekMap[key] || 0) + 1
    })
    const weeks  = Object.keys(weekMap).sort()
    const labels = weeks.map(w => {
      const mon = new Date(w), sun = new Date(mon); sun.setDate(mon.getDate() + 6)
      return _shortDate(mon.toISOString()) + '–' + _shortDate(sun.toISOString())
    })
    const data = weeks.map(w => weekMap[w])

    _pubChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label:           'Posts Published',
          data,
          backgroundColor: '#0F4799',
          borderRadius:    4,
          borderSkipped:   false,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend:  { display: false },
          tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y} posts` } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#94A3B8' } },
          y: { grid: { color: '#F1F5F9' }, ticks: { font: { size: 11 }, color: '#94A3B8', stepSize: 1 }, beginAtZero: true },
        },
      },
    })
  }

  function _bindTrendPills(metrics) {
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
        _initTrendChart(metrics)
      })
    })
  }

  /* ── SOW progress ───────────────────────────────────────── */
  function _renderSOW(reportCount) {
    const sow = _currentClient.scope_of_work || []
    if (!sow.length) return '<p class="empty-state" style="padding:24px 0;">No scope of work defined.</p>'

    const reportPlanned   = 1
    const reportDelivered = Math.min(reportCount, reportPlanned)
    const reportPct       = Math.round((reportDelivered / reportPlanned) * 100)

    const postSow     = sow.find(s => s.deliverable_type?.toLowerCase().includes('post') || s.deliverable_type?.toLowerCase().includes('content'))
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

  /* ── Top content ────────────────────────────────────────── */
  function _renderTopContent(posts) {
    if (!posts.length) {
      return '<p style="padding:24px;color:var(--text-muted);font-size:13px;">No posts in selected range.</p>'
    }

    const top = posts.slice(0, 10)
    const CONTENT_TYPE_COLORS = { Video: '#8B5CF6', Image: '#0F4799', Text: '#64748B', Carousel: '#F59E0B' }

    return `
      <table class="data-table">
        <thead><tr>
          <th>Post Preview</th>
          <th>Type</th>
          <th>Posted By</th>
          <th>Date</th>
          <th style="text-align:right;">Impressions</th>
          <th style="text-align:right;">Likes</th>
          <th style="text-align:right;">Eng. Rate</th>
        </tr></thead>
        <tbody>
          ${top.map(p => {
            const title   = Utils.truncate(p.post_title || '(no title)', 80)
            const url     = p.post_url ? Utils.escapeHtml(p.post_url) : null
            const ct      = p.content_type || p.post_type || '—'
            const ctColor = CONTENT_TYPE_COLORS[ct] || '#64748B'
            const engRate = p.engagement_rate != null ? (_num(p.engagement_rate) * 100).toFixed(2) + '%' : '—'
            return `
              <tr>
                <td>
                  ${url
                    ? `<a href="${url}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;" title="${Utils.escapeHtml(p.post_title || '')}">${Utils.escapeHtml(title)}</a>`
                    : Utils.escapeHtml(title)}
                </td>
                <td><span style="font-size:11px;font-weight:600;color:${ctColor};">${Utils.escapeHtml(ct)}</span></td>
                <td style="white-space:nowrap;">${Utils.escapeHtml(p.posted_by || '—')}</td>
                <td style="white-space:nowrap;">${p.created_date ? Utils.formatDate(p.created_date) : '—'}</td>
                <td style="text-align:right;">${_num(p.impressions).toLocaleString('en-IN')}</td>
                <td style="text-align:right;">${_num(p.likes).toLocaleString('en-IN')}</td>
                <td style="text-align:right;font-weight:600;">${engRate}</td>
              </tr>
            `
          }).join('')}
        </tbody>
      </table>
    `
  }

  /* ── Upload Data modal ──────────────────────────────────── */
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
      <div class="modal-body" id="up-modal-body">
        <div class="form-group">
          <label class="form-label">Client</label>
          <select class="form-select" id="up-client">${clientOpts}</select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Platform</label>
            <select class="form-select" id="up-platform">
              <option value="LinkedIn">LinkedIn</option>
              <option value="Instagram">Instagram</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Project Code</label>
            <input class="form-input" type="text" id="up-code" value="${Utils.escapeHtml(_currentClient?.project_code || '')}" readonly style="background:var(--surface);color:var(--text-muted);" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Data File (Excel export from LinkedIn)</label>
          <div class="drag-drop-zone" id="up-drop-zone" style="cursor:pointer;">
            <input type="file" accept=".xlsx,.xls" id="up-file-input" style="position:absolute;inset:0;opacity:0;cursor:pointer;" />
            <div class="drag-drop-icon">📊</div>
            <div class="drag-drop-label">Drop file here or <span style="color:var(--primary);text-decoration:underline;">browse</span></div>
            <div class="drag-drop-hint">LinkedIn Analytics export (.xlsx)</div>
            <div class="drag-drop-file-name" id="up-file-name" style="display:none;font-weight:600;color:var(--text);margin-top:6px;"></div>
          </div>
        </div>
        <div id="up-preview" style="display:none;"></div>
        <div id="up-error" style="display:none;" class="alert alert-danger"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="up-submit-btn" disabled>Upload and Process</button>
      </div>
    `)

    let _parsedPayload = null

    document.getElementById('up-client')?.addEventListener('change', e => {
      const c = _clients.find(cl => cl.id === e.target.value)
      const codeEl = document.getElementById('up-code')
      if (c && codeEl) codeEl.value = c.project_code
      _resetPreview()
    })
    document.getElementById('up-platform')?.addEventListener('change', _resetPreview)
    document.getElementById('up-file-input')?.addEventListener('change', async e => {
      const file = e.target.files?.[0]; if (!file) return
      document.getElementById('up-file-name').textContent = file.name
      document.getElementById('up-file-name').style.display = 'block'
      _resetPreview(); await _parseFile(file)
    })
    document.getElementById('up-submit-btn')?.addEventListener('click', async () => {
      if (!_parsedPayload) return
      const clientId = document.getElementById('up-client')?.value
      const platform = document.getElementById('up-platform')?.value?.toLowerCase()
      await _doUpload({ ..._parsedPayload, client_id: clientId, platform })
    })

    function _resetPreview() {
      _parsedPayload = null
      const preview = document.getElementById('up-preview'), errEl = document.getElementById('up-error')
      if (preview) { preview.style.display = 'none'; preview.innerHTML = '' }
      if (errEl)   { errEl.style.display   = 'none'; errEl.textContent = '' }
      const btn = document.getElementById('up-submit-btn'); if (btn) btn.disabled = true
    }

    function _showError(msg) {
      const errEl = document.getElementById('up-error'); if (!errEl) return
      errEl.textContent = msg; errEl.style.display = 'block'
      const btn = document.getElementById('up-submit-btn'); if (btn) btn.disabled = true
    }

    async function _parseFile(file) {
      const platform = document.getElementById('up-platform')?.value
      if (platform === 'Instagram') { _showError('Instagram export parsing is not yet supported. Please upload a LinkedIn export.'); return }
      if (typeof XLSX === 'undefined') { _showError('SheetJS library is not loaded. Please refresh the page and try again.'); return }

      try {
        const buf        = await file.arrayBuffer()
        const wb         = XLSX.read(buf, { type: 'array', cellDates: false })
        const sheetNames = wb.SheetNames.map(n => n.trim())
        const metricsSheet = wb.Sheets[sheetNames.find(n => n.toLowerCase() === 'metrics')   || '']
        const postsSheet   = wb.Sheets[sheetNames.find(n => n.toLowerCase() === 'all posts') || '']
        if (!metricsSheet || !postsSheet) { _showError('Could not find "Metrics" and "All posts" sheets. Please upload a LinkedIn Analytics export.'); return }

        const metricsRows = XLSX.utils.sheet_to_json(metricsSheet, { header: 1, defval: '' })
        const postsRows   = XLSX.utils.sheet_to_json(postsSheet,   { header: 1, defval: '' })
        if (metricsRows.length < 3 || postsRows.length < 3) { _showError('The file appears to be empty or incorrectly formatted.'); return }

        const mHeaders = metricsRows[1].map(h => String(h).trim())
        const pHeaders = postsRows[1].map(h => String(h).trim())
        const mIdx = h => mHeaders.indexOf(h)
        const pIdx = h => pHeaders.indexOf(h)

        const metrics = []
        for (let i = 2; i < metricsRows.length; i++) {
          const row = metricsRows[i]
          const date = _parseDate(String(row[mIdx('Date')] || ''))
          if (!date) continue
          metrics.push({
            date,
            impressions:                _num(row[mIdx('Impressions (total)')]),
            reach:                      _num(row[mIdx('Unique impressions (organic)')]),
            clicks:                     _num(row[mIdx('Clicks (total)')]),
            reactions:                  _num(row[mIdx('Reactions (total)')]),
            comments:                   _num(row[mIdx('Comments (total)')]),
            reposts_shares:             _num(row[mIdx('Reposts (total)')]),
            follows:                    0,
            engagement_rate:            _num(row[mIdx('Engagement rate (total)')]),
            impressions_organic:        _num(row[mIdx('Impressions (organic)')]),
            impressions_sponsored:      _num(row[mIdx('Impressions (sponsored)')]),
            unique_impressions_organic: _num(row[mIdx('Unique impressions (organic)')]),
            clicks_organic:             _num(row[mIdx('Clicks (organic)')]),
            clicks_sponsored:           _num(row[mIdx('Clicks (sponsored)')]),
            reactions_organic:          _num(row[mIdx('Reactions (organic)')]),
            reactions_sponsored:        _num(row[mIdx('Reactions (sponsored)')]),
            comments_organic:           _num(row[mIdx('Comments (organic)')]),
            comments_sponsored:         _num(row[mIdx('Comments (sponsored)')]),
            reposts_organic:            _num(row[mIdx('Reposts (organic)')]),
            reposts_sponsored:          _num(row[mIdx('Reposts (sponsored)')]),
            engagement_rate_organic:    _num(row[mIdx('Engagement rate (organic)')]),
            engagement_rate_sponsored:  _num(row[mIdx('Engagement rate (sponsored)')]),
          })
        }

        const posts = []
        for (let i = 2; i < postsRows.length; i++) {
          const row = postsRows[i]
          if (!row[pIdx('Post link')]) continue
          const createdDate = _parseDate(String(row[pIdx('Created date')]))
          posts.push({
            post_title:          String(row[pIdx('Post title')] || '').slice(0, 2000),
            post_url:            String(row[pIdx('Post link')]  || ''),
            post_type:           String(row[pIdx('Post type')]  || ''),
            content_type:        String(row[pIdx('Content Type')] || ''),
            campaign_name:       String(row[pIdx('Campaign name')] || ''),
            posted_by:           String(row[pIdx('Posted by')] || ''),
            created_date:        createdDate,
            campaign_start_date: _parseDate(String(row[pIdx('Campaign start date')] || '')),
            campaign_end_date:   _parseDate(String(row[pIdx('Campaign end date')]   || '')),
            audience:            String(row[pIdx('Audience')] || ''),
            impressions:         _num(row[pIdx('Impressions')]),
            views:               _num(row[pIdx('Views')]),
            offsite_views:       _num(row[pIdx('Offsite Views')]),
            clicks:              _num(row[pIdx('Clicks')]),
            ctr:                 _num(row[pIdx('Click through rate (CTR)')]),
            likes:               _num(row[pIdx('Likes')]),
            comments:            _num(row[pIdx('Comments')]),
            reposts_shares:      _num(row[pIdx('Reposts')]),
            follows:             _num(row[pIdx('Follows')]),
            engagement_rate:     _num(row[pIdx('Engagement rate')]),
            saves:               0,
          })
        }

        if (!metrics.length && !posts.length) { _showError('No data rows found in the file. Please check the export format.'); return }

        const allDates = metrics.map(m => m.date).filter(Boolean).sort()
        const dFrom    = allDates[0] || '—', dTo = allDates[allDates.length - 1] || '—'
        _parsedPayload = { metrics, posts }

        const preview = document.getElementById('up-preview')
        if (preview) {
          preview.style.display = 'block'
          preview.innerHTML = `<div class="alert alert-info" style="margin-bottom:0;">
            <strong>Ready to upload.</strong> Found <strong>${metrics.length}</strong> days of metrics + <strong>${posts.length}</strong> posts.<br>
            Date range: <strong>${Utils.escapeHtml(dFrom)}</strong> to <strong>${Utils.escapeHtml(dTo)}</strong>.<br>
            <span style="color:var(--warning,#B45309);font-size:12px;">This will overwrite existing data in this date range for the selected client.</span>
          </div>`
        }
        const btn = document.getElementById('up-submit-btn'); if (btn) btn.disabled = false

      } catch (err) {
        console.error('[ClientDashboard] parse error', err)
        _showError('Failed to parse file: ' + (err.message || 'Unknown error.'))
      }
    }

    async function _doUpload(payload) {
      const btn = document.getElementById('up-submit-btn')
      if (btn) { btn.disabled = true; btn.textContent = 'Uploading…' }
      try {
        const result = await API.ingestAnalytics(payload)
        if (result.error || result.success === false) {
          if (btn) { btn.disabled = false; btn.textContent = 'Upload and Process' }
          _showError(result.error || result.message || 'Upload failed. Please try again.')
          return
        }
        Utils.closeModal()
        Utils.showToast('Data uploaded successfully.', 'success')
        _loadDashboard()
      } catch (err) {
        console.error('[ClientDashboard] upload error', err)
        if (btn) { btn.disabled = false; btn.textContent = 'Upload and Process' }
        _showError('Upload failed: ' + (err.message || 'Unknown error.'))
      }
    }
  }

  /* ── Helpers ────────────────────────────────────────────── */
  function _thisMonth() { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}` }
  function _num(val)    { const n = parseFloat(val); return isNaN(n) ? 0 : n }
  function _parseDate(str) {
    if (!str || typeof str !== 'string') return null
    const [m, d, y] = str.split('/'); if (!m || !d || !y) return null
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  function _shortDate(iso) {
    if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return iso
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  }

  return { render, init }
})()
