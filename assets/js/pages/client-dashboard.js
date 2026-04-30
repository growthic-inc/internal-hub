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
  let _trendChart = null, _pubChart = null, _followersChart = null, _visitorsChart = null
  let _activeMetrics = ['impressions', 'clicks']

  /* ── render ─────────────────────────────────────────────── */
  function render(user) {
    return `
      <div class="page-inner" style="max-width:1400px;">
        <div class="db-filter-bar" id="db-filter-bar">
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
          <div class="db-filter-group" id="db-entity-group" style="display:none;min-width:160px;">
            <span class="db-filter-label">Entity</span>
            <select class="db-filter-select" id="db-entity-select"></select>
          </div>
          <div class="db-filter-group" style="min-width:120px;">
            <span class="db-filter-label">Platform</span>
            <select class="db-filter-select" id="db-platform-select">
              <option value="LinkedIn">LinkedIn</option>
              <option value="Instagram">Instagram</option>
            </select>
          </div>
          <div class="db-filter-group" style="min-width:100px;">
            <span class="db-filter-label">Project Code</span>
            <div class="db-filter-readonly" id="db-project-code">—</div>
          </div>
          <div class="db-filter-sep"></div>
          <div class="db-filter-group" style="min-width:140px;">
            <span class="db-filter-label">Date Range</span>
            <select class="db-filter-select" id="db-range-select">
              <option value="7">Last 7 Days</option>
              <option value="30" selected>Last 30 Days</option>
              <option value="90">Last 90 Days</option>
              <option value="custom">Custom Range</option>
            </select>
          </div>
          <div class="db-filter-actions">
            <button class="btn btn--primary btn--sm" id="db-upload-btn">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
              Upload Data
            </button>
          </div>
        </div>
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
    _trendChart = null; _pubChart = null; _followersChart = null; _visitorsChart = null; _currentClient = null
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
    const btn = document.getElementById('db-client-btn'), dropdown = document.getElementById('db-client-dropdown')
    const search = document.getElementById('db-client-search'), list = document.getElementById('db-client-list')
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
        ? clients.map(c => `<div class="custom-select-item" data-id="${c.id}" data-name="${Utils.escapeHtml(c.client_name)}" data-code="${c.project_code}"><span>${Utils.escapeHtml(c.client_name)}</span><span class="text-muted text-sm">${c.project_code}</span></div>`).join('')
        : '<div class="custom-select-empty">No clients found</div>'
      list.querySelectorAll('.custom-select-item').forEach(item => {
        item.addEventListener('click', async () => {
          dropdown.style.display = 'none'
          document.getElementById('db-client-label').textContent = item.dataset.name
          document.getElementById('db-project-code').textContent = item.dataset.code
          const { data: full } = await API.getClientDashboard(item.dataset.id)
          _currentClient = full; _currentEntity = null
          const entities = full?.client_entities || []
          const entityGroup = document.getElementById('db-entity-group'), entitySel = document.getElementById('db-entity-select')
          if (entities.length > 1) {
            entitySel.innerHTML = entities.map(e => `<option value="${e.id}">${Utils.escapeHtml(e.entity_name)}</option>`).join('')
            _currentEntity = entities[0].id; entityGroup.style.display = 'flex'
            entitySel.addEventListener('change', () => { _currentEntity = entitySel.value; _loadDashboard() })
          } else { entityGroup.style.display = 'none' }
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
    const [metricsRes, postsRes, reportsRes, uploadLogRes, followersRes, visitorsRes, demographicsFollowersRes, demographicsVisitorsRes] = await Promise.all([
      API.getSocialMetrics(_currentClient.id, _currentPlatform, dateFrom, dateTo),
      API.getSocialPosts(_currentClient.id, _currentPlatform, dateFrom, dateTo),
      API.getMasterFolderFiles(_currentClient.id, _currentMonth, 'reports'),
      API.getAnalyticsUploadLog(_currentClient.id, _currentPlatform),
      API.getSocialFollowers(_currentClient.id, _currentPlatform, dateFrom, dateTo),
      API.getSocialVisitors(_currentClient.id, _currentPlatform, dateFrom, dateTo),
      API.getSocialDemographics(_currentClient.id, _currentPlatform, 'followers'),
      API.getSocialDemographics(_currentClient.id, _currentPlatform, 'visitors'),
    ])
    const metrics = metricsRes.data || [], posts = postsRes.data || []
    const reports = reportsRes.data || [], uploadLog = uploadLogRes.data || []
    const followers = followersRes.data || [], visitors = visitorsRes.data || []
    const demoFollowers = demographicsFollowersRes.data || [], demoVisitors = demographicsVisitorsRes.data || []

    if (!metrics.length && !posts.length) { _renderEmptyState(body); return }

    if (_trendChart)     { _trendChart.destroy();     _trendChart = null }
    if (_pubChart)       { _pubChart.destroy();       _pubChart = null }
    if (_followersChart) { _followersChart.destroy(); _followersChart = null }
    if (_visitorsChart)  { _visitorsChart.destroy();  _visitorsChart = null }

    const kpis = _computeKPIs(metrics, posts)
    body.innerHTML = `
      ${_renderDataBanner(uploadLog, dateFrom, dateTo)}
      <div style="display:flex;flex-direction:column;gap:16px;margin-bottom:16px;">
        ${_renderStatusCard()}
        <div class="kpi-grid">${_renderKPICards(kpis)}</div>
      </div>
      <div class="charts-row mb-4">
        <div class="chart-card">
          <div class="chart-card-header">
            <span class="chart-card-title">Performance Trend</span>
            <div class="chart-multi-select" id="trend-pills">
              ${METRIC_KEYS.map(k => `<span class="chart-metric-pill${_activeMetrics.includes(k) ? ' active' : ''}" data-metric="${k}">${Utils.escapeHtml(METRIC_CONFIG[k].label)}</span>`).join('')}
            </div>
          </div>
          <div class="chart-canvas-wrap"><canvas id="trend-chart"></canvas></div>
        </div>
        <div class="chart-card">
          <div class="chart-card-header"><span class="chart-card-title">Weekly Publishing Activity</span></div>
          <div class="chart-canvas-wrap"><canvas id="pub-chart"></canvas></div>
        </div>
      </div>
      <div class="charts-row mb-4">
        <div class="section-card">
          <div class="section-card-header"><h3>SOW Progress</h3></div>
          <div class="section-card-body">${_renderSOW(reports.length)}</div>
        </div>
        <div class="section-card">
          <div class="section-card-header"><h3>Top Performing Content</h3></div>
          <div class="section-card-body" style="padding:0;">${_renderTopContent(posts)}</div>
        </div>
      </div>
      ${_renderAudienceSection(followers, visitors, demoFollowers, demoVisitors)}
    `
    _initTrendChart(metrics); _initPubChart(posts)
    _initFollowersChart(followers); _initVisitorsChart(visitors)
    _bindStatusCard(); _bindTrendPills(metrics); _bindDemoTabs()
  }

  /* ── Empty state ────────────────────────────────────────── */
  function _renderEmptyState(body) {
    body.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;text-align:center;">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--border)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:16px;"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
        <h3 style="margin:0 0 8px;font-size:16px;font-weight:600;color:var(--text);">No data uploaded yet</h3>
        <p style="margin:0 0 20px;font-size:14px;color:var(--text-muted);max-width:380px;">Upload a LinkedIn or Instagram analytics export to see performance data.</p>
        ${_p.can_create ? `<button class="btn btn--primary btn--sm" onclick="document.getElementById('db-upload-btn')?.click()">Upload Data</button>` : ''}
      </div>`
  }

  /* ── Data banner ────────────────────────────────────────── */
  function _renderDataBanner(uploadLog, dateFrom, dateTo) {
    const last = uploadLog[0]
    let lastText = ''
    if (last) {
      const name = Utils.escapeHtml(last.uploaded_by_emp?.name || 'someone')
      const daysAgo = Math.round((Date.now() - new Date(last.uploaded_at).getTime()) / 86400000)
      const ago = daysAgo === 0 ? 'today' : daysAgo === 1 ? '1 day ago' : `${daysAgo} days ago`
      lastText = ` · Last uploaded ${ago} by ${name}`
    }
    return `<div class="sample-data-banner" style="background:var(--surface-alt,#f0f7ff);border-color:var(--primary,#0F4799)20;">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
      Showing data for <strong>${Utils.escapeHtml(_currentPlatform)}</strong> · ${Utils.formatDate(dateFrom)} – ${Utils.formatDate(dateTo)}${lastText}
    </div>`
  }

  /* ── Status card ────────────────────────────────────────── */
  function _renderStatusCard() {
    const c = _currentClient, statusVal = c.client_status || 'on_track'
    const statusMap = { on_track: ['On Track', 'status--on-track'], at_risk: ['At Risk', 'status--at-risk'], off_track: ['Off Track', 'status--off-track'] }
    const [slabel, scls] = statusMap[statusVal] || statusMap.on_track
    const updatedBy = c.status_updater?.name || null, updatedAt = c.client_status_updated_at ? Utils.formatDate(c.client_status_updated_at) : null
    return `<div class="client-status-card">
      <div class="client-status-badge ${scls}" id="status-badge">${slabel}</div>
      ${_p.can_edit ? `<select class="client-status-select" id="status-select">
        <option value="on_track" ${statusVal==='on_track'?'selected':''}>On Track</option>
        <option value="at_risk" ${statusVal==='at_risk'?'selected':''}>At Risk</option>
        <option value="off_track" ${statusVal==='off_track'?'selected':''}>Off Track</option>
      </select>` : ''}
      <div class="client-status-meta">${updatedBy && updatedAt ? `Last updated by ${Utils.escapeHtml(updatedBy)} on ${updatedAt}` : 'Status not yet updated'}</div>
    </div>`
  }

  function _bindStatusCard() {
    const sel = document.getElementById('status-select'), badge = document.getElementById('status-badge')
    if (!sel || !badge) return
    const statusMap = { on_track: ['On Track', 'status--on-track'], at_risk: ['At Risk', 'status--at-risk'], off_track: ['Off Track', 'status--off-track'] }
    sel.addEventListener('change', async () => {
      const val = sel.value
      const { error } = await API.updateClientStatus(_currentClient.id, val, _user.id)
      if (error) { Utils.showToast('Failed to update status.', 'error'); return }
      badge.textContent = statusMap[val][0]; badge.className = `client-status-badge ${statusMap[val][1]}`
      Utils.showToast('Client status updated.', 'success')
    })
  }

  /* ── KPI computation + cards ────────────────────────────── */
  function _computeKPIs(metrics, posts) {
    const sum = (arr, key) => arr.reduce((a, r) => a + _num(r[key]), 0), loc = n => n.toLocaleString('en-IN')
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
    return kpis.map(k => `<div class="kpi-card${k.highlight?' kpi-card--highlight':''}"><div class="kpi-label">${Utils.escapeHtml(k.label)}</div><div class="kpi-value">${Utils.escapeHtml(String(k.value))}</div></div>`).join('')
  }

  /* ── Chart helpers ──────────────────────────────────────── */
  const _lineChartOpts = (nPts) => ({
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 12, padding: 14 } }, tooltip: { mode: 'index', intersect: false } },
    scales: {
      x: { grid: { color: '#F1F5F9' }, ticks: { font: { size: 11 }, color: '#94A3B8', maxTicksLimit: 10 } },
      y: { grid: { color: '#F1F5F9' }, ticks: { font: { size: 11 }, color: '#94A3B8' }, beginAtZero: false },
    },
    interaction: { mode: 'nearest', axis: 'x', intersect: false },
  })

  function _mkDataset(label, data, color, nPts) {
    return { label, data, borderColor: color, backgroundColor: color + '18', borderWidth: 2, pointRadius: nPts > 60 ? 2 : 4, pointHoverRadius: 6, tension: 0.35, fill: false }
  }

  /* ── Trend chart ────────────────────────────────────────── */
  function _initTrendChart(metrics) {
    if (_trendChart) { _trendChart.destroy(); _trendChart = null }
    const canvas = document.getElementById('trend-chart')
    if (!canvas || typeof Chart === 'undefined') return
    const labels = metrics.map(r => _shortDate(r.date))
    const datasets = _activeMetrics.map(k => {
      const cfg = METRIC_CONFIG[k], scale = cfg.scale || 1
      return _mkDataset(cfg.label, metrics.map(r => _num(r[cfg.field]) * scale), cfg.color, metrics.length)
    })
    _trendChart = new Chart(canvas, { type: 'line', data: { labels, datasets }, options: _lineChartOpts(metrics.length) })
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
    const weeks = Object.keys(weekMap).sort()
    const labels = weeks.map(w => { const m = new Date(w), s = new Date(m); s.setDate(m.getDate() + 6); return _shortDate(m.toISOString()) + '–' + _shortDate(s.toISOString()) })
    _pubChart = new Chart(canvas, {
      type: 'bar', data: { labels, datasets: [{ label: 'Posts Published', data: weeks.map(w => weekMap[w]), backgroundColor: '#0F4799', borderRadius: 4, borderSkipped: false }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y} posts` } } }, scales: { x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#94A3B8' } }, y: { grid: { color: '#F1F5F9' }, ticks: { font: { size: 11 }, color: '#94A3B8', stepSize: 1 }, beginAtZero: true } } },
    })
  }

  function _bindTrendPills(metrics) {
    document.querySelectorAll('.chart-metric-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const key = pill.dataset.metric
        if (_activeMetrics.includes(key)) { if (_activeMetrics.length === 1) return; _activeMetrics = _activeMetrics.filter(m => m !== key); pill.classList.remove('active') }
        else { _activeMetrics.push(key); pill.classList.add('active') }
        _initTrendChart(metrics)
      })
    })
  }

  /* ── Followers chart ────────────────────────────────────── */
  function _initFollowersChart(followers) {
    if (_followersChart) { _followersChart.destroy(); _followersChart = null }
    const canvas = document.getElementById('followers-chart')
    if (!canvas || typeof Chart === 'undefined' || !followers.length) return
    const labels = followers.map(r => _shortDate(r.date))
    _followersChart = new Chart(canvas, { type: 'line', data: { labels, datasets: [
      _mkDataset('Organic Followers',    followers.map(r => _num(r.organic_followers)),   '#1D9E75', followers.length),
      _mkDataset('Total New Followers',  followers.map(r => _num(r.total_new_followers)), '#0F4799', followers.length),
    ]}, options: _lineChartOpts(followers.length) })
  }

  /* ── Visitors chart ─────────────────────────────────────── */
  function _initVisitorsChart(visitors) {
    if (_visitorsChart) { _visitorsChart.destroy(); _visitorsChart = null }
    const canvas = document.getElementById('visitors-chart')
    if (!canvas || typeof Chart === 'undefined' || !visitors.length) return
    const labels = visitors.map(r => _shortDate(r.date))
    _visitorsChart = new Chart(canvas, { type: 'line', data: { labels, datasets: [
      _mkDataset('Total Page Views', visitors.map(r => _num(r.total_views_total)),  '#45BBF0', visitors.length),
      _mkDataset('Unique Visitors',  visitors.map(r => _num(r.total_unique_total)), '#8B5CF6', visitors.length),
    ]}, options: _lineChartOpts(visitors.length) })
  }

  /* ── Audience section ───────────────────────────────────── */
  function _renderAudienceSection(followers, visitors, demoFollowers, demoVisitors) {
    if (!followers.length && !visitors.length && !demoFollowers.length && !demoVisitors.length) return ''
    const hasDemoF = demoFollowers.length > 0, hasDemoV = demoVisitors.length > 0

    const growthHtml   = followers.length ? `<div style="margin-bottom:24px;"><h4 style="font-size:13px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin:0 0 12px;">Audience Growth</h4><div class="chart-canvas-wrap"><canvas id="followers-chart"></canvas></div></div>` : ''
    const visitorsHtml = visitors.length  ? `<div style="margin-bottom:24px;"><h4 style="font-size:13px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin:0 0 12px;">Page Visitors</h4><div class="chart-canvas-wrap"><canvas id="visitors-chart"></canvas></div></div>` : ''

    let demosHtml = ''
    if (hasDemoF || hasDemoV) {
      const DIMS = [
        { key: 'location',     label: 'Location',    limit: 10 },
        { key: 'job_function', label: 'Job Function', limit: 10 },
        { key: 'seniority',    label: 'Seniority',    limit: null },
        { key: 'industry',     label: 'Industry',     limit: 10 },
        { key: 'company_size', label: 'Company Size', limit: null },
      ]
      const renderList = data => DIMS.map(dim => {
        const rows = data.filter(r => r.dimension === dim.key).sort((a, b) => b.value - a.value)
        if (!rows.length) return ''
        const shown = dim.limit ? rows.slice(0, dim.limit) : rows, maxVal = shown[0]?.value || 1
        return `<div style="margin-bottom:16px;"><div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">${dim.label}</div>${shown.map((r, i) => {
          const pct = Math.round((_num(r.value) / maxVal) * 100)
          return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px;"><span style="width:16px;text-align:right;color:var(--text-muted);flex-shrink:0;">${i+1}</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${Utils.escapeHtml(r.label)}">${Utils.escapeHtml(r.label)}</span><div style="width:80px;height:6px;background:var(--border);border-radius:3px;flex-shrink:0;"><div style="width:${pct}%;height:100%;background:var(--primary,#0F4799);border-radius:3px;"></div></div><span style="width:40px;text-align:right;color:var(--text-muted);flex-shrink:0;">${_num(r.value).toLocaleString('en-IN')}</span></div>`
        }).join('')}</div>`
      }).join('')

      const tabs = [
        hasDemoF ? `<button class="demo-tab demo-tab--active" data-tab="followers">Followers</button>` : '',
        hasDemoV ? `<button class="demo-tab${!hasDemoF ? ' demo-tab--active' : ''}" data-tab="visitors">Visitors</button>` : '',
      ].filter(Boolean).join('')

      demosHtml = `<div><h4 style="font-size:13px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin:0 0 12px;">Audience Demographics</h4>
        <div style="display:flex;gap:8px;margin-bottom:16px;" id="demo-tabs">${tabs}</div>
        ${hasDemoF ? `<div id="demo-panel-followers" class="demo-panel">${renderList(demoFollowers)}</div>` : ''}
        ${hasDemoV ? `<div id="demo-panel-visitors" class="demo-panel" style="display:none;">${renderList(demoVisitors)}</div>` : ''}
      </div>`
    }

    return `<div class="section-card mb-4"><div class="section-card-header"><h3>Audience</h3></div><div class="section-card-body">${growthHtml}${visitorsHtml}${demosHtml}</div></div>`
  }

  function _bindDemoTabs() {
    document.querySelectorAll('.demo-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.demo-tab').forEach(t => t.classList.remove('demo-tab--active'))
        tab.classList.add('demo-tab--active')
        document.querySelectorAll('.demo-panel').forEach(p => { p.style.display = 'none' })
        const panel = document.getElementById(`demo-panel-${tab.dataset.tab}`)
        if (panel) panel.style.display = 'block'
      })
    })
  }

  /* ── SOW progress ───────────────────────────────────────── */
  function _renderSOW(reportCount) {
    const sow = _currentClient.scope_of_work || []
    if (!sow.length) return '<p class="empty-state" style="padding:24px 0;">No scope of work defined.</p>'
    const reportDelivered = Math.min(reportCount, 1), reportPct = Math.round(reportDelivered * 100)
    const postSow = sow.find(s => s.deliverable_type?.toLowerCase().includes('post') || s.deliverable_type?.toLowerCase().includes('content'))
    const postPlanned = postSow?.agreed_monthly_quantity || 0
    return `<div class="sow-section">
      ${postSow ? `<div class="sow-row-item"><div class="sow-row-top"><span class="sow-row-name">Posts</span><span class="sow-row-fraction">— / ${postPlanned} planned</span><span class="sow-row-pct text-muted">—</span></div><div class="progress-bar"><div class="progress-fill" style="width:0%"></div></div></div>` : ''}
      <div class="sow-row-item">
        <div class="sow-row-top"><span class="sow-row-name">Monthly Reports</span><span class="sow-row-fraction">${reportDelivered} / 1 planned</span><span class="sow-row-pct${reportPct===0?' sow-row-pct--danger':''}">${reportPct}%</span></div>
        <div class="progress-bar"><div class="progress-fill${reportPct===100?' progress-fill--success':''}" style="width:${reportPct}%"></div></div>
        ${reportDelivered===0 ? '<p style="font-size:11px;color:var(--danger);margin-top:4px;">Not Uploaded</p>' : ''}
      </div>
    </div>`
  }

  /* ── Top content ────────────────────────────────────────── */
  function _renderTopContent(posts) {
    if (!posts.length) return '<p style="padding:24px;color:var(--text-muted);font-size:13px;">No posts in selected range.</p>'
    const top = posts.slice(0, 10)
    const CTCOLORS = { Video: '#8B5CF6', Image: '#0F4799', Text: '#64748B', Carousel: '#F59E0B' }
    return `<table class="data-table"><thead><tr><th>Post Preview</th><th>Type</th><th>Posted By</th><th>Date</th><th style="text-align:right;">Impressions</th><th style="text-align:right;">Likes</th><th style="text-align:right;">Eng. Rate</th></tr></thead><tbody>${top.map(p => {
      const title = Utils.truncate(p.post_title || '(no title)', 80), url = p.post_url ? Utils.escapeHtml(p.post_url) : null
      const ct = p.content_type || p.post_type || '—', engRate = p.engagement_rate != null ? (_num(p.engagement_rate) * 100).toFixed(2) + '%' : '—'
      return `<tr><td>${url ? `<a href="${url}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;" title="${Utils.escapeHtml(p.post_title||'')}">${Utils.escapeHtml(title)}</a>` : Utils.escapeHtml(title)}</td><td><span style="font-size:11px;font-weight:600;color:${CTCOLORS[ct]||'#64748B'};">${Utils.escapeHtml(ct)}</span></td><td style="white-space:nowrap;">${Utils.escapeHtml(p.posted_by||'—')}</td><td style="white-space:nowrap;">${p.created_date?Utils.formatDate(p.created_date):'—'}</td><td style="text-align:right;">${_num(p.impressions).toLocaleString('en-IN')}</td><td style="text-align:right;">${_num(p.likes).toLocaleString('en-IN')}</td><td style="text-align:right;font-weight:600;">${engRate}</td></tr>`
    }).join('')}</tbody></table>`
  }

  /* ── Upload modal ───────────────────────────────────────── */
  function _openUploadModal() {
    const clientOpts = _clients.map(c => `<option value="${c.id}"${_currentClient?.id===c.id?' selected':''}>${Utils.escapeHtml(c.client_name)}</option>`).join('')
    Utils.openModal(`
      <div class="modal-header"><h3 class="modal-title">Upload Performance Data</h3><button class="modal-close" onclick="Utils.closeModal()"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button></div>
      <div class="modal-body" id="up-modal-body">
        <div class="form-group"><label class="form-label">Client</label><select class="form-select" id="up-client">${clientOpts}</select></div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Platform</label><select class="form-select" id="up-platform"><option value="LinkedIn">LinkedIn</option><option value="Instagram">Instagram</option></select></div>
          <div class="form-group"><label class="form-label">Project Code</label><input class="form-input" type="text" id="up-code" value="${Utils.escapeHtml(_currentClient?.project_code||'')}" readonly style="background:var(--surface);color:var(--text-muted);" /></div>
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
      <div class="modal-footer"><button class="btn btn-ghost" onclick="Utils.closeModal()">Cancel</button><button class="btn btn-primary" id="up-submit-btn" disabled>Upload and Process</button></div>
    `)

    let _parsedPayload = null

    document.getElementById('up-client')?.addEventListener('change', e => {
      const c = _clients.find(cl => cl.id === e.target.value)
      const codeEl = document.getElementById('up-code'); if (c && codeEl) codeEl.value = c.project_code
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
      await _doUpload({ ..._parsedPayload, client_id: document.getElementById('up-client')?.value, platform: document.getElementById('up-platform')?.value?.toLowerCase() })
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
    function _showPreview(html) {
      const preview = document.getElementById('up-preview')
      if (preview) { preview.style.display = 'block'; preview.innerHTML = html }
      const btn = document.getElementById('up-submit-btn'); if (btn) btn.disabled = false
    }
    function _previewAlert(summary, dFrom, dTo) {
      return `<div class="alert alert-info" style="margin-bottom:0;"><strong>Ready to upload.</strong> ${summary}<br>Date range: <strong>${Utils.escapeHtml(dFrom)}</strong> to <strong>${Utils.escapeHtml(dTo)}</strong>.<br><span style="color:var(--warning,#B45309);font-size:12px;">This will overwrite existing data in this date range for the selected client.</span></div>`
    }

    function _detectFileType(wb) {
      const sheets = wb.SheetNames.map(n => n.toLowerCase().trim())
      if (sheets.includes('metrics') && sheets.includes('all posts')) return 'content'
      if (sheets.includes('new followers')) return 'followers'
      if (sheets.includes('visitor metrics')) return 'visitors'
      return null
    }

    async function _parseFile(file) {
      if (typeof XLSX === 'undefined') { _showError('SheetJS library is not loaded. Please refresh the page and try again.'); return }
      try {
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false })
        const fileType = _detectFileType(wb)
        if (!fileType) { _showError("This file doesn't look like a valid LinkedIn analytics export. Expected: a Content export (Metrics + All posts sheets), a Followers export (New followers sheet), or a Visitors export (Visitor metrics sheet)."); return }
        if (fileType === 'content')   await _parseContentFile(wb)
        else if (fileType === 'followers') _parseFollowersFile(wb)
        else if (fileType === 'visitors')  _parseVisitorsFile(wb)
      } catch (err) { console.error('[ClientDashboard] parse error', err); _showError('Failed to parse file: ' + (err.message || 'Unknown error.')) }
    }

    async function _parseContentFile(wb) {
      const sn = wb.SheetNames.map(n => n.trim())
      const mS = wb.Sheets[sn.find(n => n.toLowerCase() === 'metrics')   || '']
      const pS = wb.Sheets[sn.find(n => n.toLowerCase() === 'all posts') || '']
      if (!mS || !pS) { _showError('Could not find "Metrics" and "All posts" sheets. Please upload a LinkedIn Analytics export.'); return }
      const mRows = XLSX.utils.sheet_to_json(mS, { header: 1, defval: '' })
      const pRows = XLSX.utils.sheet_to_json(pS, { header: 1, defval: '' })
      if (mRows.length < 3 || pRows.length < 3) { _showError('The file appears to be empty or incorrectly formatted.'); return }
      const mH = mRows[1].map(h => String(h).trim()), pH = pRows[1].map(h => String(h).trim())
      const mI = h => mH.indexOf(h), pI = h => pH.indexOf(h)
      const metrics = []
      for (let i = 2; i < mRows.length; i++) {
        const row = mRows[i], date = _parseDate(String(row[mI('Date')] || ''))
        if (!date) continue
        metrics.push({ date, impressions: _num(row[mI('Impressions (total)')]), reach: _num(row[mI('Unique impressions (organic)')]), clicks: _num(row[mI('Clicks (total)')]), reactions: _num(row[mI('Reactions (total)')]), comments: _num(row[mI('Comments (total)')]), reposts_shares: _num(row[mI('Reposts (total)')]), follows: 0, engagement_rate: _num(row[mI('Engagement rate (total)')]), impressions_organic: _num(row[mI('Impressions (organic)')]), impressions_sponsored: _num(row[mI('Impressions (sponsored)')]), unique_impressions_organic: _num(row[mI('Unique impressions (organic)')]), clicks_organic: _num(row[mI('Clicks (organic)')]), clicks_sponsored: _num(row[mI('Clicks (sponsored)')]), reactions_organic: _num(row[mI('Reactions (organic)')]), reactions_sponsored: _num(row[mI('Reactions (sponsored)')]), comments_organic: _num(row[mI('Comments (organic)')]), comments_sponsored: _num(row[mI('Comments (sponsored)')]), reposts_organic: _num(row[mI('Reposts (organic)')]), reposts_sponsored: _num(row[mI('Reposts (sponsored)')]), engagement_rate_organic: _num(row[mI('Engagement rate (organic)')]), engagement_rate_sponsored: _num(row[mI('Engagement rate (sponsored)')]) })
      }
      const posts = []
      for (let i = 2; i < pRows.length; i++) {
        const row = pRows[i]; if (!row[pI('Post link')]) continue
        posts.push({ post_title: String(row[pI('Post title')]||'').slice(0,2000), post_url: String(row[pI('Post link')]||''), post_type: String(row[pI('Post type')]||''), content_type: String(row[pI('Content Type')]||''), campaign_name: String(row[pI('Campaign name')]||''), posted_by: String(row[pI('Posted by')]||''), created_date: _parseDate(String(row[pI('Created date')])), campaign_start_date: _parseDate(String(row[pI('Campaign start date')]||'')), campaign_end_date: _parseDate(String(row[pI('Campaign end date')]||'')), audience: String(row[pI('Audience')]||''), impressions: _num(row[pI('Impressions')]), views: _num(row[pI('Views')]), offsite_views: _num(row[pI('Offsite Views')]), clicks: _num(row[pI('Clicks')]), ctr: _num(row[pI('Click through rate (CTR)')]), likes: _num(row[pI('Likes')]), comments: _num(row[pI('Comments')]), reposts_shares: _num(row[pI('Reposts')]), follows: _num(row[pI('Follows')]), engagement_rate: _num(row[pI('Engagement rate')]), saves: 0 })
      }
      if (!metrics.length && !posts.length) { _showError('No data rows found in the file. Please check the export format.'); return }
      const allDates = metrics.map(m => m.date).filter(Boolean).sort()
      const dFrom = allDates[0]||'—', dTo = allDates[allDates.length-1]||'—'
      _parsedPayload = { data_type: 'content', metrics, posts }
      _showPreview(_previewAlert(`Found <strong>${metrics.length}</strong> days of metrics + <strong>${posts.length}</strong> posts.`, dFrom, dTo))
    }

    function _parseFollowersFile(wb) {
      const sn = wb.SheetNames.map(n => n.trim())
      const findSheet = name => wb.Sheets[sn.find(n => n.toLowerCase() === name.toLowerCase()) || '']
      const nfS = findSheet('New followers')
      if (!nfS) { _showError('Could not find "New followers" sheet in the file.'); return }
      const nfRows = XLSX.utils.sheet_to_json(nfS, { header: 1, defval: '' })
      if (nfRows.length < 2) { _showError('The followers file appears to be empty or incorrectly formatted.'); return }
      const nfH = nfRows[0].map(h => String(h).trim()), nfI = h => nfH.indexOf(h)
      const followers_daily = []
      for (let i = 1; i < nfRows.length; i++) {
        const row = nfRows[i], date = _parseDate(String(row[nfI('Date')]||''))
        if (!date) continue
        followers_daily.push({ date, sponsored_followers: _num(row[nfI('Sponsored followers')]), organic_followers: _num(row[nfI('Organic followers')]), auto_invited_followers: _num(row[nfI('Auto-invited followers')]), total_new_followers: _num(row[nfI('Total followers')]) })
      }
      const demographics = _parseDemoSheets(wb, sn)
      if (!followers_daily.length) { _showError('No follower data rows found in the file. Please check the export format.'); return }
      const allDates = followers_daily.map(r => r.date).filter(Boolean).sort()
      _parsedPayload = { data_type: 'followers', followers_daily, demographics }
      _showPreview(_previewAlert(`Found <strong>${followers_daily.length}</strong> days of follower data + 6 demographic breakdowns (${demographics.length} total segments).`, allDates[0]||'—', allDates[allDates.length-1]||'—'))
    }

    function _parseVisitorsFile(wb) {
      const sn = wb.SheetNames.map(n => n.trim())
      const findSheet = name => wb.Sheets[sn.find(n => n.toLowerCase() === name.toLowerCase()) || '']
      const vmS = findSheet('Visitor metrics')
      if (!vmS) { _showError('Could not find "Visitor metrics" sheet in the file.'); return }
      const vmRows = XLSX.utils.sheet_to_json(vmS, { header: 1, defval: '' })
      if (vmRows.length < 2) { _showError('The visitors file appears to be empty or incorrectly formatted.'); return }
      const vmH = vmRows[0].map(h => String(h).trim()), vmI = h => vmH.indexOf(h)
      const visitors_daily = []
      for (let i = 1; i < vmRows.length; i++) {
        const row = vmRows[i], date = _parseDate(String(row[vmI('Date')]||''))
        if (!date) continue
        visitors_daily.push({ date, overview_views_desktop: _num(row[vmI('Overview page views (desktop)')]), overview_views_mobile: _num(row[vmI('Overview page views (mobile)')]), overview_views_total: _num(row[vmI('Overview page views (total)')]), overview_unique_desktop: _num(row[vmI('Overview unique visitors (desktop)')]), overview_unique_mobile: _num(row[vmI('Overview unique visitors (mobile)')]), overview_unique_total: _num(row[vmI('Overview unique visitors (total)')]), life_views_desktop: _num(row[vmI('Life page views (desktop)')]), life_views_mobile: _num(row[vmI('Life page views (mobile)')]), life_views_total: _num(row[vmI('Life page views (total)')]), life_unique_desktop: _num(row[vmI('Life unique visitors (desktop)')]), life_unique_mobile: _num(row[vmI('Life unique visitors (mobile)')]), life_unique_total: _num(row[vmI('Life unique visitors (total)')]), jobs_views_desktop: _num(row[vmI('Jobs page views (desktop)')]), jobs_views_mobile: _num(row[vmI('Jobs page views (mobile)')]), jobs_views_total: _num(row[vmI('Jobs page views (total)')]), jobs_unique_desktop: _num(row[vmI('Jobs unique visitors (desktop)')]), jobs_unique_mobile: _num(row[vmI('Jobs unique visitors (mobile)')]), jobs_unique_total: _num(row[vmI('Jobs unique visitors (total)')]), total_views_desktop: _num(row[vmI('Total page views (desktop)')]), total_views_mobile: _num(row[vmI('Total page views (mobile)')]), total_views_total: _num(row[vmI('Total page views (total)')]), total_unique_desktop: _num(row[vmI('Total unique visitors (desktop)')]), total_unique_mobile: _num(row[vmI('Total unique visitors (mobile)')]), total_unique_total: _num(row[vmI('Total unique visitors (total)')]) })
      }
      const demographics = _parseDemoSheets(wb, sn)
      if (!visitors_daily.length) { _showError('No visitor data rows found in the file. Please check the export format.'); return }
      const allDates = visitors_daily.map(r => r.date).filter(Boolean).sort()
      _parsedPayload = { data_type: 'visitors', visitors_daily, demographics }
      _showPreview(_previewAlert(`Found <strong>${visitors_daily.length}</strong> days of visitor data + 6 demographic breakdowns (${demographics.length} total segments).`, allDates[0]||'—', allDates[allDates.length-1]||'—'))
    }

    function _parseDemoSheets(wb, sheetNames) {
      const dimMap = { 'location': 'location', 'job function': 'job_function', 'seniority': 'seniority', 'industry': 'industry', 'company size': 'company_size' }
      const demographics = []
      for (const [sk, dk] of Object.entries(dimMap)) {
        const sn = sheetNames.find(n => n.toLowerCase() === sk); if (!sn) continue
        const sheet = wb.Sheets[sn]; if (!sheet) continue
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i]; if (!row[0] && row[0] !== 0) continue
          demographics.push({ dimension: dk, label: String(row[0]).trim(), value: _num(row[1]) })
        }
      }
      return demographics
    }

    async function _doUpload(payload) {
      const platform = document.getElementById('up-platform')?.value
      const clientId = document.getElementById('up-client')?.value
      const btn = document.getElementById('up-submit-btn')
      if (btn) { btn.disabled = true; btn.textContent = 'Uploading…' }
      let drive_url = null
      const rawFile = document.getElementById('up-file-input')?.files?.[0]
      if (rawFile) {
        const driveRes = await API.uploadAnalyticsToDrive(rawFile, clientId, platform, _thisMonth())
        if (driveRes?.drive_url) drive_url = driveRes.drive_url
        if (driveRes?.error) console.warn('[Analytics] Drive upload failed:', driveRes.error)
      }
      try {
        const result = await API.ingestAnalytics({ ...payload, drive_url })
        if (result.error || result.success === false) {
          if (btn) { btn.disabled = false; btn.textContent = 'Upload and Process' }
          _showError(result.error || result.message || 'Upload failed. Please try again.'); return
        }
        Utils.closeModal(); Utils.showToast('Data uploaded successfully.', 'success'); _loadDashboard()
      } catch (err) {
        console.error('[ClientDashboard] upload error', err)
        if (btn) { btn.disabled = false; btn.textContent = 'Upload and Process' }
        _showError('Upload failed: ' + (err.message || 'Unknown error.'))
      }
    }
  }

  /* ── Helpers ────────────────────────────────────────────── */
  function _thisMonth() { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}` }
  function _num(val)    { const n = parseFloat(val); return isNaN(n) ? 0 : n }
  function _parseDate(str) {
    if (!str || typeof str !== 'string') return null
    const [m, d, y] = str.split('/'); if (!m || !d || !y) return null
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`
  }
  function _shortDate(iso) {
    if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return iso
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  }

  return { render, init }
})()
