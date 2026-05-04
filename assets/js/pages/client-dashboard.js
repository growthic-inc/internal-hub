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
  let _customDateFrom = '', _customDateTo = ''
  let _trendChart = null, _pubChart = null, _followersChart = null, _visitorsChart = null
  let _activeMetrics = ['impressions', 'clicks']
  let _tcSort = { col: 'impressions', dir: 'desc' }, _tcPosts = []

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
              <option value="180">Last 6 Months</option>
              <option value="365">Last 12 Months</option>
              <option value="custom">Custom Range</option>
            </select>
          </div>
          <div id="db-custom-dates" style="display:none;flex-direction:column;gap:4px;">
            <span class="db-filter-label">From → To</span>
            <div style="display:flex;gap:6px;align-items:center;">
              <input type="date" id="db-date-from" class="db-filter-select" style="min-width:130px;padding-right:8px;">
              <input type="date" id="db-date-to"   class="db-filter-select" style="min-width:130px;padding-right:8px;">
            </div>
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
    document.getElementById('db-range-select')?.addEventListener('change', e => {
      _currentRange = e.target.value
      const customEl = document.getElementById('db-custom-dates')
      if (customEl) customEl.style.display = _currentRange === 'custom' ? 'flex' : 'none'
      if (_currentRange !== 'custom' && _currentClient) _loadDashboard()
    })
    document.getElementById('db-date-from')?.addEventListener('change', e => {
      _customDateFrom = e.target.value
      if (_customDateTo && _currentClient) _loadDashboard()
    })
    document.getElementById('db-date-to')?.addEventListener('change', e => {
      _customDateTo = e.target.value
      if (_customDateFrom && _currentClient) _loadDashboard()
    })
  }

  function _getDateRange() {
    if (_currentRange === 'custom' && _customDateFrom && _customDateTo) {
      return { dateFrom: _customDateFrom, dateTo: _customDateTo }
    }
    const dateTo = new Date(), dateFrom = new Date()
    dateFrom.setDate(dateTo.getDate() - (parseInt(_currentRange, 10) || 30))
    return { dateFrom: dateFrom.toISOString().split('T')[0], dateTo: dateTo.toISOString().split('T')[0] }
  }

  function _getPrevDateRange() {
    const { dateFrom, dateTo } = _getDateRange()
    const from = new Date(dateFrom), to = new Date(dateTo)
    const days = Math.round((to - from) / 86400000)
    const prevTo   = new Date(from); prevTo.setDate(prevTo.getDate() - 1)
    const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - days)
    return { dateFrom: prevFrom.toISOString().split('T')[0], dateTo: prevTo.toISOString().split('T')[0] }
  }

  /* ── Load dashboard ─────────────────────────────────────── */
  async function _loadDashboard() {
    const body = document.getElementById('db-body')
    if (!body || !_currentClient) return
    body.innerHTML = '<p class="loading-text">Loading dashboard…</p>'
    const { dateFrom, dateTo } = _getDateRange()
    const { dateFrom: prevFrom, dateTo: prevTo } = _getPrevDateRange()
    const eid = _currentEntity || null
    const [metricsRes, postsRes, reportsRes, uploadLogRes, followersRes, visitorsRes, demographicsFollowersRes, demographicsVisitorsRes, prevMetricsRes, prevPostsRes, prevFollowersRes] = await Promise.all([
      API.getSocialMetrics(_currentClient.id, _currentPlatform, dateFrom, dateTo, eid),
      API.getSocialPosts(_currentClient.id, _currentPlatform, dateFrom, dateTo, eid),
      API.getMasterFolderFiles(_currentClient.id, _currentMonth, 'reports'),
      API.getAnalyticsUploadLog(_currentClient.id, _currentPlatform, eid),
      API.getSocialFollowers(_currentClient.id, _currentPlatform, dateFrom, dateTo, eid),
      API.getSocialVisitors(_currentClient.id, _currentPlatform, dateFrom, dateTo, eid),
      API.getSocialDemographics(_currentClient.id, _currentPlatform, 'followers', null, eid),
      API.getSocialDemographics(_currentClient.id, _currentPlatform, 'visitors', null, eid),
      API.getSocialMetrics(_currentClient.id, _currentPlatform, prevFrom, prevTo, eid),
      API.getSocialPosts(_currentClient.id, _currentPlatform, prevFrom, prevTo, eid),
      API.getSocialFollowers(_currentClient.id, _currentPlatform, prevFrom, prevTo, eid),
    ])
    const metrics = metricsRes.data || [], posts = postsRes.data || []
    const reports = reportsRes.data || [], uploadLog = uploadLogRes.data || []
    const followers = followersRes.data || [], visitors = visitorsRes.data || []
    const demoFollowers = demographicsFollowersRes.data || [], demoVisitors = demographicsVisitorsRes.data || []
    const prevMetrics = prevMetricsRes.data || [], prevPosts = prevPostsRes.data || [], prevFollowers = prevFollowersRes.data || []

    if (!metrics.length && !posts.length) { _renderEmptyState(body); return }

    if (_trendChart)     { _trendChart.destroy();     _trendChart = null }
    if (_pubChart)       { _pubChart.destroy();       _pubChart = null }
    if (_followersChart) { _followersChart.destroy(); _followersChart = null }
    if (_visitorsChart)  { _visitorsChart.destroy();  _visitorsChart = null }

    const kpis = _computeKPIs(metrics, posts, followers, prevMetrics, prevPosts, prevFollowers)
    body.innerHTML = `
      ${_renderContextBar(uploadLog, dateFrom, dateTo)}
      <div class="kpi-grid" style="margin-bottom:16px;">${_renderKPICards(kpis)}</div>
      <div class="chart-card mb-4">
        <div class="chart-card-header">
          <span class="chart-card-title">Performance Trend</span>
          <div class="chart-multi-select" id="trend-pills">
            ${METRIC_KEYS.map(k => `<span class="chart-metric-pill${_activeMetrics.includes(k) ? ' active' : ''}" data-metric="${k}">${Utils.escapeHtml(_metricLabel(k))}</span>`).join('')}
          </div>
        </div>
        <div class="chart-canvas-wrap" style="height:260px;"><canvas id="trend-chart"></canvas></div>
      </div>
      <div class="chart-card mb-4">
        <div class="chart-card-header"><span class="chart-card-title">Weekly Publishing Activity</span></div>
        <div class="chart-canvas-wrap"><canvas id="pub-chart"></canvas></div>
      </div>
      <div class="section-card mb-4">
        <div class="section-card-header"><h3>Top Performing Content</h3></div>
        <div class="section-card-body" style="padding:0;" data-tc="1">${_renderTopContent(posts)}</div>
      </div>
      ${_renderAudienceSection(followers, visitors, demoFollowers, demoVisitors)}
    `
    _initTrendChart(metrics); _initPubChart(posts)
    _initFollowersChart(followers); _initVisitorsChart(visitors)
    _bindContextBar(); _bindTrendPills(metrics); _bindDemoTabs(); _bindTopContent(); _bindTopContent()
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

  /* ── Context bar (data info + status) ──────────────────── */
  function _renderContextBar(uploadLog, dateFrom, dateTo) {
    const last = uploadLog[0]
    let uploadChip = ''
    if (last) {
      const daysAgo = Math.round((Date.now() - new Date(last.uploaded_at).getTime()) / 86400000)
      const ago = daysAgo === 0 ? 'today' : daysAgo === 1 ? '1 day ago' : `${daysAgo} days ago`
      uploadChip = `<span class="ctx-chip">
        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        Updated ${ago} by ${Utils.escapeHtml(last.uploaded_by_emp?.name || 'someone')}
      </span>`
    }
    const platIcon = _currentPlatform === 'LinkedIn'
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>`

    const c = _currentClient, statusVal = c.client_status || 'on_track'
    const statusMap = { on_track: ['On Track', 'status--on-track'], at_risk: ['At Risk', 'status--at-risk'], off_track: ['Off Track', 'status--off-track'] }
    const [slabel, scls] = statusMap[statusVal] || statusMap.on_track

    return `<div class="db-context-bar">
      <div class="db-context-left">
        <span class="ctx-chip ctx-chip--platform">${platIcon} ${Utils.escapeHtml(_currentPlatform)}</span>
        <span class="ctx-chip">
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          ${Utils.formatDate(dateFrom)} — ${Utils.formatDate(dateTo)}
        </span>
        ${uploadChip}
      </div>
      <div class="db-context-right">
        <div class="client-status-badge ${scls}" id="status-badge">${slabel}</div>
        ${_p.can_edit ? `<select class="client-status-select" id="status-select">
          <option value="on_track" ${statusVal==='on_track'?'selected':''}>On Track</option>
          <option value="at_risk" ${statusVal==='at_risk'?'selected':''}>At Risk</option>
          <option value="off_track" ${statusVal==='off_track'?'selected':''}>Off Track</option>
        </select>` : ''}
      </div>
    </div>`
  }

  function _bindContextBar() {
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
  // Platform-agnostic label helper — call wherever a metric name is shown to the user
  function _metricLabel(key) {
    const ig = _currentPlatform === 'Instagram'
    const overrides = { reactions: ig ? 'Likes' : 'Reactions', reposts_shares: ig ? 'Shares' : 'Reposts' }
    return overrides[key] || METRIC_CONFIG[key]?.label || key
  }

  const _KPI_META = {
    'Impressions':     { color: '#0F4799', icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>` },
    'Clicks':          { color: '#45BBF0', icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><path d="M10 14L21 3"/><path d="M21 16v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>` },
    'Reactions':       { color: '#1D9E75', icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>` },
    'Likes':           { color: '#1D9E75', icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>` },
    'Engagement Rate': { color: '#EF4444', icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>` },
    'Posts Published': { color: '#8B5CF6', icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>` },
    'Total Followers': { color: '#F59E0B', icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>` },
  }

  function _computeKPIs(metrics, posts, followers, prevMetrics, prevPosts, prevFollowers) {
    const sum   = (arr, key) => arr.reduce((a, r) => a + _num(r[key]), 0)
    const loc   = n => n.toLocaleString('en-IN')
    const growthPct = (curr, prev) => {
      if (!prev || prev === 0) return null
      const pct = ((curr - prev) / prev) * 100
      return isFinite(pct) ? +pct.toFixed(1) : null
    }

    const totalImpressions = sum(metrics, 'impressions')
    const totalClicks      = sum(metrics, 'clicks')
    const totalReactions   = sum(metrics, 'reactions')
    const avgEng           = metrics.length ? (sum(metrics, 'engagement_rate') / metrics.length) * 100 : 0
    // New Followers = sum of daily new followers gained in the range
    // (LinkedIn exports daily gain counts per row, not a running cumulative total)
    const totalFollowers = sum(followers, 'total_new_followers')

    const pImpressions       = sum(prevMetrics,   'impressions')
    const pClicks            = sum(prevMetrics,   'clicks')
    const pReactions         = sum(prevMetrics,   'reactions')
    const pAvgEng            = prevMetrics.length ? (sum(prevMetrics, 'engagement_rate') / prevMetrics.length) * 100 : 0
    const prevTotalFollowers = sum(prevFollowers,  'total_new_followers')

    return [
      { label: 'Impressions',                               value: loc(totalImpressions),    growth: growthPct(totalImpressions, pImpressions)      },
      { label: 'Clicks',                                    value: loc(totalClicks),         growth: growthPct(totalClicks,      pClicks)           },
      { label: _currentPlatform === 'Instagram' ? 'Likes' : 'Reactions',
                                                            value: loc(totalReactions),      growth: growthPct(totalReactions,   pReactions)        },
      { label: 'Engagement Rate',                           value: avgEng.toFixed(2) + '%', growth: growthPct(avgEng,           pAvgEng)           },
      { label: 'Posts Published',                           value: loc(posts.length),        growth: growthPct(posts.length,     prevPosts.length)  },
      { label: 'Total Followers',                           value: loc(totalFollowers),      growth: growthPct(totalFollowers,   prevTotalFollowers) },
    ]
  }

  function _renderKPICards(kpis) {
    return kpis.map(k => {
      const meta = _KPI_META[k.label] || { color: '#0F4799', icon: '' }
      let deltaHtml = ''
      if (k.growth !== null && k.growth !== undefined) {
        const up  = k.growth >= 0
        const arrow = up
          ? `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>`
          : `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`
        deltaHtml = `<div class="kpi-delta kpi-delta--${up ? 'up' : 'down'}" style="margin-top:8px;">${arrow}${up ? '+' : ''}${k.growth}% vs prev period</div>`
      }
      return `<div class="kpi-card" style="border-top:3px solid ${meta.color};">
        <div class="kpi-icon-wrap" style="background:${meta.color}1a;color:${meta.color};">${meta.icon}</div>
        <div class="kpi-label">${Utils.escapeHtml(k.label)}</div>
        <div class="kpi-value">${Utils.escapeHtml(String(k.value))}</div>
        ${deltaHtml}
      </div>`
    }).join('')
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

    const chartCol = (title, canvasId) => `
      <div>
        <h4 style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin:0 0 8px;">${title}</h4>
        <div class="chart-canvas-wrap" style="height:160px;"><canvas id="${canvasId}"></canvas></div>
      </div>`
    const bothCharts = followers.length && visitors.length
    const chartsHtml = (followers.length || visitors.length) ? `
      <div style="display:grid;grid-template-columns:${bothCharts ? '1fr 1fr' : '1fr'};gap:16px;margin-bottom:16px;">
        ${followers.length ? chartCol('Audience Growth', 'followers-chart') : ''}
        ${visitors.length  ? chartCol('Page Visitors',   'visitors-chart')  : ''}
      </div>` : ''

    let demosHtml = ''
    if (hasDemoF || hasDemoV) {
      const DIMS = [
        { key: 'location',     label: 'Location',    limit: 8 },
        { key: 'job_function', label: 'Job Function', limit: 8 },
        { key: 'seniority',    label: 'Seniority',    limit: null },
        { key: 'industry',     label: 'Industry',     limit: 8 },
        { key: 'company_size', label: 'Company Size', limit: null },
      ]
      const renderList = data => {
        const blocks = DIMS.map(dim => {
          const rows = data.filter(r => r.dimension === dim.key).sort((a, b) => b.value - a.value)
          if (!rows.length) return ''
          const shown = dim.limit ? rows.slice(0, dim.limit) : rows, maxVal = shown[0]?.value || 1
          return `<div style="min-width:0;">
            <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;padding-bottom:3px;border-bottom:1px solid var(--border);">${dim.label}</div>
            ${shown.map(r => {
              const pct = Math.round((_num(r.value) / maxVal) * 100)
              return `<div style="display:grid;grid-template-columns:1fr 48px 34px;align-items:center;gap:5px;padding:2px 0;">
                <span style="font-size:11px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${Utils.escapeHtml(r.label)}">${Utils.escapeHtml(r.label)}</span>
                <div style="height:3px;background:var(--border);border-radius:2px;"><div style="width:${pct}%;height:100%;background:var(--primary,#0F4799);border-radius:2px;"></div></div>
                <span style="font-size:11px;color:var(--text-muted);text-align:right;white-space:nowrap;">${_num(r.value).toLocaleString('en-IN')}</span>
              </div>`
            }).join('')}
          </div>`
        }).filter(Boolean)
        return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px 20px;">${blocks.join('')}</div>`
      }

      const tabs = [
        hasDemoF ? `<button class="demo-tab demo-tab--active" data-tab="followers">Followers</button>` : '',
        hasDemoV ? `<button class="demo-tab${!hasDemoF ? ' demo-tab--active' : ''}" data-tab="visitors">Visitors</button>` : '',
      ].filter(Boolean).join('')

      demosHtml = `<div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <h4 style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin:0;">Audience Demographics</h4>
          <div style="display:flex;gap:6px;" id="demo-tabs">${tabs}</div>
        </div>
        ${hasDemoF ? `<div id="demo-panel-followers" class="demo-panel">${renderList(demoFollowers)}</div>` : ''}
        ${hasDemoV ? `<div id="demo-panel-visitors" class="demo-panel" style="display:none;">${renderList(demoVisitors)}</div>` : ''}
      </div>`
    }

    return `<div class="section-card mb-4"><div class="section-card-header"><h3>Audience</h3></div><div class="section-card-body">${chartsHtml}${demosHtml}</div></div>`
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
    _tcPosts = posts
    if (!posts.length) return '<p style="padding:24px;color:var(--text-muted);font-size:13px;">No posts in selected range.</p>'
    return _buildTopContentTable()
  }

  function _buildTopContentTable() {
    if (!_tcPosts.length) return ''
    // Canonical content-type colours (platform-agnostic)
    const CTCOLORS  = { Video: '#8B5CF6', Image: '#0F4799', Text: '#64748B', Carousel: '#F59E0B' }
    // Instagram post_type → canonical type
    const _igTypeNorm = { 'ig reel': 'Video', 'ig video': 'Video', 'ig image': 'Image', 'ig carousel': 'Carousel', 'ig album': 'Carousel' }
    const _normType = raw => {
      if (!raw) return 'Text'
      const key = raw.toLowerCase().trim()
      return _igTypeNorm[key] || raw  // keep LinkedIn types (Video/Image/etc.) as-is
    }
    const sorted = [..._tcPosts].sort((a, b) => {
      let av, bv
      if (_tcSort.col === 'impressions')    { av = _num(a.impressions);    bv = _num(b.impressions) }
      else if (_tcSort.col === 'likes')     { av = _num(a.likes);          bv = _num(b.likes) }
      else                                  { av = _num(a.engagement_rate); bv = _num(b.engagement_rate) }
      return _tcSort.dir === 'desc' ? bv - av : av - bv
    }).slice(0, 10)

    const sortIcon = col => {
      const active = _tcSort.col === col
      if (!active) return `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="opacity:.35;vertical-align:middle;margin-left:3px;"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="5 12 12 19 19 12"/></svg>`
      return _tcSort.dir === 'desc'
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2.5" style="vertical-align:middle;margin-left:3px;"><polyline points="6 9 12 15 18 9"/></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2.5" style="vertical-align:middle;margin-left:3px;"><polyline points="18 15 12 9 6 15"/></svg>`
    }
    const thSort = (col, label, align = 'right') =>
      `<th style="text-align:${align};cursor:pointer;user-select:none;" class="tc-sort-th" data-sort-col="${col}">${label}${sortIcon(col)}</th>`

    return `<table class="data-table" id="top-content-table"><thead><tr>
      <th>Post Preview</th><th>Type</th><th>Posted By</th><th>Date</th>
      ${thSort('impressions', 'Impressions')}
      ${thSort('likes', 'Likes')}
      ${thSort('engagement_rate', 'Eng. Rate')}
    </tr></thead><tbody>${sorted.map(p => {
      const title = Utils.truncate(p.post_title || '(no title)', 80), url = p.post_url ? Utils.escapeHtml(p.post_url) : null
      const ctRaw = p.content_type || p.post_type || '', ctNorm = _normType(ctRaw)
      const engRate = p.engagement_rate != null ? (_num(p.engagement_rate) * 100).toFixed(2) + '%' : '—'
      return `<tr>
        <td>${url ? `<a href="${url}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;" title="${Utils.escapeHtml(p.post_title||'')}">${Utils.escapeHtml(title)}</a>` : Utils.escapeHtml(title)}</td>
        <td><span style="font-size:11px;font-weight:600;color:${CTCOLORS[ctNorm]||'#64748B'};">${Utils.escapeHtml(ctNorm || '—')}</span></td>
        <td style="white-space:nowrap;">${Utils.escapeHtml(p.posted_by||'—')}</td>
        <td style="white-space:nowrap;">${p.created_date?Utils.formatDate(p.created_date):'—'}</td>
        <td style="text-align:right;">${_num(p.impressions).toLocaleString('en-IN')}</td>
        <td style="text-align:right;">${_num(p.likes).toLocaleString('en-IN')}</td>
        <td style="text-align:right;font-weight:600;">${engRate}</td>
      </tr>`
    }).join('')}</tbody></table>`
  }

  function _bindTopContent() {
    document.querySelectorAll('.tc-sort-th').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.sortCol
        _tcSort.col === col ? (_tcSort.dir = _tcSort.dir === 'desc' ? 'asc' : 'desc') : (_tcSort.col = col, _tcSort.dir = 'desc')
        const wrap = document.querySelector('.section-card-body[data-tc]')
        if (wrap) { wrap.innerHTML = _buildTopContentTable(); _bindTopContent() }
      })
    })
  }

  /* ── Upload modal ───────────────────────────────────────── */
  function _openUploadModal() {
    const clientOpts = _clients.map(c => `<option value="${c.id}"${_currentClient?.id===c.id?' selected':''}>${Utils.escapeHtml(c.client_name)}</option>`).join('')
    Utils.openModal(`
      <div class="modal-header"><h3 class="modal-title">Upload Performance Data</h3><button class="modal-close" onclick="Utils.closeModal()"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button></div>
      <div class="modal-body" id="up-modal-body">
        <div class="form-group"><label class="form-label">Client</label><select class="form-select" id="up-client">${clientOpts}</select></div>
        <div class="form-group" id="up-entity-group" style="display:none;">
          <label class="form-label">Entity</label>
          <select class="form-select" id="up-entity"></select>
          <span class="form-hint">This client has multiple entities — select which one this data is for.</span>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Platform</label><select class="form-select" id="up-platform"><option value="LinkedIn">LinkedIn</option><option value="Instagram">Instagram</option></select></div>
          <div class="form-group"><label class="form-label">Project Code</label><input class="form-input" type="text" id="up-code" value="${Utils.escapeHtml(_currentClient?.project_code||'')}" readonly style="background:var(--surface);color:var(--text-muted);" /></div>
        </div>
        <div class="form-group">
          <label class="form-label" id="up-file-label">Data File</label>
          <div class="drag-drop-zone" id="up-drop-zone" style="cursor:pointer;">
            <input type="file" accept=".xlsx,.xls,.csv" id="up-file-input" style="position:absolute;inset:0;opacity:0;cursor:pointer;" />
            <div class="drag-drop-icon">📊</div>
            <div class="drag-drop-label">Drop file here or <span style="color:var(--primary);text-decoration:underline;">browse</span></div>
            <div class="drag-drop-hint" id="up-file-hint">Analytics export (.xlsx, .csv)</div>
            <div class="drag-drop-file-name" id="up-file-name" style="display:none;font-weight:600;color:var(--text);margin-top:6px;"></div>
          </div>
        </div>
        <div id="up-preview" style="display:none;"></div>
        <div id="up-error" style="display:none;" class="alert alert-danger"></div>
      </div>
      <div class="modal-footer"><button class="btn btn-ghost" onclick="Utils.closeModal()">Cancel</button><button class="btn btn-primary" id="up-submit-btn" disabled>Upload and Process</button></div>
    `)

    let _parsedPayload = null

    function _refreshEntityDropdown(clientId) {
      const c = _clients.find(cl => cl.id === clientId)
      const entities = c?.client_entities || []
      const group = document.getElementById('up-entity-group')
      const sel   = document.getElementById('up-entity')
      if (entities.length > 1) {
        sel.innerHTML = entities.map(e => `<option value="${e.id}">${Utils.escapeHtml(e.entity_name)}</option>`).join('')
        group.style.display = 'block'
      } else {
        sel.innerHTML = entities.length === 1 ? `<option value="${entities[0].id}">${Utils.escapeHtml(entities[0].entity_name)}</option>` : ''
        group.style.display = 'none'
      }
    }

    // Populate entity dropdown for the initially selected client
    _refreshEntityDropdown(document.getElementById('up-client')?.value)

    function _updateFileLabel() {
      const plat = document.getElementById('up-platform')?.value || 'LinkedIn'
      const labelEl = document.getElementById('up-file-label')
      const hintEl  = document.getElementById('up-file-hint')
      if (plat === 'Instagram') {
        if (labelEl) labelEl.textContent = 'Data File (Instagram Insights export)'
        if (hintEl)  hintEl.textContent  = 'Instagram Insights export (.xlsx, .xls, .csv)'
      } else {
        if (labelEl) labelEl.textContent = 'Data File (LinkedIn Analytics export)'
        if (hintEl)  hintEl.textContent  = 'LinkedIn Analytics export (.xlsx, .xls, .csv)'
      }
    }
    _updateFileLabel()

    document.getElementById('up-client')?.addEventListener('change', e => {
      const c = _clients.find(cl => cl.id === e.target.value)
      const codeEl = document.getElementById('up-code'); if (c && codeEl) codeEl.value = c.project_code
      _refreshEntityDropdown(e.target.value)
      _resetPreview()
    })
    document.getElementById('up-platform')?.addEventListener('change', () => { _updateFileLabel(); _resetPreview() })
    document.getElementById('up-file-input')?.addEventListener('change', async e => {
      const file = e.target.files?.[0]; if (!file) return
      document.getElementById('up-file-name').textContent = file.name
      document.getElementById('up-file-name').style.display = 'block'
      _resetPreview(); await _parseFile(file)
    })
    document.getElementById('up-submit-btn')?.addEventListener('click', async () => {
      if (!_parsedPayload) return
      const entityId = document.getElementById('up-entity')?.value || null
      await _doUpload({ ..._parsedPayload, client_id: document.getElementById('up-client')?.value, platform: document.getElementById('up-platform')?.value?.toLowerCase(), entity_id: entityId })
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

    function _detectLinkedInFileType(wb) {
      const sheets = wb.SheetNames.map(n => n.toLowerCase().trim())
      if (sheets.includes('metrics') && sheets.includes('all posts')) return 'content'
      if (sheets.includes('new followers')) return 'followers'
      if (sheets.includes('visitor metrics')) return 'visitors'
      return null
    }

    function _isInstagramSheet(headerRow) {
      const headers = headerRow.map(h => String(h).trim().toLowerCase())
      return headers.includes('post id') && headers.includes('permalink') && headers.includes('post type') && headers.includes('views')
    }

    async function _parseFile(file) {
      if (typeof XLSX === 'undefined') { _showError('SheetJS library is not loaded. Please refresh the page and try again.'); return }
      try {
        const platform = document.getElementById('up-platform')?.value || 'LinkedIn'
        let wb
        if (file.name.toLowerCase().endsWith('.csv')) {
          const text = await file.text()
          wb = XLSX.read(text, { type: 'string', cellDates: false })
        } else {
          wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false })
        }
        if (platform === 'Instagram') {
          _parseInstagramFile(wb)
        } else {
          const fileType = _detectLinkedInFileType(wb)
          if (!fileType) { _showError("This file doesn't look like a valid LinkedIn analytics export. Expected: a Content export (Metrics + All posts sheets), a Followers export (New followers sheet), or a Visitors export (Visitor metrics sheet)."); return }
          if (fileType === 'content')        await _parseContentFile(wb)
          else if (fileType === 'followers') _parseFollowersFile(wb)
          else if (fileType === 'visitors')  _parseVisitorsFile(wb)
        }
      } catch (err) { console.error('[ClientDashboard] parse error', err); _showError('Failed to parse file: ' + (err.message || 'Unknown error.')) }
    }

    function _parseInstagramFile(wb) {
      // Instagram Insights exports a single sheet (named after the account or arbitrary)
      // with per-post rows. Detect the right sheet by column headers.
      let igSheet = null
      for (const name of wb.SheetNames) {
        const s = wb.Sheets[name]
        const preview = XLSX.utils.sheet_to_json(s, { header: 1, defval: '', range: 0 })
        if (preview.length && _isInstagramSheet(preview[0])) { igSheet = s; break }
      }
      if (!igSheet) { _showError("This file doesn't look like a valid Instagram Insights export. Expected columns: Post ID, Permalink, Post type, Views, Reach, Likes, Shares, Comments, Saves."); return }

      const rows = XLSX.utils.sheet_to_json(igSheet, { header: 1, defval: '' })
      if (rows.length < 2) { _showError('The Instagram file appears to be empty.'); return }

      const headers = rows[0].map(h => String(h).trim())
      const idx     = h => headers.indexOf(h)

      const posts = []
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i]
        // Publish time format: "MM/DD/YYYY HH:MM" — strip the time part before passing to _parseDate
        const publishRaw  = String(row[idx('Publish time')] || '').trim()
        const datePart    = publishRaw.includes(' ') ? publishRaw.split(' ')[0] : publishRaw
        const createdDate = _parseDate(datePart)
        if (!createdDate) continue

        const views    = _num(row[idx('Views')])
        const reach    = _num(row[idx('Reach')])
        const likes    = _num(row[idx('Likes')])
        const comments = _num(row[idx('Comments')])
        const saves    = _num(row[idx('Saves')])
        const shares   = _num(row[idx('Shares')])
        const follows  = _num(row[idx('Follows')])
        const engRate  = views > 0 ? (likes + comments + saves + shares) / views : 0
        const postType = String(row[idx('Post type')] || '').trim()

        posts.push({
          post_title:          String(row[idx('Description')] || '').slice(0, 2000),
          post_url:            String(row[idx('Permalink')]   || ''),
          post_type:           postType,
          content_type:        postType,
          posted_by:           String(row[idx('Account username')] || ''),
          created_date:        createdDate,
          impressions:         views,
          views:               views,
          reach:               reach,   // stored once social_posts.reach column is added via migration
          likes:               likes,   // Instagram Likes = social_posts.likes (platform-agnostic)
          comments:            comments,
          reposts_shares:      shares,  // Instagram Shares = reposts_shares
          follows:             follows,
          saves:               saves,
          engagement_rate:     engRate,
          clicks:              0,
          offsite_views:       0,
          ctr:                 0,
          campaign_name:       '',
          campaign_start_date: null,
          campaign_end_date:   null,
          audience:            '',
        })
      }

      if (!posts.length) { _showError('No valid post data found in the Instagram file. Check that the Publish time column is not empty.'); return }

      // Derive daily aggregated metrics from posts (for trend chart / KPIs)
      const dayMap = {}
      for (const p of posts) {
        if (!dayMap[p.created_date]) dayMap[p.created_date] = { impressions: 0, reach: 0, reactions: 0, comments: 0, reposts_shares: 0, follows: 0, saves: 0, eng_sum: 0, count: 0 }
        const d = dayMap[p.created_date]
        d.impressions    += p.impressions
        d.reach          += p.reach
        d.reactions      += p.likes       // likes → reactions in daily metrics
        d.comments       += p.comments
        d.reposts_shares += p.reposts_shares
        d.follows        += p.follows
        d.saves          += p.saves
        d.eng_sum        += p.engagement_rate
        d.count++
      }

      const metrics = Object.entries(dayMap).map(([date, d]) => {
        const engRate = d.count > 0 ? d.eng_sum / d.count : 0
        return {
          date,
          impressions:               d.impressions,
          reach:                     d.reach,
          clicks:                    0,
          reactions:                 d.reactions,  // likes summed as reactions
          comments:                  d.comments,
          reposts_shares:            d.reposts_shares,
          follows:                   d.follows,
          saves:                     d.saves,       // now populated from post-level data
          engagement_rate:           engRate,
          // Organic = all (Instagram basic export doesn't split organic/sponsored)
          impressions_organic:       d.impressions,
          impressions_sponsored:     0,
          unique_impressions_organic: d.reach,
          clicks_organic:            0,
          clicks_sponsored:          0,
          reactions_organic:         d.reactions,
          reactions_sponsored:       0,
          comments_organic:          d.comments,
          comments_sponsored:        0,
          reposts_organic:           d.reposts_shares,
          reposts_sponsored:         0,
          engagement_rate_organic:   engRate,
          engagement_rate_sponsored: 0,
        }
      })

      const allDates = posts.map(p => p.created_date).sort()
      const dFrom = allDates[0] || '—', dTo = allDates[allDates.length - 1] || '—'
      _parsedPayload = { data_type: 'content', metrics, posts }
      _showPreview(_previewAlert(`Found <strong>${posts.length}</strong> Instagram posts across <strong>${metrics.length}</strong> day(s).`, dFrom, dTo))
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
    str = str.trim()
    if (!str) return null
    // Excel serial number (e.g. "45292") — LinkedIn date cells come back as serials when cellDates:false
    if (/^\d+$/.test(str)) {
      const d = new Date((parseInt(str, 10) - 25569) * 86400 * 1000)
      if (isNaN(d.getTime())) return null
      return d.toISOString().slice(0, 10)
    }
    // YYYY-MM-DD (ISO)
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str
    // M/D/YYYY or MM/DD/YYYY
    const [m, d, y] = str.split('/'); if (!m || !d || !y) return null
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`
  }
  function _shortDate(iso) {
    if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return iso
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  }

  return { render, init }
})()

ModuleRegistry.register({
  key:       'client_dashboard',
  routeId:   'client-dashboard',
  label:     'Client Dashboard',
  order:     1,
  icon:      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>`,
  getModule: () => ClientDashboard,
  features:  {
    view_dashboard:          'View Dashboard',
    upload_performance_data: 'Upload Performance Data',
    update_client_status:    'Update Client Status',
  },
})
