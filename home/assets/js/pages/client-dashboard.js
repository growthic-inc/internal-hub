/* ============================================================
   CLIENT DASHBOARD — real Supabase data
   KPIs, charts, top content, LinkedIn XLS upload pipeline.
   ============================================================ */

const ClientDashboard = (() => {

  // Platform-specific metric configs for the trend chart
  const METRIC_CONFIG_LINKEDIN = {
    impressions:     { label: 'Impressions (Organic)', color: '#0F4799', field: 'impressions_organic' },
    clicks:          { label: 'Clicks (Organic)',      color: '#45BBF0', field: 'clicks_organic' },
    reactions:       { label: 'Reactions',             color: '#1D9E75', field: 'reactions' },
    engagement_rate: { label: 'Engagement Rate',       color: '#EF4444', field: 'engagement_rate_organic', scale: 100 },
    comments:        { label: 'Comments',              color: '#8B5CF6', field: 'comments' },
    reposts_shares:  { label: 'Reposts',               color: '#F59E0B', field: 'reposts_shares' },
  }
  const METRIC_CONFIG_INSTAGRAM = {
    impressions:     { label: 'Views',           color: '#E1306C', field: 'impressions' },
    reactions:       { label: 'Likes',           color: '#1D9E75', field: 'reactions' },
    saves:           { label: 'Saves',           color: '#8B5CF6', field: 'saves' },
    comments:        { label: 'Comments',        color: '#F59E0B', field: 'comments' },
    reposts_shares:  { label: 'Shares',          color: '#45BBF0', field: 'reposts_shares' },
    engagement_rate: { label: 'Engagement Rate', color: '#EF4444', field: 'engagement_rate', scale: 100 },
  }
  // Personal LinkedIn profile — only impressions, total engagements, and eng. rate exist
  const METRIC_CONFIG_PERSONAL = {
    impressions:     { label: 'Impressions',     color: '#0F4799', field: 'impressions' },
    reactions:       { label: 'Engagements',     color: '#1D9E75', field: 'reactions' },
    engagement_rate: { label: 'Engagement Rate', color: '#EF4444', field: 'engagement_rate', scale: 100 },
  }

  function _getMetricConfig() {
    if (_isPersonalProfile) return METRIC_CONFIG_PERSONAL
    return _currentPlatform === 'Instagram' ? METRIC_CONFIG_INSTAGRAM : METRIC_CONFIG_LINKEDIN
  }
  function _getMetricKeys() { return Object.keys(_getMetricConfig()) }
  function _getDefaultActiveMetrics() {
    if (_isPersonalProfile) return ['impressions', 'reactions']
    return _currentPlatform === 'Instagram' ? ['impressions', 'reactions'] : ['impressions', 'clicks']
  }

  let _user = null, _p = null, _clients = [], _currentClient = null, _currentEntity = null
  let _currentPlatform = 'LinkedIn', _currentRange = '30', _currentMonth = _thisMonth()
  let _customDateFrom = '', _customDateTo = ''
  let _trendChart = null, _pubChart = null, _followersChart = null, _visitorsChart = null
  let _activeMetrics = ['impressions', 'clicks']
  let _isPersonalProfile = false
  let _tcSort = { col: 'impressions', dir: 'desc' }, _tcPosts = []
  // Cached from the last successful _loadDashboard() run — read by _exportReport()
  // so Export never has to re-fetch or recompute anything the dashboard already has.
  let _lastKpis = [], _lastPostCount = 0, _lastFollowerCount = 0
  let _lastDemoFollowers = [], _lastDemoVisitors = []
  let _reportBusy = false

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
            <button class="btn btn--ghost btn--sm" id="db-fetch-report-btn">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
              Fetch Report
            </button>
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
      can_create:   App.hasAccess('client_dashboard', 'upload_performance_data', 'can_upload'),
      can_edit:     App.hasAccess('client_dashboard', 'update_client_status',    'can_edit'),
      can_generate: App.hasAccess('client_dashboard', 'generate_report',         'can_manage'),
    }
    _trendChart = null; _pubChart = null; _followersChart = null; _visitorsChart = null; _currentClient = null
    _activeMetrics = _getDefaultActiveMetrics()
    const { data } = await API.getClients()
    _clients = data || []
    _bindClientDropdown()
    _bindFilters()
    if (_p.can_create) {
      document.getElementById('db-upload-btn')?.addEventListener('click', _openUploadModal)
    } else {
      document.getElementById('db-upload-btn')?.remove()
    }
    if (_p.can_generate) {
      document.getElementById('db-fetch-report-btn')?.addEventListener('click', _exportReport)
    } else {
      document.getElementById('db-fetch-report-btn')?.remove()
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
    document.getElementById('db-platform-select')?.addEventListener('change', e => {
      _currentPlatform = e.target.value
      _activeMetrics = _getDefaultActiveMetrics()
      if (_currentClient) _loadDashboard()
    })
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
    return {
      dateFrom: dateFrom.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
      dateTo:   dateTo.toLocaleDateString('en-CA',   { timeZone: 'Asia/Kolkata' }),
    }
  }

  function _getPrevDateRange() {
    const { dateFrom, dateTo } = _getDateRange()
    const from = new Date(dateFrom), to = new Date(dateTo)
    const days = Math.round((to - from) / 86400000)
    const prevTo   = new Date(from); prevTo.setDate(prevTo.getDate() - 1)
    const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - days)
    return {
      dateFrom: prevFrom.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
      dateTo:   prevTo.toLocaleDateString('en-CA',   { timeZone: 'Asia/Kolkata' }),
    }
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
    _lastDemoFollowers = demoFollowers
    _lastDemoVisitors  = demoVisitors
    const prevMetrics = prevMetricsRes.data || [], prevPosts = prevPostsRes.data || [], prevFollowers = prevFollowersRes.data || []

    // Detect personal profile: either via entity profile_type (when entity exists)
    // or from the upload log containing a 'personal_analytics' entry (entity-less clients)
    const _currentEntityData = (_currentClient?.client_entities || []).find(e => e.id === _currentEntity)
    _isPersonalProfile = _currentEntityData?.profile_type === 'personal_profile'
      || uploadLog.some(u => u.data_type === 'personal_analytics')
    // Reset active metrics whenever entity/platform changes
    _activeMetrics = _getDefaultActiveMetrics()

    if (!metrics.length && !posts.length) { _renderEmptyState(body); return }

    if (_trendChart)      { _trendChart.destroy();      _trendChart = null }
    if (_pubChart)        { _pubChart.destroy();        _pubChart = null }
    if (_followersChart)  { _followersChart.destroy();  _followersChart = null }
    if (_visitorsChart)   { _visitorsChart.destroy();   _visitorsChart = null }

    const kpis = _computeKPIs(metrics, posts, followers, prevMetrics, prevPosts, prevFollowers)
    _lastKpis          = kpis
    _lastPostCount     = posts.length
    _lastFollowerCount = followers.reduce((a, r) => a + (_num(r.total_new_followers) || 0), 0)
    const mCfg = _getMetricConfig(), mKeys = _getMetricKeys()
    const isIG = _currentPlatform === 'Instagram'

    // ── Personal profile: simplified layout ─────────────────────────────
    if (_isPersonalProfile) {
      const trendPills = mKeys.map(k =>
        `<span class="chart-metric-pill${_activeMetrics.includes(k) ? ' active' : ''}" data-metric="${k}">${Utils.escapeHtml(mCfg[k].label)}</span>`
      ).join('')
      body.innerHTML = `
        ${_renderContextBar(uploadLog, dateFrom, dateTo)}
        <div class="kpi-grid--personal">${_renderKPICards(kpis)}</div>
        <div class="chart-card mb-4">
          <div class="chart-card-header">
            <span class="chart-card-title">Performance Trend</span>
            <div class="chart-multi-select" id="trend-pills">${trendPills}</div>
          </div>
          <div class="chart-canvas-wrap" style="height:260px;"><canvas id="trend-chart"></canvas></div>
        </div>
        <div class="chart-card mb-4">
          <div class="chart-card-header"><span class="chart-card-title">Weekly Publishing Activity</span></div>
          <div class="chart-canvas-wrap"><canvas id="pub-chart"></canvas></div>
        </div>
        <div class="section-card mb-4">
          <div class="section-card-header"><h3>Top Posts</h3></div>
          <div class="section-card-body" style="padding:0;" data-tc="1">${_renderPersonalTopContent(posts)}</div>
        </div>
        ${_renderAudienceSection(followers, visitors, demoFollowers, demoVisitors)}
      `
      _initTrendChart(metrics)
      _initPubChart(posts)
      _initFollowersChart(followers)
      _bindContextBar(); _bindTrendPills(metrics); _bindDemoTabs(); _bindTopContent()
      return
    }

    // ── Standard company page layout ─────────────────────────────────────
    const organicNote = !isIG ? `<span style="font-size:11px;color:var(--text-muted);background:var(--surface);padding:2px 8px;border-radius:99px;border:1px solid var(--border);">Organic only</span>` : ''
    const _wwHtml = _renderContentTypeBreakdown(posts)

    const analyticsHtml = `
      ${_renderContextBar(uploadLog, dateFrom, dateTo)}
      <div class="kpi-grid" style="margin-bottom:16px;">${_renderKPICards(kpis)}</div>
      <div class="chart-card mb-4">
        <div class="chart-card-header">
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="chart-card-title">Performance Trend</span>
            ${organicNote}
          </div>
          <div class="chart-multi-select" id="trend-pills">
            ${mKeys.map(k => `<span class="chart-metric-pill${_activeMetrics.includes(k) ? ' active' : ''}" data-metric="${k}">${Utils.escapeHtml(mCfg[k].label)}</span>`).join('')}
          </div>
        </div>
        <div class="chart-canvas-wrap" style="height:260px;"><canvas id="trend-chart"></canvas></div>
      </div>

      ${_wwHtml
        ? `<div class="db-pub-row mb-4">
             ${_wwHtml}
             <div class="chart-card db-pub-chart-panel">
               <div class="chart-card-header"><span class="chart-card-title">Weekly Publishing Activity</span></div>
               <div class="chart-canvas-wrap"><canvas id="pub-chart"></canvas></div>
             </div>
           </div>`
        : `<div class="chart-card mb-4">
             <div class="chart-card-header"><span class="chart-card-title">Weekly Publishing Activity</span></div>
             <div class="chart-canvas-wrap"><canvas id="pub-chart"></canvas></div>
           </div>`
      }

      <div class="section-card mb-4">
        <div class="section-card-header"><h3>Top Performing Content</h3></div>
        <div class="section-card-body" style="padding:0;" data-tc="1">${_renderTopContent(posts)}</div>
      </div>
      ${_renderAudienceSection(followers, visitors, demoFollowers, demoVisitors)}
    `

    body.innerHTML = analyticsHtml

    _initTrendChart(metrics); _initPubChart(posts)
    _initFollowersChart(followers); _initVisitorsChart(visitors)
    _bindContextBar(); _bindTrendPills(metrics); _bindDemoTabs(); _bindTopContent(); _bindTopContent()
  }

  /* ── Export report ──────────────────────────────────────────
     Maps everything already computed for the current client/range
     into the exact {{TOKEN}} names the Slides template expects, and
     calls the backend to fill a fresh copy of it. No metric here is
     recalculated — every value is read from what _loadDashboard()
     already computed, so the report can never show a different
     number than what's on screen.
  ── ────────────────────────────────────────────────────────── */
  async function _exportReport() {
    if (_reportBusy) return
    if (!_currentClient) { Utils.showToast('Select a client first.', 'error'); return }

    const btn = document.getElementById('db-fetch-report-btn')
    _reportBusy = true
    if (btn) { btn.disabled = true; btn.textContent = 'Fetching…' }

    try {
      const _reportEntityData = (_currentClient?.client_entities || []).find(e => e.id === _currentEntity)
      const kpiByLabel = {}
      _lastKpis.forEach(k => { kpiByLabel[k.label] = k })
      const rawKpi = label => kpiByLabel[label]?.rawValue ?? 0
      const fmtKpi = label => kpiByLabel[label]?.value ?? '0'

      // Personal Profile's own KPI computation already returns a literal
      // "Engagements" figure — use it directly. Company Page has no single
      // "Engagements" number (Clicks and Reactions are tracked separately),
      // so that one's still a combined interim value, flagged as such,
      // until the Company KPI slide is redesigned to show all 6 individually.
      const engagementsTotal = _isPersonalProfile
        ? rawKpi('Engagements')
        : rawKpi('Clicks') + rawKpi('Reactions')

      const [yearStr, monthStr] = (_currentMonth || _thisMonth()).split('-')
      const year  = parseInt(yearStr, 10)
      const month = parseInt(monthStr, 10)
      const { dateFrom, dateTo } = _getDateRange()
      const dateRangeLabel = `${Utils.formatDate(dateFrom)} – ${Utils.formatDate(dateTo)}`

      const sorted = [..._tcPosts].sort((a, b) => _num(b.impressions) - _num(a.impressions))
      const pct = v => (_num(v) * 100).toFixed(2) + '%'
      // Personal Profile's native LinkedIn export ("Top posts" sheet) never
      // includes a caption/title — only the post URL, date, engagements and
      // impressions. Company Page posts do have a "title" field, but LinkedIn
      // often populates it with the full post caption rather than a short
      // headline, so it's truncated the same as the URL fallback to avoid
      // overflowing the fixed-size title boxes in the Slides template.
      const titleOf      = p => Utils.truncate(p.post_title || p.post_url || '', 100)
      const cardTitleOf  = p => _isPersonalProfile ? (p.post_title || '') : titleOf(p)
      const titleShortOf = p => { const t = cardTitleOf(p); const m = t.match(/^[^.?!]*[.?!]/); return (m ? m[0] : t).trim() || t }
      const postCard = (p) => p ? {
        TITLE:       titleShortOf(p),
        // No separate caption/body field exists in the post data today.
        // Left blank rather than duplicating the title into a second box.
        DESCRIPTION: '',
        IMPRESSIONS: _num(p.impressions).toLocaleString('en-IN'),
        LIKES:       _num(p.likes).toLocaleString('en-IN'),
        COMMENTS:    _num(p.comments).toLocaleString('en-IN'),
        REPOSTS:     _num(p.reposts_shares).toLocaleString('en-IN'),
      } : { TITLE:'', DESCRIPTION:'', IMPRESSIONS:'0', LIKES:'0', COMMENTS:'0', REPOSTS:'0' }

      const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
      const tokens = {
        CLIENT_NAME:      (_isPersonalProfile && _reportEntityData?.entity_name) ? _reportEntityData.entity_name : _currentClient.client_name,
        DATE_RANGE:       dateRangeLabel,
        MONTH:            MONTH_LABELS[month - 1] || '',
        MONTH_YEAR:       `${MONTH_SHORT[month - 1] || ''}'${String(year).slice(2)}`,
        FOLLOWER_COUNT:   _lastFollowerCount.toLocaleString('en-IN'),
        POST_COUNT:       String(_lastPostCount),
        IMPRESSIONS:      fmtKpi('Impressions'),
        CLICKS:           fmtKpi('Clicks'),
        REACTIONS:        fmtKpi('Reactions'),
        ENGAGEMENTS:      engagementsTotal.toLocaleString('en-IN'),
        ENGAGEMENT_RATE:  fmtKpi('Engagement Rate'),
        FOLLOWERS_GAINED: fmtKpi('Followers Gained'),
        FOLLOWER_GROWTH_RATE: (() => {
          const gained = rawKpi('Followers Gained')
          const prev   = _lastFollowerCount - gained
          return prev > 0 ? (gained / prev * 100).toFixed(2) : '0.00'
        })(),
        AVG_IMPRESSIONS_PER_POST: (() => {
          const imp = rawKpi('Impressions')
          return _lastPostCount > 0 ? (imp / _lastPostCount).toLocaleString('en-IN', {maximumFractionDigits: 1}) : '0'
        })(),
      }

      // Featured + 3 supporting cards (Content Performance slide)
      // `links` mirrors `tokens` for any title whose post has a real
      // permalink — the backend turns that title text into a clickable
      // hyperlink back to the original post, so there's no ambiguity
      // about which piece of content a card refers to.
      const links = {}
      const top = postCard(sorted[0])
      tokens.TOP_POST_TITLE       = top.TITLE
      tokens.TOP_POST_TITLE_SHORT = (() => {
        const raw = sorted[0]?.post_title || ''
        if (!raw) return _isPersonalProfile ? '' : top.TITLE
        const first = raw.match(/^[^.?!]*[.?!]/)
        return (first ? first[0] : raw).trim() || raw
      })()
      tokens.TOP_POST_DESCRIPTION = top.DESCRIPTION
      tokens.TOP_POST_IMPRESSIONS = top.IMPRESSIONS
      tokens.TOP_POST_LIKES       = top.LIKES
      tokens.TOP_POST_COMMENTS    = top.COMMENTS
      tokens.TOP_POST_REPOSTS     = top.REPOSTS
      if (sorted[0]?.post_url) links.TOP_POST_TITLE       = sorted[0].post_url
      if (sorted[0]?.post_url) links.TOP_POST_TITLE_SHORT = sorted[0].post_url
      ;[2, 3, 4, 5].forEach((n, i) => {
        const p = sorted[i + 1]
        const c = postCard(p)
        tokens[`POST_${n}_TITLE`]       = c.TITLE
        tokens[`POST_${n}_DESCRIPTION`] = c.DESCRIPTION
        tokens[`POST_${n}_IMPRESSIONS`] = c.IMPRESSIONS
        tokens[`POST_${n}_LIKES`]       = c.LIKES
        tokens[`POST_${n}_COMMENTS`]    = c.COMMENTS
        tokens[`POST_${n}_REPOSTS`]     = c.REPOSTS
        if (p?.post_url) links[`POST_${n}_TITLE`] = p.post_url
      })

      // Top Post table (rows 1-5) — same sorted list, separate token namespace
      ;[1, 2, 3, 4, 5].forEach((n, i) => {
        const p = sorted[i]
        tokens[`POST_${n}`]             = p ? titleOf(p) : ''
        tokens[`POST_${n}_TYPE`]        = p?.content_type || p?.post_type || ''
        tokens[`POST_${n}_POSTED_BY`]   = p?.posted_by || ''
        tokens[`POST_${n}_IMPRESSIONS`] = p ? _num(p.impressions).toLocaleString('en-IN') : '0'
        tokens[`POST_${n}_CLICKS`]      = p ? _num(p.clicks).toLocaleString('en-IN') : '0'
        tokens[`POST_${n}_REACTIONS`]   = p ? _num(p.likes).toLocaleString('en-IN') : '0'
        tokens[`POST_${n}_ENG_RATE`]    = p ? pct(p.engagement_rate) : '0.00%'
        if (p?.post_url) links[`POST_${n}`] = p.post_url
      })

      // Capture every real (canvas-based) chart exactly as currently rendered.
      const chartCanvasMap = {
        PERFORMANCE_CHART: 'trend-chart',
        PUBLISHING_CHART:  'pub-chart',
        FOLLOWERS_CHART:   'followers-chart',
        VISITORS_CHART:    'visitors-chart',
      }
      const chartImages = {}
      Object.entries(chartCanvasMap).forEach(([token, canvasId]) => {
        const canvas = document.getElementById(canvasId)
        if (canvas) chartImages[token] = canvas.toDataURL('image/png').split(',')[1]
      })

      // Demographics: build a polished report-quality bar chart from stored data
      // rather than cloning the compact dashboard element, so label text is
      // never truncated and the visual matches the manual report style.
      if (typeof html2canvas !== 'undefined') {
        const activeTab = document.querySelector('.demo-tab--active')?.dataset.tab
          || (document.getElementById('demo-panel-followers') ? 'followers' : 'visitors')
        const demoData = activeTab === 'followers' ? _lastDemoFollowers : _lastDemoVisitors

        const DEMO_DIMS = {
          industry:     { token: 'DEMOGRAPHICS_INDUSTRY_CHART',     label: 'Industries'    },
          seniority:    { token: 'DEMOGRAPHICS_SENIORITY_CHART',    label: 'Seniority'     },
          location:     { token: 'DEMOGRAPHICS_LOCATION_CHART',     label: 'Location'      },
          job_function: { token: 'DEMOGRAPHICS_JOB_FUNCTION_CHART', label: 'Job Function'  },
          company_size: { token: 'DEMOGRAPHICS_COMPANY_SIZE_CHART', label: 'Company Size'  },
        }

        // Bar colour palette — dark-blue → teal → sky gradient (matches manual)
        const DEMO_PALETTE = [
          '#2354C5','#3A7EE0','#24ABC0','#2ECACE',
          '#1E7090','#45CCEE','#5C6DE0','#3AB5D8',
        ]

        for (const [dimKey, cfg] of Object.entries(DEMO_DIMS)) {
          const allRows = demoData
            .filter(r => r.dimension === dimKey)
            .sort((a, b) => b.value - a.value)
          if (!allRows.length) continue

          // Sum all values so each bar shows its real share of the total audience.
          const total = allRows.reduce((s, r) => s + r.value, 0)
          if (total === 0) continue

          const rows = allRows.slice(0, 8)
          const maxPct   = rows[0].value / total * 100
          const scaleMax = Math.max(Math.ceil(maxPct / 10) * 10, 10)
          const tickStep = Math.ceil(scaleMax / 5 / 10) * 10 || 10
          const ticks    = Array.from({ length: Math.floor(scaleMax / tickStep) + 1 }, (_, i) => i * tickStep)

          const barsHtml = rows.map((row, i) => {
            const pct    = row.value / total * 100
            const barPct = Math.max((pct / scaleMax) * 100, 2).toFixed(1)
            const valStr = parseFloat(pct.toFixed(1)) + '%'
            return `
              <div style="display:flex;align-items:center;gap:12px;margin-bottom:13px;">
                <div style="width:200px;min-width:200px;text-align:right;font-size:12.5px;color:#444;line-height:1.3;padding-right:6px;">${row.label}</div>
                <div style="flex:1;height:36px;border-radius:4px;overflow:hidden;">
                  <div style="width:${barPct}%;height:36px;background:${DEMO_PALETTE[i % DEMO_PALETTE.length]};border-radius:4px;display:flex;align-items:center;padding-left:10px;box-sizing:border-box;min-width:42px;">
                    <span style="font-size:12px;font-weight:700;color:#fff;white-space:nowrap;">${valStr}</span>
                  </div>
                </div>
              </div>`
          }).join('')

          const ticksHtml = `
            <div style="display:flex;margin-left:212px;margin-top:6px;">
              ${ticks.map((t, idx) => `
                <div style="flex:${idx === 0 ? '0 0 0px' : '1 1 0'};text-align:${idx === 0 ? 'left' : idx === ticks.length - 1 ? 'right' : 'center'};font-size:11px;color:#aaa;">${t}%</div>
              `).join('')}
            </div>`

          const chartHtml = `
            <div style="background:#fff;padding:32px 36px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;width:920px;box-sizing:border-box;">
              <div style="text-align:center;margin-bottom:22px;">
                <span style="font-size:13px;font-weight:700;color:#2E3444;text-transform:uppercase;letter-spacing:.08em;">${cfg.label.toUpperCase()}</span>
              </div>
              ${barsHtml}
              ${ticksHtml}
            </div>`

          const wrapper = document.createElement('div')
          wrapper.style.cssText = 'position:fixed;left:-9999px;top:0;'
          wrapper.innerHTML = chartHtml
          document.body.appendChild(wrapper)
          const canvas = await html2canvas(wrapper.firstElementChild, { backgroundColor: '#ffffff', scale: 2 })
          document.body.removeChild(wrapper)
          chartImages[cfg.token] = canvas.toDataURL('image/png').split(',')[1]
        }
      }

      const { data: { session } } = await Config.supabase.auth.getSession()
      if (!session) { Utils.showToast('Session expired — please log in again.', 'error'); return }

      const res = await fetch(`${Config.SUPABASE_URL}/functions/v1/generate-client-report`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey':        Config.SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          client_id: _currentClient.id,
          month, year, tokens, links,
          report_type: _isPersonalProfile ? 'personal' : 'company',
          chart_images: chartImages,
          ...(sorted[0]?.post_url ? { top_post_url: sorted[0].post_url } : {}),
          post_image_urls: [sorted[0], sorted[1], sorted[2]].filter(p => p?.post_url).map(p => p.post_url),
        }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok || data.error) {
        Utils.showToast('Failed to fetch report: ' + (data.error || res.statusText), 'error')
        return
      }

      Utils.showToast('Report ready.', 'success')
      window.open(data.link, '_blank', 'noopener')

    } catch (err) {
      Utils.showToast('Failed to fetch report: ' + err.message, 'error')
    } finally {
      _reportBusy = false
      if (btn) { btn.disabled = false; btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg> Fetch Report` }
    }
  }

  const MONTH_LABELS = ['January','February','March','April','May','June',
    'July','August','September','October','November','December']

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

    const personalBadge = _isPersonalProfile
      ? `<span class="ctx-chip ctx-chip--personal">
           <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
           Personal Profile
         </span>`
      : ''

    return `<div class="db-context-bar">
      <div class="db-context-left">
        <span class="ctx-chip ctx-chip--platform">${platIcon} ${Utils.escapeHtml(_currentPlatform)}</span>
        ${personalBadge}
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
    // LinkedIn
    'Impressions':      { color: '#0F4799', icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>` },
    'Clicks':           { color: '#45BBF0', icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><path d="M10 14L21 3"/><path d="M21 16v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>` },
    'Reactions':        { color: '#1D9E75', icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>` },
    'Engagements':      { color: '#1D9E75', icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>` },
    'Engagement Rate':  { color: '#EF4444', icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>` },
    'Posts Published':  { color: '#8B5CF6', icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>` },
    'Followers Gained': { color: '#F59E0B', icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>` },
    // Instagram
    'Views':            { color: '#E1306C', icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>` },
    'Likes':            { color: '#1D9E75', icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>` },
    'Saves':            { color: '#8B5CF6', icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>` },
    'Comments':         { color: '#F59E0B', icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>` },
    'Shares':           { color: '#45BBF0', icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>` },
  }

  function _computeKPIs(metrics, posts, followers, prevMetrics, prevPosts, prevFollowers) {
    const sum   = (arr, key) => arr.reduce((a, r) => a + _num(r[key]), 0)
    const loc   = n => n.toLocaleString('en-IN')
    const growthPct = (curr, prev) => {
      if (!prev || prev === 0) return null
      const pct = ((curr - prev) / prev) * 100
      return isFinite(pct) ? +pct.toFixed(1) : null
    }

    // New Followers = sum of daily new followers gained in the range
    const totalFollowers    = sum(followers,     'total_new_followers')
    const prevTotalFollowers= sum(prevFollowers, 'total_new_followers')

    if (_isPersonalProfile) {
      // Personal LinkedIn profile — impressions + total engagements (likes+comments+shares) + followers
      // Personal LinkedIn exports have a single "Engagements" column (not split into Likes/Comments/Shares).
      // The parser stores this as engagement_rate = engagements/impressions, leaving reactions/comments/
      // reposts_shares as 0. Back-calculate via rate × impressions when the breakdown is all zeros.
      const _engTotal = arr => arr.reduce((a, m) => {
        const parts = (m.reactions || 0) + (m.comments || 0) + (m.reposts_shares || 0)
        const val   = parts > 0 ? parts : Math.round((m.engagement_rate || 0) * (m.impressions || 0))
        return a + Math.max(0, val)
      }, 0)
      const totalImpressions = sum(metrics, 'impressions')
      const totalEngagements = _engTotal(metrics)
      const avgEng           = metrics.length ? sum(metrics, 'engagement_rate') / metrics.length * 100 : 0
      const pImpressions     = sum(prevMetrics, 'impressions')
      const pEngagements     = _engTotal(prevMetrics)
      const pAvgEng          = prevMetrics.length ? sum(prevMetrics, 'engagement_rate') / prevMetrics.length * 100 : 0
      return [
        { label: 'Impressions',     rawValue: totalImpressions, value: loc(totalImpressions),    growth: growthPct(totalImpressions, pImpressions)    },
        { label: 'Engagements',     rawValue: totalEngagements, value: loc(totalEngagements),    growth: growthPct(totalEngagements, pEngagements)    },
        { label: 'Engagement Rate', rawValue: avgEng,           value: avgEng.toFixed(2) + '%',  growth: growthPct(avgEng,           pAvgEng)         },
        { label: 'Followers Gained',rawValue: totalFollowers,   value: loc(totalFollowers),      growth: growthPct(totalFollowers,   prevTotalFollowers) },
      ]
    }

    if (_currentPlatform === 'Instagram') {
      // Instagram KPIs — all organic (basic export has no paid split)
      const totalViews    = sum(metrics, 'impressions')
      const totalLikes    = sum(metrics, 'reactions')
      const totalSaves    = sum(posts,   'saves')        // saves live on post rows
      const totalComments = sum(metrics, 'comments')
      const totalShares   = sum(metrics, 'reposts_shares')
      const avgEng        = metrics.length ? (sum(metrics, 'engagement_rate') / metrics.length) * 100 : 0

      const pViews    = sum(prevMetrics, 'impressions')
      const pLikes    = sum(prevMetrics, 'reactions')
      const pSaves    = sum(prevPosts,   'saves')
      const pComments = sum(prevMetrics, 'comments')
      const pShares   = sum(prevMetrics, 'reposts_shares')
      const pAvgEng   = prevMetrics.length ? (sum(prevMetrics, 'engagement_rate') / prevMetrics.length) * 100 : 0

      return [
        { label: 'Views',           rawValue: totalViews,    value: loc(totalViews),          growth: growthPct(totalViews,    pViews)           },
        { label: 'Likes',           rawValue: totalLikes,    value: loc(totalLikes),          growth: growthPct(totalLikes,    pLikes)           },
        { label: 'Saves',           rawValue: totalSaves,    value: loc(totalSaves),          growth: growthPct(totalSaves,    pSaves)           },
        { label: 'Comments',        rawValue: totalComments, value: loc(totalComments),       growth: growthPct(totalComments, pComments)        },
        { label: 'Shares',          rawValue: totalShares,   value: loc(totalShares),         growth: growthPct(totalShares,   pShares)          },
        { label: 'Followers Gained',rawValue: totalFollowers,value: loc(totalFollowers),      growth: growthPct(totalFollowers,prevTotalFollowers) },
      ]
    }

    // LinkedIn KPIs — organic metrics only (per user preference)
    const totalImpressions = sum(metrics, 'impressions_organic') || sum(metrics, 'impressions')
    const totalClicks      = sum(metrics, 'clicks_organic')      || sum(metrics, 'clicks')
    const totalReactions   = sum(metrics, 'reactions')
    const avgEng           = metrics.length
      ? (sum(metrics, 'engagement_rate_organic') || sum(metrics, 'engagement_rate')) / metrics.length * 100
      : 0

    const pImpressions = sum(prevMetrics, 'impressions_organic') || sum(prevMetrics, 'impressions')
    const pClicks      = sum(prevMetrics, 'clicks_organic')      || sum(prevMetrics, 'clicks')
    const pReactions   = sum(prevMetrics, 'reactions')
    const pAvgEng      = prevMetrics.length
      ? (sum(prevMetrics, 'engagement_rate_organic') || sum(prevMetrics, 'engagement_rate')) / prevMetrics.length * 100
      : 0

    return [
      { label: 'Impressions',     rawValue: totalImpressions, value: loc(totalImpressions),   growth: growthPct(totalImpressions, pImpressions)    },
      { label: 'Clicks',          rawValue: totalClicks,      value: loc(totalClicks),        growth: growthPct(totalClicks,      pClicks)         },
      { label: 'Reactions',       rawValue: totalReactions,   value: loc(totalReactions),     growth: growthPct(totalReactions,   pReactions)      },
      { label: 'Engagement Rate', rawValue: avgEng,           value: avgEng.toFixed(2) + '%', growth: growthPct(avgEng,           pAvgEng)         },
      { label: 'Posts Published', rawValue: posts.length,     value: loc(posts.length),       growth: growthPct(posts.length,     prevPosts.length)},
      { label: 'Followers Gained',rawValue: totalFollowers,   value: loc(totalFollowers),     growth: growthPct(totalFollowers,   prevTotalFollowers)},
    ]
  }

  function _renderKPICards(kpis) {
    // For personal profiles, hide numeric cards where rawValue is exactly 0
    // (but always show Engagement Rate and % fields even if 0)
    const visible = _isPersonalProfile
      ? kpis.filter(k => k.rawValue !== 0 || k.label === 'Engagement Rate')
      : kpis
    return visible.map(k => {
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
    const mCfg = _getMetricConfig()
    const labels = metrics.map(r => _shortDate(r.date))
    const datasets = _activeMetrics.filter(k => mCfg[k]).map(k => {
      const cfg = mCfg[k], scale = cfg.scale || 1
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
    const mCfg = _getMetricConfig()
    document.querySelectorAll('.chart-metric-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const key = pill.dataset.metric
        if (!mCfg[key]) return
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
    const labels   = followers.map(r => _shortDate(r.date))
    const isIG     = _currentPlatform === 'Instagram'
    // Instagram Follows export only has total new followers (no organic/sponsored split)
    const datasets = isIG
      ? [ _mkDataset('New Followers', followers.map(r => _num(r.total_new_followers)), '#E1306C', followers.length) ]
      : [
          _mkDataset('Organic Followers',   followers.map(r => _num(r.organic_followers)),   '#1D9E75', followers.length),
          _mkDataset('Total New Followers',  followers.map(r => _num(r.total_new_followers)), '#0F4799', followers.length),
        ]
    _followersChart = new Chart(canvas, { type: 'line', data: { labels, datasets }, options: _lineChartOpts(followers.length) })
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
    const isIG = _currentPlatform === 'Instagram'
    // Instagram: page-visitor analytics is a LinkedIn-only concept — hide it
    const showVisitors  = !isIG && visitors.length > 0
    const showFollowers = followers.length > 0
    const hasDemoF      = demoFollowers.length > 0
    const hasDemoV      = !isIG && demoVisitors.length > 0

    if (!showFollowers && !showVisitors && !hasDemoF && !hasDemoV) return ''

    const chartCol = (title, canvasId, subtitle = '') => `
      <div>
        <div style="margin-bottom:8px;">
          <h4 style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin:0;">${title}</h4>
          ${subtitle ? `<span style="font-size:10px;color:var(--text-muted);">${subtitle}</span>` : ''}
        </div>
        <div class="chart-canvas-wrap" style="height:160px;"><canvas id="${canvasId}"></canvas></div>
      </div>`

    const bothCharts = showFollowers && showVisitors
    const chartsHtml = (showFollowers || showVisitors) ? `
      <div style="display:grid;grid-template-columns:${bothCharts ? '1fr 1fr' : '1fr'};gap:16px;margin-bottom:${(hasDemoF || hasDemoV) ? '20px' : '0'};">
        ${showFollowers ? chartCol('Followers Growth', 'followers-chart', isIG ? 'New followers gained per day' : 'Organic + total new followers') : ''}
        ${showVisitors  ? chartCol('Page Visitors',    'visitors-chart',  'Total views & unique visitors') : ''}
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
      // Each dimension block gets a stable id (namespaced by panel, since
      // followers/visitors both render all dims and only one panel is
      // visible at a time) so _exportReport() can DOM-capture it as an
      // image for the report's Demographics slides.
      const renderList = (data, panelKey) => {
        const blocks = DIMS.map(dim => {
          const rows = data.filter(r => r.dimension === dim.key).sort((a, b) => b.value - a.value)
          if (!rows.length) return ''
          const shown = dim.limit ? rows.slice(0, dim.limit) : rows, maxVal = shown[0]?.value || 1
          return `<div id="demo-${panelKey}-${dim.key}" style="min-width:0;background:var(--surface,#fff);padding:8px;">
            <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;padding-bottom:3px;border-bottom:1px solid var(--border);">${dim.label}</div>
            ${shown.map(r => {
              const pct = Math.round((_num(r.value) / maxVal) * 100)
              return `<div style="display:grid;grid-template-columns:1fr 52px 44px;align-items:center;gap:5px;padding:2px 0;">
                <span style="font-size:11px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${Utils.escapeHtml(r.label)}">${Utils.escapeHtml(r.label)}</span>
                <div style="height:3px;background:var(--border);border-radius:2px;"><div style="width:${pct}%;height:100%;background:var(--primary,#0F4799);border-radius:2px;"></div></div>
                <span style="font-size:11px;color:var(--text-muted);text-align:right;white-space:nowrap;">${_num(r.value).toLocaleString('en-IN')}</span>
              </div>`
            }).join('')}
          </div>`
        }).filter(Boolean)
        return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px 24px;">${blocks.join('')}</div>`
      }

      const tabs = [
        hasDemoF ? `<button class="demo-tab demo-tab--active" data-tab="followers">Followers</button>` : '',
        hasDemoV ? `<button class="demo-tab${!hasDemoF ? ' demo-tab--active' : ''}" data-tab="visitors">Visitors</button>` : '',
      ].filter(Boolean).join('')

      const showTabs = hasDemoF && hasDemoV
      demosHtml = `<div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <h4 style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin:0;">Audience Demographics</h4>
          ${showTabs ? `<div style="display:flex;gap:6px;" id="demo-tabs">${tabs}</div>` : ''}
        </div>
        ${hasDemoF ? `<div id="demo-panel-followers" class="demo-panel">${renderList(demoFollowers, 'followers')}</div>` : ''}
        ${hasDemoV ? `<div id="demo-panel-visitors" class="demo-panel" style="display:none;">${renderList(demoVisitors, 'visitors')}</div>` : ''}
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

  /* ── Content type breakdown — "What's Working" ─────────────── */
  function _renderContentTypeBreakdown(posts) {
    if (!posts.length) return ''
    const isIG = _currentPlatform === 'Instagram'

    const _igNorm = { 'ig reel': 'Reel', 'ig video': 'Reel', 'ig image': 'Image', 'ig carousel': 'Carousel', 'ig album': 'Carousel' }
    const normType = raw => {
      if (!raw) return 'Other'
      const key = raw.toLowerCase().trim()
      if (isIG) return _igNorm[key] || (raw.trim() || 'Other')
      const li = raw.trim()
      return ['Video', 'Image', 'Text', 'Carousel', 'Article', 'Document'].includes(li) ? li : (li || 'Other')
    }

    // Group posts by normalized content type
    const groups = {}
    for (const p of posts) {
      const type = normType(p.post_type || p.content_type)
      if (!groups[type]) groups[type] = []
      groups[type].push(p)
    }

    if (Object.keys(groups).length < 1) return ''

    // Compute stats per type
    const typeStats = Object.entries(groups).map(([type, ps]) => {
      const count    = ps.length
      const avgEng   = ps.reduce((a, p) => a + _num(p.engagement_rate), 0) / count
      const avgViews = ps.reduce((a, p) => a + _num(p.impressions), 0) / count
      const avgSaves = ps.reduce((a, p) => a + _num(p.saves), 0) / count
      const avgLikes = ps.reduce((a, p) => a + _num(p.likes), 0) / count
      const avgClicks= ps.reduce((a, p) => a + _num(p.clicks), 0) / count
      const bestPost = [...ps].sort((a, b) => _num(b.engagement_rate) - _num(a.engagement_rate))[0]
      return { type, count, avgEng, avgViews, avgSaves, avgLikes, avgClicks, bestPost }
    }).sort((a, b) => b.avgEng - a.avgEng)

    const maxEng    = Math.max(...typeStats.map(t => t.avgEng), 0.0001)
    const CT_COLORS = { Reel: '#E1306C', Image: '#0F4799', Carousel: '#F59E0B', Video: '#8B5CF6', Text: '#64748B', Article: '#1D9E75', Document: '#45BBF0', Other: '#94A3B8' }

    const engRatio = typeStats.length > 1 && typeStats[1].avgEng > 0
      ? (typeStats[0].avgEng / typeStats[1].avgEng).toFixed(1)
      : null

    const insightLine = (() => {
      if (!engRatio || parseFloat(engRatio) < 1.2) return ''
      const label1 = typeStats[0].type, label2 = typeStats[1]?.type
      return `<div class="ct-insight-bar">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <strong>${Utils.escapeHtml(label1)}</strong> posts get <strong>${engRatio}×</strong> higher engagement than ${Utils.escapeHtml(label2 || 'other types')}${isIG ? '' : ' organically'} — prioritise this format.
      </div>`
    })()

    const cards = typeStats.map((t, idx) => {
      const color      = CT_COLORS[t.type] || '#94A3B8'
      const engPct     = (t.avgEng * 100).toFixed(2)
      const barW       = Math.max(4, Math.round((t.avgEng / maxEng) * 100))
      const bestTitle  = t.bestPost ? Utils.truncate(t.bestPost.post_title || '(no title)', 60) : ''
      const bestUrl    = t.bestPost?.post_url ? Utils.escapeHtml(t.bestPost.post_url) : null
      const bestEng    = t.bestPost ? (_num(t.bestPost.engagement_rate) * 100).toFixed(2) + '%' : '—'
      const isBest     = idx === 0 && typeStats.length > 1

      return `<div class="ct-card" style="border-top:3px solid ${color};">
        <div class="ct-card-head">
          <div class="ct-type-chip" style="color:${color};background:${color}18;">${Utils.escapeHtml(t.type)}</div>
          ${isBest ? `<span class="ct-best-badge">Top Format</span>` : ''}
        </div>
        <div class="ct-post-count">${t.count} post${t.count !== 1 ? 's' : ''}</div>
        <div class="ct-eng-section">
          <div class="ct-stat-row">
            <span class="ct-stat-label">Avg Eng. Rate</span>
            <span class="ct-stat-val" style="color:${color};">${engPct}%</span>
          </div>
          <div class="ct-eng-track"><div class="ct-eng-fill" style="width:${barW}%;background:${color};"></div></div>
        </div>
        <div class="ct-mini-stats">
          <div class="ct-mini-item">
            <div class="ct-mini-label">${isIG ? 'Avg Views' : 'Avg Impressions'}</div>
            <div class="ct-mini-val">${Math.round(t.avgViews).toLocaleString('en-IN')}</div>
          </div>
          <div class="ct-mini-item">
            <div class="ct-mini-label">${isIG ? 'Avg Likes' : 'Avg Reactions'}</div>
            <div class="ct-mini-val">${Math.round(t.avgLikes).toLocaleString('en-IN')}</div>
          </div>
          ${isIG ? `<div class="ct-mini-item">
            <div class="ct-mini-label">Avg Saves</div>
            <div class="ct-mini-val" style="color:#8B5CF6;font-weight:700;">${Math.round(t.avgSaves).toLocaleString('en-IN')}</div>
          </div>` : `<div class="ct-mini-item">
            <div class="ct-mini-label">Avg Clicks</div>
            <div class="ct-mini-val">${Math.round(t.avgClicks).toLocaleString('en-IN')}</div>
          </div>`}
        </div>
        ${t.bestPost ? `<div class="ct-top-post">
          <div class="ct-top-post-label">Best post · ${bestEng} eng.</div>
          ${bestUrl
            ? `<a href="${bestUrl}" target="_blank" rel="noopener" class="ct-top-post-title">${Utils.escapeHtml(bestTitle)}</a>`
            : `<span class="ct-top-post-title">${Utils.escapeHtml(bestTitle)}</span>`}
        </div>` : ''}
      </div>`
    }).join('')

    return `<div class="section-card db-ww-panel">
      <div class="section-card-header">
        <h3>What's Working</h3>
        <span style="font-size:12px;color:var(--text-muted);">Performance by content format</span>
      </div>
      <div class="section-card-body">
        ${insightLine}
        <div class="ct-grid">${cards}</div>
      </div>
    </div>`
  }

  /* ── Top content ────────────────────────────────────────── */
  function _renderTopContent(posts) {
    _tcPosts = posts
    if (!posts.length) return '<p style="padding:24px;color:var(--text-muted);font-size:13px;">No posts in selected range.</p>'
    return _buildTopContentTable()
  }

  /* ── Personal profile top posts (simplified) ───────────────── */
  // Simplified table: Post link, Date, Impressions, Engagements, Eng. Rate
  // No title (personal posts don't have titles), no type, no posted-by
  function _renderPersonalTopContent(posts) {
    _tcPosts = posts
    if (!posts.length) return '<p style="padding:24px;color:var(--text-muted);font-size:13px;">No posts in selected range.</p>'
    return _buildPersonalTopContentTable()
  }

  function _buildPersonalTopContentTable() {
    if (!_tcPosts.length) return ''

    const sorted = [..._tcPosts].sort((a, b) => {
      let av, bv
      if (_tcSort.col === 'impressions')      { av = _num(a.impressions);     bv = _num(b.impressions) }
      else if (_tcSort.col === 'reactions')   { av = _num(a.likes);           bv = _num(b.likes) }
      else                                    { av = _num(a.engagement_rate); bv = _num(b.engagement_rate) }
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
      <th>Post Link</th><th>Date</th>
      ${thSort('impressions',    'Impressions')}
      ${thSort('reactions',      'Engagements')}
      ${thSort('engagement_rate','Eng. Rate')}
    </tr></thead><tbody>${sorted.map(p => {
      const url     = p.post_url ? Utils.escapeHtml(p.post_url) : null
      const label   = url ? Utils.truncate(p.post_url, 60) : '(no link)'
      const engRate = p.engagement_rate != null ? (_num(p.engagement_rate) * 100).toFixed(2) + '%' : '—'
      const engVal  = _num(p.likes)  // engagements stored in likes column for personal posts
      return `<tr>
        <td>${url ? `<a href="${url}" target="_blank" rel="noopener" style="color:var(--primary);font-size:12px;">${Utils.escapeHtml(label)}</a>` : Utils.escapeHtml(label)}</td>
        <td style="white-space:nowrap;">${p.created_date ? Utils.formatDate(p.created_date) : '—'}</td>
        <td style="text-align:right;">${_num(p.impressions).toLocaleString('en-IN')}</td>
        <td style="text-align:right;">${engVal > 0 ? engVal.toLocaleString('en-IN') : '—'}</td>
        <td style="text-align:right;font-weight:600;">${engRate}</td>
      </tr>`
    }).join('')}</tbody></table>`
  }

  function _buildTopContentTable() {
    if (!_tcPosts.length) return ''
    const isIG = _currentPlatform === 'Instagram'

    // Canonical content-type colours (platform-agnostic)
    const CTCOLORS    = { Reel: '#E1306C', Video: '#8B5CF6', Image: '#0F4799', Text: '#64748B', Carousel: '#F59E0B', Article: '#1D9E75', Document: '#45BBF0' }
    const _igTypeNorm = { 'ig reel': 'Reel', 'ig video': 'Reel', 'ig image': 'Image', 'ig carousel': 'Carousel', 'ig album': 'Carousel' }
    const _normType = raw => {
      if (!raw) return isIG ? 'Other' : 'Text'
      const key = raw.toLowerCase().trim()
      if (isIG) return _igTypeNorm[key] || (raw.trim() || 'Other')
      return ['Video', 'Image', 'Text', 'Carousel', 'Article', 'Document'].includes(raw.trim()) ? raw.trim() : (raw.trim() || 'Text')
    }

    const sorted = [..._tcPosts].sort((a, b) => {
      let av, bv
      if (_tcSort.col === 'impressions')      { av = _num(a.impressions);    bv = _num(b.impressions) }
      else if (_tcSort.col === 'likes')       { av = _num(a.likes);          bv = _num(b.likes) }
      else if (_tcSort.col === 'saves')       { av = _num(a.saves);          bv = _num(b.saves) }
      else if (_tcSort.col === 'clicks')      { av = _num(a.clicks);         bv = _num(b.clicks) }
      else                                    { av = _num(a.engagement_rate); bv = _num(b.engagement_rate) }
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

    if (isIG) {
      // Instagram table: Views, Likes, Saves, Eng. Rate
      return `<table class="data-table" id="top-content-table"><thead><tr>
        <th>Post Preview</th><th>Type</th><th>Date</th>
        ${thSort('impressions',    'Views')}
        ${thSort('likes',          'Likes')}
        ${thSort('saves',          'Saves')}
        ${thSort('engagement_rate','Eng. Rate')}
      </tr></thead><tbody>${sorted.map(p => {
        const title   = Utils.truncate(p.post_title || '(no title)', 80)
        const url     = p.post_url ? Utils.escapeHtml(p.post_url) : null
        const ctNorm  = _normType(p.post_type || p.content_type || '')
        const engRate = p.engagement_rate != null ? (_num(p.engagement_rate) * 100).toFixed(2) + '%' : '—'
        const saves   = _num(p.saves)
        return `<tr>
          <td>${url ? `<a href="${url}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;" title="${Utils.escapeHtml(p.post_title||'')}">${Utils.escapeHtml(title)}</a>` : Utils.escapeHtml(title)}</td>
          <td><span style="font-size:11px;font-weight:600;color:${CTCOLORS[ctNorm]||'#64748B'};">${Utils.escapeHtml(ctNorm || '—')}</span></td>
          <td style="white-space:nowrap;">${p.created_date?Utils.formatDate(p.created_date):'—'}</td>
          <td style="text-align:right;">${_num(p.impressions).toLocaleString('en-IN')}</td>
          <td style="text-align:right;">${_num(p.likes).toLocaleString('en-IN')}</td>
          <td style="text-align:right;${saves > 0 ? 'color:#8B5CF6;font-weight:600;' : ''}">${saves > 0 ? saves.toLocaleString('en-IN') : '—'}</td>
          <td style="text-align:right;font-weight:600;">${engRate}</td>
        </tr>`
      }).join('')}</tbody></table>`
    }

    // LinkedIn table: Impressions, Clicks, Likes/Reactions, Eng. Rate
    return `<table class="data-table" id="top-content-table"><thead><tr>
      <th>Post Preview</th><th>Type</th><th>Posted By</th><th>Date</th>
      ${thSort('impressions',    'Impressions')}
      ${thSort('clicks',         'Clicks')}
      ${thSort('likes',          'Reactions')}
      ${thSort('engagement_rate','Eng. Rate')}
    </tr></thead><tbody>${sorted.map(p => {
      const title   = Utils.truncate(p.post_title || '(no title)', 80)
      const url     = p.post_url ? Utils.escapeHtml(p.post_url) : null
      const ctNorm  = _normType(p.content_type || p.post_type || '')
      const engRate = p.engagement_rate != null ? (_num(p.engagement_rate) * 100).toFixed(2) + '%' : '—'
      return `<tr>
        <td>${url ? `<a href="${url}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;" title="${Utils.escapeHtml(p.post_title||'')}">${Utils.escapeHtml(title)}</a>` : Utils.escapeHtml(title)}</td>
        <td><span style="font-size:11px;font-weight:600;color:${CTCOLORS[ctNorm]||'#64748B'};">${Utils.escapeHtml(ctNorm || '—')}</span></td>
        <td style="white-space:nowrap;">${Utils.escapeHtml(p.posted_by||'—')}</td>
        <td style="white-space:nowrap;">${p.created_date?Utils.formatDate(p.created_date):'—'}</td>
        <td style="text-align:right;">${_num(p.impressions).toLocaleString('en-IN')}</td>
        <td style="text-align:right;">${_num(p.clicks).toLocaleString('en-IN')}</td>
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
        if (wrap) {
          wrap.innerHTML = _isPersonalProfile ? _buildPersonalTopContentTable() : _buildTopContentTable()
          _bindTopContent()
        }
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
        if (labelEl) labelEl.textContent = 'Data File (Instagram Insights — Posts or Follows export)'
        if (hintEl)  hintEl.textContent  = 'Posts export (.xlsx, .xls) or Follows export (.csv)'
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
      const selectedClientId = document.getElementById('up-client')?.value
      const selectedClient   = _clients.find(cl => cl.id === selectedClientId)
      const clientLabel      = selectedClient ? Utils.escapeHtml(selectedClient.client_name) : '—'
      return `<div class="alert alert-info" style="margin-bottom:0;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted,#6B7280);">Uploading for</span>
          <span style="font-size:15px;font-weight:700;color:var(--primary,#2563EB);">${clientLabel}</span>
        </div>
        <strong>Ready to upload.</strong> ${summary}<br>Date range: <strong>${Utils.escapeHtml(dFrom)}</strong> to <strong>${Utils.escapeHtml(dTo)}</strong>.<br><span style="color:var(--warning,#B45309);font-size:12px;">This will overwrite existing data in this date range for the selected client.</span>
      </div>`
    }

    function _detectLinkedInFileType(wb) {
      const sheets = wb.SheetNames.map(n => n.toLowerCase().trim())
      if (sheets.includes('metrics') && sheets.includes('all posts')) return 'content'
      if (sheets.includes('new followers')) return 'followers'
      if (sheets.includes('visitor metrics')) return 'visitors'
      // LinkedIn personal profile AggregateAnalytics export (all sheets UPPERCASED)
      if (sheets.includes('engagement') && sheets.includes('top posts')) return 'personal_analytics'
      return null
    }

    // Detects Instagram post-level Insights sheet (any sheet name)
    function _isInstagramSheet(headerRow) {
      const headers = headerRow.map(h => String(h).trim().toLowerCase())
      return headers.includes('post id') && headers.includes('permalink') && headers.includes('post type') && headers.includes('views')
    }

    // Detects Instagram Follows CSV (has "Instagram follows" title row)
    function _isInstagramFollowsFile(wb) {
      for (const name of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' })
        const preview = rows.slice(0, 5).map(r => r.join(' ')).join(' ').toLowerCase()
        if (preview.includes('instagram follow')) return true
      }
      return false
    }

    async function _parseFile(file) {
      if (typeof XLSX === 'undefined') { _showError('SheetJS library is not loaded. Please refresh the page and try again.'); return }
      try {
        const platform = document.getElementById('up-platform')?.value || 'LinkedIn'
        // Always read as arrayBuffer — XLSX handles all formats (xlsx, xls, csv)
        // including UTF-16 LE BOM (Instagram Follows CSV) automatically
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false })
        if (platform === 'Instagram') {
          if (_isInstagramFollowsFile(wb)) _parseInstagramFollowsFile(wb)
          else _parseInstagramFile(wb)
        } else {
          const fileType = _detectLinkedInFileType(wb)
          if (!fileType) { _showError("This file doesn't look like a valid LinkedIn analytics export. Expected: a Content export (Metrics + All posts sheets), a Followers export (New followers sheet), or a Visitors export (Visitor metrics sheet)."); return }
          if (fileType === 'content')             await _parseContentFile(wb)
          else if (fileType === 'followers')     _parseFollowersFile(wb)
          else if (fileType === 'visitors')      _parseVisitorsFile(wb)
          else if (fileType === 'personal_analytics') _parsePersonalAnalyticsFile(wb)
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

    function _parseInstagramFollowsFile(wb) {
      // Follows.csv (UTF-16 LE) has 3 preamble rows: "sep=,", "Instagram follows", "Date","Primary"
      // We locate the sheet, find the real header row, then parse daily follow counts.
      let igSheet = null
      for (const name of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' })
        const preview = rows.slice(0, 5).map(r => r.join(' ')).join(' ').toLowerCase()
        if (preview.includes('instagram follow')) { igSheet = wb.Sheets[name]; break }
      }
      if (!igSheet) { _showError("Couldn't find Instagram Follows data in this file."); return }

      const rows = XLSX.utils.sheet_to_json(igSheet, { header: 1, defval: '' })

      // Find the header row (contains "date" and "primary")
      let headerIdx = -1
      for (let i = 0; i < Math.min(6, rows.length); i++) {
        const cells = rows[i].map(c => String(c).trim().toLowerCase())
        if (cells.includes('date') && cells.includes('primary')) { headerIdx = i; break }
      }
      if (headerIdx === -1) { _showError("Couldn't find Date/Primary columns in the Instagram Follows file."); return }

      const headers = rows[headerIdx].map(h => String(h).trim().toLowerCase())
      const dateIdx = headers.indexOf('date')
      const valIdx  = headers.indexOf('primary')

      const followers_daily = []
      for (let i = headerIdx + 1; i < rows.length; i++) {
        const row     = rows[i]
        const rawDate = String(row[dateIdx] || '').trim()
        if (!rawDate) continue
        // ISO date strings like "2026-02-03T00:00:00" — strip the time component
        const date = rawDate.includes('T') ? rawDate.split('T')[0] : _parseDate(rawDate)
        if (!date) continue
        const count = _num(row[valIdx])
        followers_daily.push({
          date,
          organic_followers:       count,
          sponsored_followers:     0,
          auto_invited_followers:  0,
          total_new_followers:     count,
        })
      }

      if (!followers_daily.length) { _showError('No follower data rows found in the Instagram Follows file.'); return }

      const allDates = followers_daily.map(r => r.date).sort()
      _parsedPayload = { data_type: 'followers', followers_daily, demographics: [] }
      _showPreview(_previewAlert(
        `Found <strong>${followers_daily.length}</strong> days of Instagram follower data.`,
        allDates[0] || '—',
        allDates[allDates.length - 1] || '—'
      ))
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

    // ── LinkedIn personal profile AggregateAnalytics export ──────────────────
    // Sheets: DISCOVERY (totals), ENGAGEMENT (daily), TOP POSTS (dual table),
    //         FOLLOWERS (daily), DEMOGRAPHICS (single combined sheet)
    function _parsePersonalAnalyticsFile(wb) {
      const findSheet = name => {
        const sn = wb.SheetNames.find(n => n.toLowerCase().trim() === name.toLowerCase())
        return sn ? wb.Sheets[sn] : null
      }

      // ── ENGAGEMENT → daily metrics ──────────────────────────────────────
      const engSheet = findSheet('engagement')
      if (!engSheet) { _showError('Could not find "ENGAGEMENT" sheet in this file.'); return }
      const engRows = XLSX.utils.sheet_to_json(engSheet, { header: 1, defval: '' })
      if (engRows.length < 2) { _showError('The ENGAGEMENT sheet appears to be empty.'); return }
      const engH = engRows[0].map(h => String(h).trim())
      const eI   = h => engH.indexOf(h)
      const metrics = []
      for (let i = 1; i < engRows.length; i++) {
        const row  = engRows[i]
        const date = _parseDate(String(row[eI('Date')] || ''))
        if (!date) continue
        const impressions  = _num(row[eI('Impressions')])
        const uniqueImpr   = _num(row[eI('Unique impressions')])
        const clicks       = _num(row[eI('Clicks')])
        const likes        = _num(row[eI('Likes')])
        const comments     = _num(row[eI('Comments')])
        const shares       = _num(row[eI('Shares')])
        // LinkedIn personal ENGAGEMENT sheet only has a single "Engagements" column
        // (no separate Likes/Comments/Shares). When that column exists, use it directly
        // and store the total in `reactions` so the KPI display can sum it correctly.
        // Fall back to summing individual columns for older export formats.
        const hasSingleEngCol = eI('Engagements') >= 0
        const engagements  = hasSingleEngCol
          ? _num(row[eI('Engagements')])
          : likes + comments + shares
        const engRate      = impressions > 0 ? engagements / impressions : 0
        metrics.push({
          date,
          impressions,
          reach:                      uniqueImpr,
          clicks,
          // When the export has a single Engagements column, store the total in reactions
          // so it's directly retrievable; otherwise use the breakdown columns as-is.
          reactions:                  hasSingleEngCol ? engagements : likes,
          comments:                   hasSingleEngCol ? 0 : comments,
          reposts_shares:             hasSingleEngCol ? 0 : shares,
          follows:                    0,
          engagement_rate:            engRate,
          impressions_organic:        impressions,
          impressions_sponsored:      0,
          unique_impressions_organic: uniqueImpr,
          clicks_organic:             clicks,
          clicks_sponsored:           0,
          reactions_organic:          hasSingleEngCol ? engagements : likes,
          reactions_sponsored:        0,
          comments_organic:           hasSingleEngCol ? 0 : comments,
          comments_sponsored:         0,
          reposts_organic:            hasSingleEngCol ? 0 : shares,
          reposts_sponsored:          0,
          engagement_rate_organic:    engRate,
          engagement_rate_sponsored:  0,
        })
      }

      // ── TOP POSTS → posts (dual side-by-side table) ─────────────────────
      // Layout: row 0 = disclaimer, row 1 = headers (cols 0–2: by engagements,
      //         cols 4–6: by impressions), rows 2+ = data
      const posts = []
      const tpSheet = findSheet('top posts')
      if (tpSheet) {
        const tpRows = XLSX.utils.sheet_to_json(tpSheet, { header: 1, defval: '' })
        // Find header row — contains "Post URL"
        let tpHeaderIdx = tpRows.findIndex(r => r.some(c => String(c).trim().toLowerCase() === 'post url'))
        if (tpHeaderIdx >= 0) {
          const postMap = new Map() // url → { date, engagements, impressions }
          for (let i = tpHeaderIdx + 1; i < tpRows.length; i++) {
            const row = tpRows[i]
            // Left table (cols 0–2): top by engagements
            const urlL = String(row[0] || '').trim()
            if (urlL.startsWith('http')) {
              if (!postMap.has(urlL)) postMap.set(urlL, { date: null, engagements: 0, impressions: 0 })
              const e = postMap.get(urlL)
              const d = _parseDate(String(row[1] || '')); if (d) e.date = d
              e.engagements = _num(row[2])
            }
            // Right table (cols 4–6): top by impressions
            const urlR = String(row[4] || '').trim()
            if (urlR.startsWith('http')) {
              if (!postMap.has(urlR)) postMap.set(urlR, { date: null, engagements: 0, impressions: 0 })
              const e = postMap.get(urlR)
              const d = _parseDate(String(row[5] || '')); if (d && !e.date) e.date = d
              e.impressions = _num(row[6])
            }
          }
          for (const [url, d] of postMap.entries()) {
            const engRate = d.impressions > 0 ? d.engagements / d.impressions : 0
            posts.push({
              post_title:          '',
              post_url:            url,
              post_type:           '',
              content_type:        '',
              campaign_name:       '',
              posted_by:           '',
              created_date:        d.date,
              campaign_start_date: null,
              campaign_end_date:   null,
              audience:            '',
              impressions:         d.impressions,
              views:               d.impressions,
              offsite_views:       0,
              clicks:              0,
              ctr:                 0,
              likes:               d.engagements, // total engagements stored as likes
              comments:            0,
              reposts_shares:      0,
              follows:             0,
              engagement_rate:     engRate,
              saves:               0,
            })
          }
        }
      }

      // ── FOLLOWERS → daily follower counts ───────────────────────────────
      // Row 0: "Total followers on <date>, <count>" preamble
      // First row with "Date" header is the actual header row
      const followers_daily = []
      const folSheet = findSheet('followers')
      if (folSheet) {
        const folRows = XLSX.utils.sheet_to_json(folSheet, { header: 1, defval: '' })
        const folHeaderIdx = folRows.findIndex(r => r.some(c => String(c).trim().toLowerCase() === 'date'))
        if (folHeaderIdx >= 0) {
          const folH  = folRows[folHeaderIdx].map(h => String(h).trim().toLowerCase())
          const fdIdx = folH.indexOf('date')
          const fvIdx = folH.findIndex(h => h.includes('follower'))
          for (let i = folHeaderIdx + 1; i < folRows.length; i++) {
            const row  = folRows[i]
            const date = _parseDate(String(row[fdIdx] || ''))
            if (!date) continue
            const count = _num(row[fvIdx])
            followers_daily.push({ date, total_new_followers: count, organic_followers: count, sponsored_followers: 0, auto_invited_followers: 0 })
          }
        }
      }

      // ── DEMOGRAPHICS → single combined sheet ────────────────────────────
      // Format: col 0 = dimension category (Company, Location, …)
      //         col 1 = label (e.g. "Greater Delhi Area")
      //         col 2 = percentage string ("49%" or "< 1%")
      const demographics = []
      const demoSheet = findSheet('demographics')
      if (demoSheet) {
        const dimMap = { 'location': 'location', 'company size': 'company_size', 'seniority': 'seniority', 'job title': 'job_function', 'industry': 'industry' }
        const demoRows = XLSX.utils.sheet_to_json(demoSheet, { header: 1, defval: '' })
        for (let i = 1; i < demoRows.length; i++) { // skip header row
          const row    = demoRows[i]
          const dimRaw = String(row[0] || '').trim().toLowerCase()
          const label  = String(row[1] || '').trim()
          const pctStr = String(row[2] || '').trim()
          if (!dimRaw || !label) continue
          const dk = dimMap[dimRaw]; if (!dk) continue
          // "49%" → 49 | "< 1%" → 0  (DB value column is integer; store whole-number %)
          const value = pctStr.startsWith('<') ? 0 : Math.round(parseFloat(pctStr.replace('%', '')) || 0)
          demographics.push({ dimension: dk, label, value })
        }
      }

      if (!metrics.length) { _showError('No engagement data rows found in the personal analytics file.'); return }

      const allDates = metrics.map(m => m.date).filter(Boolean).sort()
      _parsedPayload = { data_type: 'personal_analytics', metrics, posts, followers_daily, demographics }
      _showPreview(_previewAlert(
        `Found <strong>${metrics.length}</strong> days of engagement data, <strong>${posts.length}</strong> top posts, <strong>${followers_daily.length}</strong> days of follower data &amp; <strong>${demographics.length}</strong> demographic segments.`,
        allDates[0] || '—', allDates[allDates.length - 1] || '—'
      ))
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
      // Personal analytics: one file → two ingest calls (content + followers)
      if (payload.data_type === 'personal_analytics') {
        try {
          const base = { client_id: payload.client_id, platform: payload.platform, entity_id: payload.entity_id, drive_url }
          const [r1, r2] = await Promise.all([
            API.ingestAnalytics({ ...base, data_type: 'personal_analytics', metrics: payload.metrics, posts: payload.posts }),
            API.ingestAnalytics({ ...base, data_type: 'followers', followers_daily: payload.followers_daily, demographics: payload.demographics }),
          ])
          if ((r1.success === false || r1.error) || (r2.success === false || r2.error)) {
            if (btn) { btn.disabled = false; btn.textContent = 'Upload and Process' }
            _showError(r1.error || r2.error || r1.message || r2.message || 'Upload failed.'); return
          }
          // Auto-flag this entity as a personal profile so the simplified view renders on next load
          if (payload.entity_id) {
            await API.updateEntityProfileType(payload.entity_id, 'personal_profile').catch(e => console.warn('[ClientDashboard] profile_type update failed:', e))
            // Refresh the in-memory client so _loadDashboard picks up the new profile_type
            const { data: refreshed } = await API.getClientDashboard(payload.client_id).catch(() => ({ data: null }))
            if (refreshed) _currentClient = refreshed
          }
          Utils.closeModal(); Utils.showToast('Data uploaded successfully.', 'success'); _loadDashboard()
        } catch (err) {
          console.error('[ClientDashboard] upload error', err)
          if (btn) { btn.disabled = false; btn.textContent = 'Upload and Process' }
          _showError('Upload failed: ' + (err.message || 'Unknown error.'))
        }
        return
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
    // Excel serial number — integer (e.g. "45292") or float with time component
    // (e.g. "45999.228...") — SheetJS converts date-like strings to serials even
    // with cellDates:false, so we must handle both integer and decimal forms.
    if (/^\d+(\.\d+)?$/.test(str)) {
      const d = new Date((parseFloat(str) - 25569) * 86400 * 1000)
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
    generate_report:         'Generate Report',
  },
})
