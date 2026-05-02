/* ============================================================
   ASSET MANAGEMENT v2 — Phase 10
   Ownership · Lifecycle · Repairs · Photo history
   ============================================================ */

const Assets = (() => {

  let _user         = null
  let _assets       = []
  let _employees    = []
  let _types        = []
  let _repairs      = []
  let _requests     = []   // asset requests visible to this user
  let _locations    = []
  let _isManager    = false
  let _activeTab    = 'all'
  let _p            = null
  let _filterType   = ''
  let _filterStatus = ''
  let _filterSearch = ''

  const CONDITIONS = ['New', 'Good', 'Fair', 'Poor']

  const STATUSES = {
    available:    { label: 'Available',    cls: 'badge--success' },
    in_use:       { label: 'In Use',       cls: 'badge--primary' },
    under_repair: { label: 'Under Repair', cls: 'badge--warning' },
    lost:         { label: 'Lost',         cls: 'badge--danger'  },
    retired:      { label: 'Retired',      cls: 'badge--muted'   },
  }

  const REPAIR_STATUS = {
    open:        { label: 'Open',        cls: 'badge--danger'  },
    in_progress: { label: 'In Progress', cls: 'badge--warning' },
    resolved:    { label: 'Resolved',    cls: 'badge--success' },
  }

  const HISTORY_ICONS = {
    created:           '📦',
    assigned:          '👤',
    returned:          '↩️',
    condition_updated: '🔄',
    photo_added:       '📷',
    lost:              '⚠️',
    retired:           '🗃️',
    repair_logged:     '🔧',
    repair_resolved:   '✅',
  }

  /* ── Helpers ─────────────────────────────────────────────── */

  function _statusBadge(status) {
    const s = STATUSES[status]
    return s ? `<span class="badge ${s.cls}">${s.label}</span>`
             : `<span class="badge badge--muted">${status || '—'}</span>`
  }

  function _repairBadge(status) {
    const s = REPAIR_STATUS[status]
    return s ? `<span class="badge ${s.cls}">${s.label}</span>`
             : `<span class="badge badge--muted">${status}</span>`
  }

  function _conditionBadge(condition) {
    const map = { New: 'badge--success', Good: 'badge--primary', Fair: 'badge--warning', Poor: 'badge--danger' }
    return condition
      ? `<span class="badge ${map[condition] || 'badge--muted'}">${condition}</span>`
      : '—'
  }

  function _historyLabel(h) {
    switch (h.action) {
      case 'created':            return 'Added to inventory'
      case 'assigned':           return `Assigned to ${h.to_emp?.name || '—'}`
      case 'returned':           return `Returned by ${h.from_emp?.name || '—'}`
      case 'condition_updated':  return `Condition updated → ${h.condition_after || '—'}`
      case 'photo_added':        return 'Photo added'
      case 'lost':               return 'Marked as lost'
      case 'retired':            return 'Asset retired'
      case 'repair_logged':      return 'Repair/issue logged'
      case 'repair_resolved':    return 'Repair/issue resolved'
      default:                   return h.action
    }
  }

  function _filteredAssets() {
    return _assets.filter(a => {
      if (!_p.can_view_available && a.status === 'available') return false
      if (_filterType   && a.type   !== _filterType)   return false
      if (_filterStatus && a.status !== _filterStatus) return false
      if (_filterSearch) {
        const q = _filterSearch.toLowerCase()
        if (!a.name.toLowerCase().includes(q) &&
            !(a.serial_number || '').toLowerCase().includes(q) &&
            !(a.asset_tag     || '').toLowerCase().includes(q)) return false
      }
      return true
    })
  }

  function _modalCloseBtn() {
    return `<button class="modal-close" onclick="Utils.closeModal()">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>`
  }

  /* ── render / init ─────────────────────────────────────────── */

  function render(user) {
    return `
      <div class="page-inner">
        <div class="page-toolbar">
          <div class="tabs" id="ast-tabs"></div>
          <div id="ast-toolbar-actions"></div>
        </div>
        <div id="ast-content" class="mt-4"></div>
      </div>`
  }

  async function init(user) {
    _user = user
    _p    = {
      can_view:            App.hasAccess('asset_management', 'view_assets',           'view_only'),
      can_view_available:  App.hasAccess('asset_management', 'view_available_assets', 'view_only'),
      can_request:         App.hasAccess('asset_management', 'request_asset',         'view_only'),
      can_manage:          App.hasAccess('asset_management', 'manage_assets',         'can_manage'),
      can_report:          App.hasAccess('asset_management', 'report_issue',          'view_only'),
      can_resolve:         App.hasAccess('asset_management', 'resolve_repair',        'can_manage'),
      can_manage_types:    App.hasAccess('asset_management', 'manage_asset_types',    'can_manage'),
    }
    const canManage = _p.can_manage

    // Parallel data loads
    const [assetsRes, typesRes, locationsRes, managerCheckRes] = await Promise.all([
      API.getAssets(),
      API.getAssetTypes(),
      API.getAssetLocations(),
      // Check if this user is a reporting manager for anyone
      Config.supabase.from('employees').select('id', { count: 'exact', head: true }).eq('manager_id', user.id).eq('status', 'active'),
    ])
    _assets    = assetsRes.data    || []
    _types     = typesRes.data     || []
    _locations = locationsRes.data || []
    _isManager = (managerCheckRes.count || 0) > 0

    // Load repairs
    if (canManage || _p.can_resolve) {
      const [empRes, repairRes] = await Promise.all([API.getEmployees(true), API.getAllAssetRepairs()])
      _employees = empRes.data   || []
      _repairs   = repairRes.data || []
    } else if (_p.can_report) {
      const { data } = await API.getMyAssetRepairs(user.id)
      _repairs = data || []
    }

    // Load asset requests
    if (canManage) {
      const { data } = await API.getAllAssetRequests()
      _requests = data || []
    } else {
      // Own submitted + pending manager approval if manager
      const fetches = [API.getMySubmittedAssetRequests(user.id)]
      if (_isManager) fetches.push(API.getPendingManagerAssetRequests(user.id))
      const results = await Promise.all(fetches)
      const seen = new Set()
      _requests = [...(results[0].data || []), ...(results[1]?.data || [])]
        .filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true })
    }

    // Build tabs now that we know manager status
    const tabs = []
    if (canManage) tabs.push({ id: 'all',      label: 'All Assets'       })
    tabs.push(              { id: 'mine',     label: 'My Assets'        })
    if (canManage || _p.can_request || _isManager) tabs.push({ id: 'requests', label: `Requests${_requests.filter(r => (r.status === 'pending_manager' && r.manager_id === user.id) || (r.status === 'pending_hr' && canManage)).length ? ` (${_requests.filter(r => (r.status === 'pending_manager' && r.manager_id === user.id) || (r.status === 'pending_hr' && canManage)).length})` : ''}` })
    if (canManage || _p.can_resolve || _p.can_report) tabs.push({ id: 'repairs',  label: 'Repairs & Issues' })
    if (canManage || _p.can_manage_types) tabs.push({ id: 'settings', label: 'Settings' })

    const tabsEl = document.getElementById('ast-tabs')
    if (tabsEl) {
      tabsEl.innerHTML = tabs.map((t, i) => `
        <button class="tab-btn${i === 0 ? ' tab-btn--active' : ''}" data-tab="${t.id}">${t.label}</button>
      `).join('')
    }

    _activeTab = canManage ? 'all' : 'mine'
    _bindTabs()
    _loadTab(_activeTab)
  }

  function _bindTabs() {
    document.querySelectorAll('#ast-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#ast-tabs .tab-btn').forEach(b => b.classList.remove('tab-btn--active'))
        btn.classList.add('tab-btn--active')
        _activeTab = btn.dataset.tab
        _loadTab(_activeTab)
      })
    })
  }

  function _loadTab(tab) {
    const toolbar   = document.getElementById('ast-toolbar-actions')
    const canManage = _p.can_manage
    if (toolbar) {
      toolbar.innerHTML = ''
      const btns = []
      if (_p.can_request && (tab === 'all' || tab === 'mine')) {
        btns.push(`<button class="btn btn--secondary btn--sm" id="ast-request-btn">Request Asset</button>`)
      }
      if (tab === 'all' && canManage) {
        btns.push(`<button class="btn btn--primary btn--sm" id="ast-add-btn">+ Add Asset</button>`)
      }
      toolbar.innerHTML = btns.join('')
      document.getElementById('ast-request-btn')?.addEventListener('click', _openRequestModal)
      document.getElementById('ast-add-btn')?.addEventListener('click', _openAddModal)
    }
    switch (tab) {
      case 'all':      return _renderAllTab()
      case 'mine':     return _renderMineTab()
      case 'requests': return _renderRequestsTab()
      case 'repairs':  return _renderRepairsTab()
      case 'settings': return _renderSettingsTab()
    }
  }

  /* ══════════════════════════════════════════════════════════
     ALL ASSETS TAB
  ══════════════════════════════════════════════════════════ */

  function _renderAllTab() {
    const content = document.getElementById('ast-content')
    if (!content) return

    const total       = _assets.length
    const inUse       = _assets.filter(a => a.status === 'in_use').length
    const available   = _assets.filter(a => a.status === 'available').length
    const underRepair = _assets.filter(a => a.status === 'under_repair').length
    const lost        = _assets.filter(a => a.status === 'lost').length
    const openIssues  = _repairs.filter(r => r.status !== 'resolved').length
    const uniqueTypes = [...new Set(_assets.map(a => a.type).filter(Boolean))]

    content.innerHTML = `
      <div class="ast-stats-row">
        <div class="ast-stat"><div class="ast-stat-val">${total}</div><div class="ast-stat-lbl">Total</div></div>
        <div class="ast-stat"><div class="ast-stat-val" style="color:var(--primary)">${inUse}</div><div class="ast-stat-lbl">In Use</div></div>
        ${_p.can_view_available ? `<div class="ast-stat"><div class="ast-stat-val" style="color:var(--success)">${available}</div><div class="ast-stat-lbl">Available</div></div>` : ''}
        <div class="ast-stat"><div class="ast-stat-val" style="color:var(--warning)">${underRepair}</div><div class="ast-stat-lbl">Under Repair</div></div>
        <div class="ast-stat"><div class="ast-stat-val" style="color:var(--danger)">${lost}</div><div class="ast-stat-lbl">Lost</div></div>
        ${openIssues ? `<div class="ast-stat ast-stat--alert"><div class="ast-stat-val" style="color:var(--danger)">${openIssues}</div><div class="ast-stat-lbl">Open Issues</div></div>` : ''}
      </div>

      <div class="ast-filter-bar">
        <input class="form-input" id="ast-search" placeholder="Search name, serial, tag…"
          style="flex:2;min-width:160px;" value="${Utils.escapeHtml(_filterSearch)}">
        <select class="form-select" id="ast-filter-type" style="flex:1;min-width:120px;">
          <option value="">All Types</option>
          ${uniqueTypes.map(t => `<option value="${t}"${_filterType === t ? ' selected' : ''}>${t}</option>`).join('')}
        </select>
        <select class="form-select" id="ast-filter-status" style="flex:1;min-width:130px;">
          <option value="">All Statuses</option>
          ${Object.entries(STATUSES)
            .filter(([v]) => v !== 'available' || _p.can_view_available)
            .map(([v, s]) => `<option value="${v}"${_filterStatus === v ? ' selected' : ''}>${s.label}</option>`).join('')}
        </select>
      </div>

      <div class="section-card" id="ast-table-wrap">${_renderAssetTable()}</div>
    `

    _bindTableActions()

    document.getElementById('ast-search').addEventListener('input', e => {
      _filterSearch = e.target.value
      document.getElementById('ast-table-wrap').innerHTML = _renderAssetTable()
      _bindTableActions()
    })
    document.getElementById('ast-filter-type').addEventListener('change', e => {
      _filterType = e.target.value
      document.getElementById('ast-table-wrap').innerHTML = _renderAssetTable()
      _bindTableActions()
    })
    document.getElementById('ast-filter-status').addEventListener('change', e => {
      _filterStatus = e.target.value
      document.getElementById('ast-table-wrap').innerHTML = _renderAssetTable()
      _bindTableActions()
    })
  }

  function _renderAssetTable() {
    const rows = _filteredAssets()
    if (!rows.length) return `<p class="empty-state-text" style="padding:24px 16px;">No assets match the current filters.</p>`

    return `
      <div class="section-card-header">
        <h3>Assets <span class="text-muted" style="font-weight:400;font-size:13px;">(${rows.length})</span></h3>
      </div>
      <div style="overflow-x:auto;">
        <table class="data-table">
          <thead><tr>
            <th>Name</th><th>Type</th><th>Serial / Tag</th>
            <th>Condition</th><th>Assigned To</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            ${rows.map(a => `
              <tr>
                <td><strong>${Utils.escapeHtml(a.name)}</strong></td>
                <td class="text-muted">${Utils.escapeHtml(a.type || '—')}</td>
                <td class="text-sm text-muted">${Utils.escapeHtml(a.serial_number || a.asset_tag || '—')}</td>
                <td>${_conditionBadge(a.condition)}</td>
                <td>${a.employees ? Utils.escapeHtml(a.employees.name) : '<span class="text-muted">—</span>'}</td>
                <td>${_statusBadge(a.status)}</td>
                <td style="white-space:nowrap;text-align:right;">
                  <button class="btn btn--xs btn--ghost ast-view" data-id="${a.id}">View</button>
                  ${a.status === 'available'
                    ? `<button class="btn btn--xs btn--secondary ast-assign" data-id="${a.id}">Assign</button>`
                    : a.status === 'in_use'
                    ? `<button class="btn btn--xs btn--ghost ast-return" data-id="${a.id}">Return</button>`
                    : ''}
                  ${a.status !== 'retired' && a.status !== 'lost'
                    ? `<button class="btn btn--xs btn--ghost ast-lost" data-id="${a.id}"
                        style="color:var(--danger);" title="Mark Lost">✕</button>`
                    : ''}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`
  }

  function _bindTableActions() {
    document.querySelectorAll('.ast-view').forEach(btn =>
      btn.addEventListener('click', () => _openDetailModal(btn.dataset.id))
    )
    document.querySelectorAll('.ast-assign').forEach(btn =>
      btn.addEventListener('click', () => {
        const a = _assets.find(x => x.id === btn.dataset.id)
        if (a) _openAssignModal(a)
      })
    )
    document.querySelectorAll('.ast-return').forEach(btn =>
      btn.addEventListener('click', () => {
        const a = _assets.find(x => x.id === btn.dataset.id)
        if (a) _openReturnModal(a)
      })
    )
    document.querySelectorAll('.ast-lost').forEach(btn =>
      btn.addEventListener('click', () => {
        const a = _assets.find(x => x.id === btn.dataset.id)
        if (a) _openLostModal(a)
      })
    )
  }

  /* ══════════════════════════════════════════════════════════
     MY ASSETS TAB
  ══════════════════════════════════════════════════════════ */

  function _renderMineTab() {
    const content = document.getElementById('ast-content')
    if (!content) return
    const mine = _assets.filter(a => a.assigned_to === _user.id)

    if (!mine.length) {
      content.innerHTML = `
        <div class="section-card">
          <div class="section-card-body">
            <p class="empty-state-text">No company assets are currently assigned to you.${_p.can_request ? ' Use "Request Asset" to request one.' : ''}</p>
          </div>
        </div>`
      return
    }

    content.innerHTML = `<div class="ast-cards-grid">${mine.map(a => `
      <div class="section-card ast-asset-card">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:12px;">
          <div>
            <div style="font-weight:700;font-size:15px;">${Utils.escapeHtml(a.name)}</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${Utils.escapeHtml(a.type || '')}</div>
          </div>
          ${_statusBadge(a.status)}
        </div>
        <div class="ast-card-meta">
          <div><span class="text-muted">Serial</span><br>${Utils.escapeHtml(a.serial_number || '—')}</div>
          <div><span class="text-muted">Condition</span><br>${a.condition || '—'}</div>
          <div><span class="text-muted">Assigned Since</span><br>${a.assigned_date ? Utils.formatDate(a.assigned_date) : '—'}</div>
          <div><span class="text-muted">Location</span><br>${Utils.escapeHtml(a.location || '—')}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
          <button class="btn btn--xs btn--ghost ast-view" data-id="${a.id}">View Details</button>
          <button class="btn btn--xs btn--danger ast-report" data-id="${a.id}">Report Issue</button>
        </div>
      </div>`).join('')}</div>`

    content.querySelectorAll('.ast-view').forEach(btn =>
      btn.addEventListener('click', () => _openDetailModal(btn.dataset.id))
    )
    content.querySelectorAll('.ast-report').forEach(btn =>
      btn.addEventListener('click', () => {
        const a = _assets.find(x => x.id === btn.dataset.id)
        if (a) _openReportModal(a)
      })
    )
  }

  /* ══════════════════════════════════════════════════════════
     REQUESTS TAB
  ══════════════════════════════════════════════════════════ */

  const REQ_STATUS = {
    pending_manager: { label: 'Awaiting Manager',  cls: 'badge--warning'  },
    pending_hr:      { label: 'Awaiting HR',        cls: 'badge--primary'  },
    approved:        { label: 'Approved',            cls: 'badge--success'  },
    rejected:        { label: 'Rejected',            cls: 'badge--danger'   },
  }

  function _renderRequestsTab() {
    const content = document.getElementById('ast-content')
    if (!content) return

    // Split into sections
    const pendingMyApproval = _requests.filter(r =>
      r.status === 'pending_manager' && r.manager_id === _user.id
    )
    const pendingHRApproval = _p.can_manage ? _requests.filter(r => r.status === 'pending_hr') : []
    const mySubmitted       = _requests.filter(r => r.requested_by === _user.id)
    const allLog            = _p.can_manage ? _requests : []

    function _reqRow(r, showActions) {
      const asset    = r.asset || {}
      const reqBy    = r.requester?.name || '—'
      const statusCfg = REQ_STATUS[r.status] || { label: r.status, cls: 'badge--muted' }
      const stage = r.status === 'pending_manager'
        ? `<div class="ast-req-stage"><span class="ast-req-stage-dot ast-req-stage-dot--active"></span>Manager<span class="ast-req-stage-dot"></span>HR</div>`
        : r.status === 'pending_hr'
        ? `<div class="ast-req-stage"><span class="ast-req-stage-dot ast-req-stage-dot--done"></span>Manager<span class="ast-req-stage-dot ast-req-stage-dot--active"></span>HR</div>`
        : r.status === 'approved'
        ? `<div class="ast-req-stage"><span class="ast-req-stage-dot ast-req-stage-dot--done"></span>Manager<span class="ast-req-stage-dot ast-req-stage-dot--done"></span>HR</div>`
        : `<div class="ast-req-stage ast-req-stage--rejected"><span class="ast-req-stage-dot ast-req-stage-dot--danger"></span>Rejected</div>`

      return `
        <tr>
          <td><strong>${Utils.escapeHtml(asset.name || '—')}</strong><br><span class="text-muted" style="font-size:11px;">${Utils.escapeHtml(asset.type || '')}</span></td>
          <td>${Utils.escapeHtml(reqBy)}</td>
          <td>${Utils.escapeHtml(r.reason || '—')}</td>
          <td>${stage}</td>
          <td><span class="badge ${statusCfg.cls}">${statusCfg.label}</span></td>
          <td class="text-sm text-muted">${Utils.formatDate(r.created_at)}</td>
          <td style="white-space:nowrap;">
            ${showActions && r.status === 'pending_manager' && r.manager_id === _user.id ? `
              <button class="btn btn--xs btn--primary ast-req-approve" data-id="${r.id}" data-stage="manager">Approve</button>
              <button class="btn btn--xs btn--ghost ast-req-reject" data-id="${r.id}" data-stage="manager" style="color:var(--danger);">Reject</button>
            ` : ''}
            ${showActions && r.status === 'pending_hr' && _p.can_manage ? `
              <button class="btn btn--xs btn--primary ast-req-approve" data-id="${r.id}" data-stage="hr">Approve</button>
              <button class="btn btn--xs btn--ghost ast-req-reject" data-id="${r.id}" data-stage="hr" style="color:var(--danger);">Reject</button>
            ` : ''}
          </td>
        </tr>`
    }

    function _reqTable(rows, showActions = false) {
      if (!rows.length) return '<p class="empty-state-text" style="padding:16px;">No requests.</p>'
      return `<div style="overflow-x:auto;"><table class="data-table">
        <thead><tr><th>Asset</th><th>Requested By</th><th>Reason</th><th>Stage</th><th>Status</th><th>Date</th><th></th></tr></thead>
        <tbody>${rows.map(r => _reqRow(r, showActions)).join('')}</tbody>
      </table></div>`
    }

    const sections = []

    if (pendingMyApproval.length) {
      sections.push(`
        <div class="section-card" style="border-left:3px solid var(--warning);">
          <div class="section-card-header"><h3>Pending Your Approval <span class="badge badge--warning" style="margin-left:8px;">${pendingMyApproval.length}</span></h3></div>
          <div class="section-card-body" style="padding:0;">${_reqTable(pendingMyApproval, true)}</div>
        </div>`)
    }

    if (pendingHRApproval.length) {
      sections.push(`
        <div class="section-card" style="border-left:3px solid var(--primary);">
          <div class="section-card-header"><h3>Pending HR Approval <span class="badge badge--primary" style="margin-left:8px;">${pendingHRApproval.length}</span></h3></div>
          <div class="section-card-body" style="padding:0;">${_reqTable(pendingHRApproval, true)}</div>
        </div>`)
    }

    if (_p.can_manage) {
      sections.push(`
        <div class="section-card">
          <div class="section-card-header"><h3>All Requests</h3></div>
          <div class="section-card-body" style="padding:0;">${_reqTable(allLog, true)}</div>
        </div>`)
    } else if (mySubmitted.length || _p.can_request) {
      sections.push(`
        <div class="section-card">
          <div class="section-card-header"><h3>My Requests</h3></div>
          <div class="section-card-body" style="padding:0;">${_reqTable(mySubmitted)}</div>
        </div>`)
    }

    content.innerHTML = sections.length
      ? `<div style="display:flex;flex-direction:column;gap:16px;">${sections.join('')}</div>`
      : '<p class="empty-state-text">No asset requests to show.</p>'

    // Approve
    content.querySelectorAll('.ast-req-approve').forEach(btn => {
      btn.addEventListener('click', () => _openRequestActionModal(btn.dataset.id, btn.dataset.stage, 'approve'))
    })
    // Reject
    content.querySelectorAll('.ast-req-reject').forEach(btn => {
      btn.addEventListener('click', () => _openRequestActionModal(btn.dataset.id, btn.dataset.stage, 'reject'))
    })
  }

  async function _openRequestActionModal(reqId, stage, action) {
    const req    = _requests.find(r => r.id === reqId)
    if (!req) return
    const isApprove = action === 'approve'
    const label     = isApprove ? 'Approve' : 'Reject'
    const assetName = req.asset?.name || 'this asset'
    const reqBy     = req.requester?.name || 'employee'

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">${label} Request</h3>
        <button class="modal-close" onclick="Utils.closeModal()">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <p style="font-size:14px;margin:0 0 16px;">
          ${isApprove ? `Approve <strong>${reqBy}</strong>'s request for <strong>${Utils.escapeHtml(assetName)}</strong>?` : `Reject <strong>${reqBy}</strong>'s request for <strong>${Utils.escapeHtml(assetName)}</strong>?`}
        </p>
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">Note <span style="color:var(--text-muted);font-weight:400;">(optional)</span></label>
          <textarea class="form-input" id="ast-req-action-note" rows="2" placeholder="${isApprove ? 'Any notes for HR…' : 'Reason for rejection…'}" style="resize:vertical;"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn ${isApprove ? 'btn-primary' : 'btn-danger'}" id="ast-req-action-save">${label}</button>
      </div>
    `, '')

    document.getElementById('ast-req-action-save').addEventListener('click', async () => {
      const saveBtn = document.getElementById('ast-req-action-save')
      const note    = document.getElementById('ast-req-action-note')?.value.trim() || null
      saveBtn.disabled = true; saveBtn.textContent = 'Saving…'

      try {
        const now = new Date().toISOString()
        let update = {}

        if (stage === 'manager') {
          update = {
            manager_status:   action === 'approve' ? 'approved' : 'rejected',
            manager_note:     note,
            manager_acted_at: now,
            status:           action === 'approve' ? 'pending_hr' : 'rejected',
          }
        } else {
          update = {
            hr_status:   action === 'approve' ? 'approved' : 'rejected',
            hr_note:     note,
            hr_acted_at: now,
            hr_acted_by: _user.id,
            status:      action === 'approve' ? 'approved' : 'rejected',
          }
        }

        const { error } = await API.updateAssetRequest(reqId, update)
        if (error) throw error

        // Notify employee
        const recipientMsg = action === 'approve' && stage === 'manager'
          ? `Your asset request for "${assetName}" has been approved by your manager and is now with HR.`
          : action === 'approve' && stage === 'hr'
          ? `Your asset request for "${assetName}" has been fully approved! HR will assign it to you shortly.`
          : `Your asset request for "${assetName}" has been rejected.${note ? ' Note: ' + note : ''}`

        await Config.supabase.from('notifications').insert({
          recipient_employee_id: req.requested_by,
          type:      action === 'approve' ? 'success' : 'warning',
          message:   recipientMsg,
          module:    'assets',
          record_id: reqId,
        })

        // If manager approved → notify HR
        if (action === 'approve' && stage === 'manager') {
          const { data: hrs } = await Config.supabase
            .from('employees').select('id').in('role', ['super_admin', 'hr'])
          if (hrs?.length) {
            await Config.supabase.from('notifications').insert(
              hrs.map(e => ({
                recipient_employee_id: e.id,
                type:      'info',
                message:   `${reqBy}'s request for "${assetName}" has been approved by their manager. Awaiting your final approval.`,
                module:    'assets',
                record_id: reqId,
              }))
            )
          }
        }

        // Refresh requests
        if (_p.can_manage) {
          const { data } = await API.getAllAssetRequests()
          _requests = data || []
        } else {
          const [myRes, mgrRes] = await Promise.all([
            API.getMySubmittedAssetRequests(_user.id),
            _isManager ? API.getPendingManagerAssetRequests(_user.id) : Promise.resolve({ data: [] }),
          ])
          const seen = new Set()
          _requests = [...(myRes.data || []), ...(mgrRes.data || [])]
            .filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true })
        }

        Utils.closeModal()
        Utils.showToast(`Request ${action === 'approve' ? 'approved' : 'rejected'}.`, 'success')
        _renderRequestsTab()

      } catch (err) {
        saveBtn.disabled = false; saveBtn.textContent = label
        Utils.showToast(err.message || 'Failed to update request.', 'error')
      }
    })
  }

  /* ══════════════════════════════════════════════════════════
     REPAIRS & ISSUES TAB
  ══════════════════════════════════════════════════════════ */

  function _renderRepairsTab() {
    const content = document.getElementById('ast-content')
    if (!content) return

    const repairs    = _p.can_manage ? _repairs : _repairs.filter(r => r.reported_by === _user.id)
    const open       = repairs.filter(r => r.status === 'open').length
    const inProgress = repairs.filter(r => r.status === 'in_progress').length
    const resolved   = repairs.filter(r => r.status === 'resolved').length

    content.innerHTML = `
      <div class="ast-stats-row" style="margin-bottom:16px;">
        <div class="ast-stat"><div class="ast-stat-val" style="color:var(--danger)">${open}</div><div class="ast-stat-lbl">Open</div></div>
        <div class="ast-stat"><div class="ast-stat-val" style="color:var(--warning)">${inProgress}</div><div class="ast-stat-lbl">In Progress</div></div>
        <div class="ast-stat"><div class="ast-stat-val" style="color:var(--success)">${resolved}</div><div class="ast-stat-lbl">Resolved</div></div>
      </div>
      <div class="section-card">
        <div class="section-card-header"><h3>Repairs & Issues</h3></div>
        <div class="section-card-body">
          ${!repairs.length
            ? '<p class="empty-state-text">No repairs or issues logged.</p>'
            : `<div style="overflow-x:auto;"><table class="data-table">
                <thead><tr>
                  <th>Asset</th><th>Type</th><th>Description</th>
                  <th>Reported By</th><th>Status</th><th>Date</th><th></th>
                </tr></thead>
                <tbody>
                  ${repairs.map(r => {
                    const asset = _assets.find(a => a.id === r.asset_id)
                    return `<tr>
                      <td><strong>${Utils.escapeHtml(asset?.name || '—')}</strong></td>
                      <td><span class="badge badge--muted">${r.type === 'repair' ? 'Repair' : 'Issue'}</span></td>
                      <td class="text-sm">${Utils.escapeHtml(Utils.truncate(r.description, 60))}</td>
                      <td class="text-sm text-muted">${Utils.escapeHtml(r.reported_by_emp?.name || '—')}</td>
                      <td>${_repairBadge(r.status)}</td>
                      <td class="text-sm text-muted">${Utils.formatDate(r.created_at)}</td>
                      <td style="white-space:nowrap;">
                        ${r.photo_url ? `<a href="${Utils.escapeHtml(r.photo_url)}" target="_blank" rel="noopener" class="btn btn--xs btn--ghost">📷</a>` : ''}
                        ${(_p.can_manage || _p.can_resolve) && r.status !== 'resolved'
                          ? `<button class="btn btn--xs btn--secondary ast-resolve" data-id="${r.id}">${r.status === 'open' ? 'Update' : 'Resolve'}</button>`
                          : ''}
                      </td>
                    </tr>`
                  }).join('')}
                </tbody>
              </table></div>`}
        </div>
      </div>`

    content.querySelectorAll('.ast-resolve').forEach(btn =>
      btn.addEventListener('click', () => {
        const r = _repairs.find(x => x.id === btn.dataset.id)
        if (r) _openResolveModal(r)
      })
    )
  }

  /* ══════════════════════════════════════════════════════════
     SETTINGS TAB
  ══════════════════════════════════════════════════════════ */

  function _renderSettingsTab() {
    const content = document.getElementById('ast-content')
    if (!content) return

    // Stats per type / location
    const typeCount = {}
    const locCount  = {}
    _assets.forEach(a => {
      if (a.type)     typeCount[a.type]     = (typeCount[a.type]     || 0) + 1
      if (a.location) locCount[a.location]  = (locCount[a.location]  || 0) + 1
    })

    function _managedList(items, idAttr, countMap, isDefault) {
      if (!items.length) return '<p class="empty-state-text" style="padding:12px 0;">None added yet.</p>'
      return items.map(item => `
        <div class="ast-setting-row" data-row-id="${item.id}">
          <div style="flex:1;min-width:0;">
            <span class="ast-setting-name">${Utils.escapeHtml(item.name)}</span>
            <span class="ast-setting-count">${countMap[item.name] || 0} asset${(countMap[item.name] || 0) !== 1 ? 's' : ''}</span>
          </div>
          <div class="ast-setting-actions">
              <button class="ast-setting-btn ast-setting-edit" data-id="${item.id}" data-name="${Utils.escapeHtml(item.name)}" title="Rename">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="ast-setting-btn ast-setting-del" data-id="${item.id}" data-name="${Utils.escapeHtml(item.name)}" title="Remove" style="color:var(--danger);">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              </button>
            </div>
        </div>`).join('')
    }

    // Summary stats
    const totalAssets    = _assets.length
    const activeAssigned = _assets.filter(a => a.status === 'in_use').length
    const available      = _assets.filter(a => a.status === 'available').length
    const underRepair    = _assets.filter(a => a.status === 'under_repair').length

    content.innerHTML = `
      <div class="ast-settings-wrap">

        <!-- Summary strip -->
        <div class="ast-settings-summary">
          <div class="ast-settings-stat"><div class="ast-settings-stat-val">${totalAssets}</div><div class="ast-settings-stat-lbl">Total Assets</div></div>
          <div class="ast-settings-stat"><div class="ast-settings-stat-val" style="color:var(--primary)">${activeAssigned}</div><div class="ast-settings-stat-lbl">Assigned</div></div>
          <div class="ast-settings-stat"><div class="ast-settings-stat-val" style="color:var(--success)">${available}</div><div class="ast-settings-stat-lbl">Available</div></div>
          <div class="ast-settings-stat"><div class="ast-settings-stat-val" style="color:var(--warning)">${underRepair}</div><div class="ast-settings-stat-lbl">Under Repair</div></div>
          <div class="ast-settings-stat"><div class="ast-settings-stat-val">${_types.length}</div><div class="ast-settings-stat-lbl">Asset Types</div></div>
          <div class="ast-settings-stat"><div class="ast-settings-stat-val">${_locations.length}</div><div class="ast-settings-stat-lbl">Locations</div></div>
        </div>

        <!-- Two-column managed lists -->
        <div class="ast-settings-grid">

          <!-- Asset Types -->
          <div class="section-card">
            <div class="section-card-header">
              <h3>Asset Types</h3>
              <span class="text-muted" style="font-size:12px;">${_types.length} types</span>
            </div>
            <div class="section-card-body">
              <div style="display:flex;gap:8px;margin-bottom:14px;">
                <input class="form-input" id="ast-type-input" placeholder="New type name…" style="flex:1;">
                <button class="btn btn--primary btn--sm" id="ast-type-add">Add</button>
              </div>
              <div id="ast-type-list">${_managedList(_types, 'type', typeCount)}</div>
            </div>
          </div>

          <!-- Asset Locations -->
          <div class="section-card">
            <div class="section-card-header">
              <h3>Locations</h3>
              <span class="text-muted" style="font-size:12px;">${_locations.length} locations</span>
            </div>
            <div class="section-card-body">
              <div style="display:flex;gap:8px;margin-bottom:14px;">
                <input class="form-input" id="ast-loc-input" placeholder="New location name…" style="flex:1;">
                <button class="btn btn--primary btn--sm" id="ast-loc-add">Add</button>
              </div>
              <div id="ast-loc-list">${_managedList(_locations, 'loc', locCount)}</div>
            </div>
          </div>

        </div>
      </div>`

    _bindSettingsEvents(content)
  }

  function _bindSettingsEvents(content) {
    // ── Types ──
    content.querySelector('#ast-type-add')?.addEventListener('click', async () => {
      const input = content.querySelector('#ast-type-input')
      const name  = input.value.trim(); if (!name) return
      const { error } = await API.createAssetType(name)
      if (error) { Utils.showToast(error.message, 'error'); return }
      input.value = ''
      const { data } = await API.getAssetTypes(); _types = data || []
      _renderSettingsTab(); Utils.showToast('Type added.', 'success')
    })

    // ── Locations ──
    content.querySelector('#ast-loc-add')?.addEventListener('click', async () => {
      const input = content.querySelector('#ast-loc-input')
      const name  = input.value.trim(); if (!name) return
      const { error } = await API.createAssetLocation(name)
      if (error) { Utils.showToast(error.message, 'error'); return }
      input.value = ''
      const { data } = await API.getAssetLocations(); _locations = data || []
      _renderSettingsTab(); Utils.showToast('Location added.', 'success')
    })

    // ── Inline edit (both lists) ──
    content.querySelectorAll('.ast-setting-edit').forEach(btn => {
      const isType = !!btn.closest('#ast-type-list')
      btn.addEventListener('click', () => {
        const row      = btn.closest('.ast-setting-row')
        const nameSpan = row.querySelector('.ast-setting-name')
        const actions  = row.querySelector('.ast-setting-actions')
        const original = btn.dataset.name

        nameSpan.outerHTML = `<input class="form-input ast-inline-input" value="${Utils.escapeHtml(original)}" style="flex:1;padding:4px 8px;font-size:13px;height:30px;" maxlength="80">`
        actions.innerHTML  = `
          <button class="btn btn--xs btn--primary ast-inline-save" data-id="${btn.dataset.id}">Save</button>
          <button class="btn btn--xs btn--ghost ast-inline-cancel">Cancel</button>`

        const input = row.querySelector('.ast-inline-input')
        input.focus(); input.select()

        row.querySelector('.ast-inline-cancel').addEventListener('click', _renderSettingsTab)
        row.querySelector('.ast-inline-save').addEventListener('click', async () => {
          const newName = input.value.trim(); if (!newName) return
          const fn = isType ? API.updateAssetType : API.updateAssetLocation
          const { error } = await fn(btn.dataset.id, newName)
          if (error) { Utils.showToast(error.message, 'error'); return }
          if (isType) { const { data } = await API.getAssetTypes();     _types     = data || [] }
          else        { const { data } = await API.getAssetLocations(); _locations = data || [] }
          _renderSettingsTab(); Utils.showToast('Renamed.', 'success')
        })
      })
    })

    // ── Delete (both lists) ──
    content.querySelectorAll('.ast-setting-del').forEach(btn => {
      const isType = !!btn.closest('#ast-type-list')
      btn.addEventListener('click', async () => {
        if (!confirm(`Remove "${btn.dataset.name}"?`)) return
        const fn = isType ? API.deleteAssetType : API.deleteAssetLocation
        const { error } = await fn(btn.dataset.id)
        if (error) { Utils.showToast(error.message, 'error'); return }
        if (isType) { const { data } = await API.getAssetTypes();     _types     = data || [] }
        else        { const { data } = await API.getAssetLocations(); _locations = data || [] }
        _renderSettingsTab(); Utils.showToast('Removed.', 'success')
      })
    })
  }

  /* ══════════════════════════════════════════════════════════
     ASSET DETAIL MODAL
  ══════════════════════════════════════════════════════════ */

  async function _openDetailModal(assetId) {
    const asset = _assets.find(a => a.id === assetId)
    if (!asset) return

    const [{ data: history }, { data: repairs }] = await Promise.all([
      API.getAssetHistory(assetId),
      API.getAssetRepairsForAsset(assetId),
    ])

    const canManage     = _p.can_manage
    const openRepairs   = (repairs || []).filter(r => r.status !== 'resolved').length
    const latestPhoto   = (history || []).find(h => h.photo_url)

    Utils.openModal(`
      <div class="modal-header">
        <div>
          <h3 class="modal-title">${Utils.escapeHtml(asset.name)}</h3>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">
            ${Utils.escapeHtml(asset.type || '')}${asset.serial_number ? ' · ' + Utils.escapeHtml(asset.serial_number) : ''}
            ${asset.asset_tag ? ' · Tag: ' + Utils.escapeHtml(asset.asset_tag) : ''}
          </div>
        </div>
        ${_modalCloseBtn()}
      </div>
      <div class="modal-body" style="max-height:65vh;overflow-y:auto;">

        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:16px;">
          ${_statusBadge(asset.status)}
          ${_conditionBadge(asset.condition)}
          ${latestPhoto ? `<a href="${Utils.escapeHtml(latestPhoto.photo_url)}" target="_blank" rel="noopener" class="btn btn--xs btn--ghost">📷 Latest Photo</a>` : ''}
          ${openRepairs ? `<span class="badge badge--danger">${openRepairs} open issue${openRepairs > 1 ? 's' : ''}</span>` : ''}
        </div>

        <div class="ast-detail-grid" style="margin-bottom:20px;">
          <div><div class="ast-detail-label">Assigned To</div>
            ${asset.employees ? Utils.escapeHtml(asset.employees.name) : '<span class="text-muted">Unassigned</span>'}
          </div>
          <div><div class="ast-detail-label">Since</div>${asset.assigned_date ? Utils.formatDate(asset.assigned_date) : '—'}</div>
          <div><div class="ast-detail-label">Location</div>${Utils.escapeHtml(asset.location || '—')}</div>
          <div><div class="ast-detail-label">Purchase Date</div>${asset.purchase_date ? Utils.formatDate(asset.purchase_date) : '—'}</div>
          <div><div class="ast-detail-label">Vendor</div>${Utils.escapeHtml(asset.vendor || '—')}</div>
          <div><div class="ast-detail-label">Purchase Price</div>
            ${asset.purchase_price ? '₹' + Number(asset.purchase_price).toLocaleString('en-IN') : '—'}
          </div>
        </div>

        ${asset.notes ? `
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:13px;margin-bottom:20px;">
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Notes</div>
            ${Utils.escapeHtml(asset.notes)}
          </div>` : ''}

        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;font-weight:600;">History</div>
        ${!(history || []).length
          ? '<p class="empty-state-text">No history recorded yet.</p>'
          : (history || []).map(h => `
              <div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);">
                <div style="font-size:16px;width:24px;flex-shrink:0;text-align:center;">${HISTORY_ICONS[h.action] || '·'}</div>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:13px;font-weight:500;">${_historyLabel(h)}</div>
                  ${h.notes ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${Utils.escapeHtml(h.notes)}</div>` : ''}
                  <div style="font-size:11px;color:var(--text-muted);margin-top:3px;">
                    ${Utils.formatDate(h.created_at)}
                    ${h.performed_by_emp?.name ? ' · ' + Utils.escapeHtml(h.performed_by_emp.name) : ''}
                    ${h.photo_url ? ` · <a href="${Utils.escapeHtml(h.photo_url)}" target="_blank" rel="noopener" style="color:var(--primary);">📷 Photo</a>` : ''}
                  </div>
                </div>
              </div>`).join('')}
      </div>

      <div class="modal-footer" style="flex-wrap:wrap;gap:8px;">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Close</button>
        ${canManage ? `<button class="btn btn--ghost btn--sm" id="ast-detail-edit">Edit</button>` : ''}
        ${canManage && asset.status === 'available' ? `<button class="btn btn--secondary btn--sm" id="ast-detail-assign">Assign</button>` : ''}
        ${canManage && asset.status === 'in_use'    ? `<button class="btn btn--ghost btn--sm" id="ast-detail-return">Return</button>` : ''}
        <button class="btn btn--primary btn--sm" id="ast-detail-report">Report Issue</button>
      </div>
    `)

    document.getElementById('ast-detail-edit')?.addEventListener('click', () => {
      Utils.closeModal(); _openEditModal(asset)
    })
    document.getElementById('ast-detail-assign')?.addEventListener('click', () => {
      Utils.closeModal(); _openAssignModal(asset)
    })
    document.getElementById('ast-detail-return')?.addEventListener('click', () => {
      Utils.closeModal(); _openReturnModal(asset)
    })
    document.getElementById('ast-detail-report')?.addEventListener('click', () => {
      Utils.closeModal(); _openReportModal(asset)
    })
  }

  /* ══════════════════════════════════════════════════════════
     ADD / EDIT ASSET MODAL
  ══════════════════════════════════════════════════════════ */

  function _openAddModal()       { _openAssetFormModal(null)  }
  function _openEditModal(asset) { _openAssetFormModal(asset) }

  function _openAssetFormModal(asset) {
    const isEdit      = !!asset
    const typeOptions = _types.map(t =>
      `<option value="${Utils.escapeHtml(t.name)}"${asset?.type === t.name ? ' selected' : ''}>${Utils.escapeHtml(t.name)}</option>`
    ).join('')

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">${isEdit ? 'Edit Asset' : 'Add New Asset'}</h3>
        ${_modalCloseBtn()}
      </div>
      <div class="modal-body">
        <div id="ast-form-err" class="alert alert--danger" style="display:none;"></div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Asset Name <span class="required">*</span></label>
            <input class="form-input" id="ast-f-name" value="${Utils.escapeHtml(asset?.name || '')}" placeholder="e.g. MacBook Pro 14">
          </div>
          <div class="form-group">
            <label class="form-label">Type <span class="required">*</span></label>
            <select class="form-select" id="ast-f-type">${typeOptions}</select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Serial Number</label>
            <input class="form-input" id="ast-f-serial" value="${Utils.escapeHtml(asset?.serial_number || '')}" placeholder="Optional">
          </div>
          <div class="form-group">
            <label class="form-label">Asset Tag</label>
            <input class="form-input" id="ast-f-tag" value="${Utils.escapeHtml(asset?.asset_tag || '')}" placeholder="e.g. GRW-001">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Condition</label>
            <select class="form-select" id="ast-f-condition">
              ${CONDITIONS.map(c => `<option value="${c}"${(asset?.condition || 'Good') === c ? ' selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Location</label>
            <select class="form-select" id="ast-f-location">
              <option value="">— Select location —</option>
              ${_locations.map(l => `<option value="${Utils.escapeHtml(l.name)}"${asset?.location === l.name ? ' selected' : ''}>${Utils.escapeHtml(l.name)}</option>`).join('')}
              ${asset?.location && !_locations.find(l => l.name === asset.location) ? `<option value="${Utils.escapeHtml(asset.location)}" selected>${Utils.escapeHtml(asset.location)}</option>` : ''}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Purchase Date</label>
            <input class="form-input" type="date" id="ast-f-purchase-date" value="${asset?.purchase_date || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">Purchase Price (₹)</label>
            <input class="form-input" type="number" id="ast-f-price" value="${asset?.purchase_price || ''}" placeholder="0">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Vendor</label>
          <input class="form-input" id="ast-f-vendor" value="${Utils.escapeHtml(asset?.vendor || '')}" placeholder="Supplier name">
        </div>
        <div class="form-group">
          <label class="form-label">Notes</label>
          <textarea class="form-input" id="ast-f-notes" rows="2" style="resize:vertical;"
            placeholder="Any additional notes…">${Utils.escapeHtml(asset?.notes || '')}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="ast-form-save">${isEdit ? 'Save Changes' : 'Add Asset'}</button>
      </div>
    `)

    document.getElementById('ast-form-save').addEventListener('click', async () => {
      const errEl = document.getElementById('ast-form-err')
      const btn   = document.getElementById('ast-form-save')
      const name  = document.getElementById('ast-f-name').value.trim()

      errEl.style.display = 'none'
      if (!name) { errEl.textContent = 'Asset name is required.'; errEl.style.display = 'block'; return }

      btn.disabled = true; btn.textContent = 'Saving…'

      const payload = {
        name,
        type:           document.getElementById('ast-f-type').value,
        serial_number:  document.getElementById('ast-f-serial').value.trim()          || null,
        asset_tag:      document.getElementById('ast-f-tag').value.trim()             || null,
        condition:      document.getElementById('ast-f-condition').value,
        location:       document.getElementById('ast-f-location').value.trim()        || null,
        purchase_date:  document.getElementById('ast-f-purchase-date').value          || null,
        purchase_price: document.getElementById('ast-f-price').value
                          ? Number(document.getElementById('ast-f-price').value) : null,
        vendor:         document.getElementById('ast-f-vendor').value.trim()          || null,
        notes:          document.getElementById('ast-f-notes').value.trim()           || null,
        updated_at:     new Date().toISOString(),
      }

      let error
      if (isEdit) {
        ;({ error } = await API.updateAsset(asset.id, payload))
      } else {
        const res = await API.createAsset({ ...payload, status: 'available' })
        error = res.error
        if (!error && res.data) {
          await API.addAssetHistory({
            asset_id:     res.data.id,
            action:       'created',
            notes:        'Added to inventory',
            performed_by: _user.id,
          })
        }
      }

      btn.disabled = false; btn.textContent = isEdit ? 'Save Changes' : 'Add Asset'

      if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return }

      Utils.closeModal()
      Utils.showToast(isEdit ? 'Asset updated.' : 'Asset added.', 'success')
      await _refresh()
    })
  }

  /* ══════════════════════════════════════════════════════════
     PHOTO UPLOAD HELPER
  ══════════════════════════════════════════════════════════ */

  async function _uploadPhoto(fileInputId, statusElId, assetId, context) {
    const file = document.getElementById(fileInputId)?.files[0]
    if (!file) return null
    const statusEl = document.getElementById(statusElId)
    if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = 'Uploading photo to Drive…' }
    const result = await API.uploadAssetPhoto(file, assetId, context)
    if (statusEl) statusEl.textContent = result.drive_url ? 'Photo uploaded.' : 'Photo upload failed — continuing without photo.'
    return result.drive_url || null
  }

  /* ══════════════════════════════════════════════════════════
     ASSIGN MODAL
  ══════════════════════════════════════════════════════════ */

  function _openAssignModal(asset) {
    const empOptions = _employees.map(e =>
      `<option value="${e.id}">${Utils.escapeHtml(e.name)}</option>`
    ).join('')

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Assign Asset</h3>${_modalCloseBtn()}
      </div>
      <div class="modal-body">
        <div id="ast-assign-err" class="alert alert--danger" style="display:none;"></div>
        <div style="font-size:13px;font-weight:600;color:var(--text-muted);margin-bottom:16px;">
          ${Utils.escapeHtml(asset.name)} · ${Utils.escapeHtml(asset.type || '')}
        </div>
        <div class="form-group">
          <label class="form-label">Assign To <span class="required">*</span></label>
          <select class="form-select" id="ast-assign-emp">
            <option value="">Select employee…</option>${empOptions}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Condition at Assignment</label>
          <select class="form-select" id="ast-assign-cond">
            ${CONDITIONS.map(c => `<option value="${c}"${(asset.condition || 'Good') === c ? ' selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Notes</label>
          <textarea class="form-input" id="ast-assign-notes" rows="2" style="resize:vertical;"
            placeholder="Any notes about this assignment…"></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Photo <span style="font-weight:400;color:var(--text-muted);">(recommended — saved to Drive)</span></label>
          <input type="file" class="form-input" id="ast-assign-photo" accept="image/*" style="padding:6px;">
          <div id="ast-assign-photo-status" style="font-size:12px;color:var(--primary);margin-top:4px;display:none;"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="ast-assign-save">Assign</button>
      </div>
    `)

    document.getElementById('ast-assign-save').addEventListener('click', async () => {
      const errEl  = document.getElementById('ast-assign-err')
      const btn    = document.getElementById('ast-assign-save')
      const empId  = document.getElementById('ast-assign-emp').value
      const cond   = document.getElementById('ast-assign-cond').value
      const notes  = document.getElementById('ast-assign-notes').value.trim()

      errEl.style.display = 'none'
      if (!empId) { errEl.textContent = 'Please select an employee.'; errEl.style.display = 'block'; return }

      btn.disabled = true; btn.textContent = 'Assigning…'

      const photoUrl = await _uploadPhoto('ast-assign-photo', 'ast-assign-photo-status', asset.id, 'assign')

      const { error } = await API.updateAsset(asset.id, {
        assigned_to:   empId,
        assigned_date: new Date().toISOString().split('T')[0],
        status:        'in_use',
        condition:     cond,
        updated_at:    new Date().toISOString(),
      })

      if (!error) {
        await API.addAssetHistory({
          asset_id:         asset.id,
          action:           'assigned',
          to_employee_id:   empId,
          condition_before: asset.condition,
          condition_after:  cond,
          notes:            notes || null,
          photo_url:        photoUrl,
          performed_by:     _user.id,
        })
      }

      btn.disabled = false; btn.textContent = 'Assign'
      if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return }

      if (empId !== _user.id) {
        API.createNotification({
          recipient_employee_id: empId,
          type: 'info',
          message: `Asset "${Utils.escapeHtml(asset.name)}" has been assigned to you.`,
          module: 'assets',
          record_id: asset.id,
        })
      }
      Utils.closeModal()
      Utils.showToast('Asset assigned.', 'success')
      await _refresh()
    })
  }

  /* ══════════════════════════════════════════════════════════
     RETURN MODAL
  ══════════════════════════════════════════════════════════ */

  function _openReturnModal(asset) {
    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Return Asset</h3>${_modalCloseBtn()}
      </div>
      <div class="modal-body">
        <div id="ast-return-err" class="alert alert--danger" style="display:none;"></div>
        <div style="font-size:13px;font-weight:600;color:var(--text-muted);margin-bottom:16px;">
          ${Utils.escapeHtml(asset.name)}
          ${asset.employees ? ` — returning from ${Utils.escapeHtml(asset.employees.name)}` : ''}
        </div>
        <div class="form-group">
          <label class="form-label">Condition on Return <span class="required">*</span></label>
          <select class="form-select" id="ast-return-cond">
            ${CONDITIONS.map(c => `<option value="${c}"${(asset.condition || 'Good') === c ? ' selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Notes</label>
          <textarea class="form-input" id="ast-return-notes" rows="2" style="resize:vertical;"
            placeholder="Any observations on return…"></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Photo <span style="font-weight:400;color:var(--text-muted);">(recommended — saved to Drive)</span></label>
          <input type="file" class="form-input" id="ast-return-photo" accept="image/*" style="padding:6px;">
          <div id="ast-return-photo-status" style="font-size:12px;color:var(--primary);margin-top:4px;display:none;"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="ast-return-save">Confirm Return</button>
      </div>
    `)

    document.getElementById('ast-return-save').addEventListener('click', async () => {
      const errEl = document.getElementById('ast-return-err')
      const btn   = document.getElementById('ast-return-save')
      const cond  = document.getElementById('ast-return-cond').value
      const notes = document.getElementById('ast-return-notes').value.trim()

      btn.disabled = true; btn.textContent = 'Processing…'

      const photoUrl = await _uploadPhoto('ast-return-photo', 'ast-return-photo-status', asset.id, 'return')

      const { error } = await API.updateAsset(asset.id, {
        assigned_to:   null,
        assigned_date: null,
        status:        'available',
        condition:     cond,
        updated_at:    new Date().toISOString(),
      })

      if (!error) {
        await API.addAssetHistory({
          asset_id:         asset.id,
          action:           'returned',
          from_employee_id: asset.assigned_to,
          condition_before: asset.condition,
          condition_after:  cond,
          notes:            notes || null,
          photo_url:        photoUrl,
          performed_by:     _user.id,
        })
      }

      btn.disabled = false; btn.textContent = 'Confirm Return'
      if (error) { document.getElementById('ast-return-err').textContent = error.message; document.getElementById('ast-return-err').style.display = 'block'; return }

      Utils.closeModal()
      Utils.showToast('Asset returned.', 'success')
      await _refresh()
    })
  }

  /* ══════════════════════════════════════════════════════════
     MARK LOST MODAL
  ══════════════════════════════════════════════════════════ */

  function _openLostModal(asset) {
    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title" style="color:var(--danger);">Mark as Lost</h3>${_modalCloseBtn()}
      </div>
      <div class="modal-body">
        <div id="ast-lost-err" class="alert alert--danger" style="display:none;"></div>
        <p style="font-size:14px;margin-bottom:16px;">
          You are marking <strong>${Utils.escapeHtml(asset.name)}</strong> as lost.
          ${asset.employees
            ? ` The assigned employee <strong>${Utils.escapeHtml(asset.employees.name)}</strong> remains accountable per company policy.`
            : ''}
        </p>
        <div class="form-group">
          <label class="form-label">Notes <span class="required">*</span></label>
          <textarea class="form-input" id="ast-lost-notes" rows="3" style="resize:vertical;"
            placeholder="Describe the circumstances…"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--danger" id="ast-lost-save">Mark as Lost</button>
      </div>
    `)

    document.getElementById('ast-lost-save').addEventListener('click', async () => {
      const errEl = document.getElementById('ast-lost-err')
      const btn   = document.getElementById('ast-lost-save')
      const notes = document.getElementById('ast-lost-notes').value.trim()

      if (!notes) { errEl.textContent = 'Please describe the circumstances.'; errEl.style.display = 'block'; return }

      btn.disabled = true; btn.textContent = 'Saving…'

      const { error } = await API.updateAsset(asset.id, { status: 'lost', updated_at: new Date().toISOString() })

      if (!error) {
        await API.addAssetHistory({ asset_id: asset.id, action: 'lost', notes, performed_by: _user.id })
      }

      btn.disabled = false; btn.textContent = 'Mark as Lost'
      if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return }

      Utils.closeModal()
      Utils.showToast('Asset marked as lost.', 'error')
      await _refresh()
    })
  }

  /* ══════════════════════════════════════════════════════════
     REPORT ISSUE / REPAIR MODAL
  ══════════════════════════════════════════════════════════ */

  function _openReportModal(asset) {
    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Report Issue / Repair</h3>${_modalCloseBtn()}
      </div>
      <div class="modal-body">
        <div id="ast-report-err" class="alert alert--danger" style="display:none;"></div>
        <div style="font-size:13px;font-weight:600;color:var(--text-muted);margin-bottom:16px;">${Utils.escapeHtml(asset.name)}</div>
        <div class="form-group">
          <label class="form-label">Type <span class="required">*</span></label>
          <select class="form-select" id="ast-report-type">
            <option value="issue">Issue</option>
            <option value="repair">Repair Request</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Description <span class="required">*</span></label>
          <textarea class="form-input" id="ast-report-desc" rows="3" style="resize:vertical;"
            placeholder="Describe the issue or repair needed…"></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Photo <span style="font-weight:400;color:var(--text-muted);">(optional — saved to Drive)</span></label>
          <input type="file" class="form-input" id="ast-report-photo" accept="image/*" style="padding:6px;">
          <div id="ast-report-photo-status" style="font-size:12px;color:var(--primary);margin-top:4px;display:none;"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="ast-report-save">Submit Report</button>
      </div>
    `)

    document.getElementById('ast-report-save').addEventListener('click', async () => {
      const errEl = document.getElementById('ast-report-err')
      const btn   = document.getElementById('ast-report-save')
      const type  = document.getElementById('ast-report-type').value
      const desc  = document.getElementById('ast-report-desc').value.trim()

      if (!desc) { errEl.textContent = 'Description is required.'; errEl.style.display = 'block'; return }

      btn.disabled = true; btn.textContent = 'Submitting…'

      const photoUrl = await _uploadPhoto('ast-report-photo', 'ast-report-photo-status', asset.id, 'issue')

      const { error } = await API.createAssetRepair({
        asset_id:    asset.id,
        reported_by: _user.id,
        type,
        description: desc,
        photo_url:   photoUrl,
        status:      'open',
      })

      if (!error) {
        await API.addAssetHistory({
          asset_id:     asset.id,
          action:       'repair_logged',
          notes:        `${type === 'repair' ? 'Repair request' : 'Issue'}: ${desc}`,
          performed_by: _user.id,
        })
      }

      btn.disabled = false; btn.textContent = 'Submit Report'
      if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return }

      Utils.closeModal()
      Utils.showToast('Issue reported.', 'success')

      if (_p.can_manage) {
        const { data } = await API.getAllAssetRepairs()
        _repairs = data || []
      }
    })
  }

  /* ══════════════════════════════════════════════════════════
     RESOLVE REPAIR MODAL
  ══════════════════════════════════════════════════════════ */

  function _openResolveModal(repair) {
    const asset = _assets.find(a => a.id === repair.asset_id)

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">${repair.status === 'open' ? 'Update Issue' : 'Resolve Issue'}</h3>${_modalCloseBtn()}
      </div>
      <div class="modal-body">
        <div id="ast-resolve-err" class="alert alert--danger" style="display:none;"></div>
        <div style="font-size:13px;margin-bottom:16px;">
          <strong>${Utils.escapeHtml(asset?.name || '—')}</strong>
          <span class="text-muted"> · ${repair.type === 'repair' ? 'Repair' : 'Issue'}</span>
          <br><span class="text-muted">${Utils.escapeHtml(repair.description)}</span>
        </div>
        <div class="form-group">
          <label class="form-label">Update Status <span class="required">*</span></label>
          <select class="form-select" id="ast-resolve-status">
            <option value="in_progress"${repair.status === 'in_progress' ? ' selected' : ''}>In Progress</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Resolution Notes</label>
          <textarea class="form-input" id="ast-resolve-notes" rows="2" style="resize:vertical;"
            placeholder="What was done?"></textarea>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Repair Cost (₹)</label>
            <input class="form-input" type="number" id="ast-resolve-cost" value="${repair.cost || ''}" placeholder="0">
          </div>
          <div class="form-group">
            <label class="form-label">Vendor / Service</label>
            <input class="form-input" id="ast-resolve-vendor" value="${Utils.escapeHtml(repair.vendor || '')}" placeholder="Who did the repair?">
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="ast-resolve-save">Update</button>
      </div>
    `)

    document.getElementById('ast-resolve-save').addEventListener('click', async () => {
      const errEl  = document.getElementById('ast-resolve-err')
      const btn    = document.getElementById('ast-resolve-save')
      const status = document.getElementById('ast-resolve-status').value
      const notes  = document.getElementById('ast-resolve-notes').value.trim()
      const cost   = document.getElementById('ast-resolve-cost').value
      const vendor = document.getElementById('ast-resolve-vendor').value.trim()

      btn.disabled = true; btn.textContent = 'Saving…'

      const payload = {
        status,
        resolution_notes: notes || null,
        cost:             cost ? Number(cost) : null,
        vendor:           vendor || null,
        updated_at:       new Date().toISOString(),
      }
      if (status === 'resolved') {
        payload.resolved_at = new Date().toISOString()
        payload.resolved_by = _user.id
      }

      const { error } = await API.updateAssetRepair(repair.id, payload)

      if (!error && status === 'resolved') {
        await API.addAssetHistory({
          asset_id:     repair.asset_id,
          action:       'repair_resolved',
          notes:        notes || 'Issue resolved',
          performed_by: _user.id,
        })
        const a = _assets.find(x => x.id === repair.asset_id)
        if (a?.status === 'under_repair') {
          await API.updateAsset(a.id, { status: 'available', updated_at: new Date().toISOString() })
        }
      }

      btn.disabled = false; btn.textContent = 'Update'
      if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return }

      Utils.closeModal()
      Utils.showToast('Issue updated.', 'success')
      await _refresh()
    })
  }

  /* ── Request Asset Modal ────────────────────────────────────── */

  function _openRequestModal() {
    const available = _assets.filter(a => a.status === 'available')

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Request an Asset</h3>
        <button class="modal-close" onclick="Utils.closeModal()">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;margin-bottom:16px;font-size:13px;color:var(--text-muted);">
          Your request goes to your reporting manager first, then to HR for final approval.
        </div>
        ${!available.length
          ? '<p class="empty-state-text">No assets are currently available.</p>'
          : `<div style="display:flex;flex-direction:column;gap:8px;">
              ${available.map(a => `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border:1px solid var(--border);border-radius:var(--radius);gap:12px;">
                  <div>
                    <div style="font-weight:600;font-size:14px;">${Utils.escapeHtml(a.name)}</div>
                    <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${Utils.escapeHtml(a.type || '')}${a.serial_number ? ' · ' + Utils.escapeHtml(a.serial_number) : ''}</div>
                  </div>
                  <button class="btn btn--sm btn--primary ast-req-btn" data-id="${a.id}" data-name="${Utils.escapeHtml(a.name)}">Request</button>
                </div>`).join('')}
            </div>`}
        <div class="form-group" style="margin-top:16px;margin-bottom:0;">
          <label class="form-label">Reason <span style="color:var(--text-muted);font-weight:400;">(optional)</span></label>
          <textarea class="form-input" id="ast-req-reason" rows="2" placeholder="Why do you need this asset?" style="resize:vertical;"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">Cancel</button>
      </div>
    `, '')

    document.querySelectorAll('.ast-req-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true; btn.textContent = 'Submitting…'
        const reason = document.getElementById('ast-req-reason')?.value.trim() || null
        try {
          // Look up reporting manager
          const { data: emp } = await Config.supabase
            .from('employees').select('manager_id').eq('id', _user.id).single()
          const managerId = emp?.manager_id || null

          // Create request record
          const { data: req, error } = await API.createAssetRequest({
            asset_id:     btn.dataset.id,
            requested_by: _user.id,
            manager_id:   managerId,
            reason,
            status:       managerId ? 'pending_manager' : 'pending_hr',
          })
          if (error) throw error

          // Notify manager (or HR directly if no manager)
          if (managerId) {
            await Config.supabase.from('notifications').insert({
              recipient_employee_id: managerId,
              type:      'info',
              message:   `${_user.name} has requested an asset: "${btn.dataset.name}". Awaiting your approval.`,
              module:    'assets',
              record_id: req?.id || null,
            })
          } else {
            const { data: admins } = await Config.supabase
              .from('employees').select('id').in('role', ['super_admin', 'hr'])
            if (admins?.length) {
              await Config.supabase.from('notifications').insert(
                admins.map(e => ({
                  recipient_employee_id: e.id,
                  type: 'info',
                  message: `${_user.name} has requested asset: "${btn.dataset.name}" (no manager set — direct HR approval needed).`,
                  module: 'assets', record_id: req?.id || null,
                }))
              )
            }
          }

          // Refresh request list
          if (_p.can_manage) {
            const { data } = await API.getAllAssetRequests()
            _requests = data || []
          } else {
            const [myRes, mgrRes] = await Promise.all([
              API.getMySubmittedAssetRequests(_user.id),
              _isManager ? API.getPendingManagerAssetRequests(_user.id) : Promise.resolve({ data: [] }),
            ])
            const seen = new Set()
            _requests = [...(myRes.data || []), ...(mgrRes.data || [])]
              .filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true })
          }

          Utils.closeModal()
          Utils.showToast(managerId ? 'Request submitted — your manager has been notified.' : 'Request submitted — HR has been notified.', 'success')
        } catch (err) {
          btn.disabled = false; btn.textContent = 'Request'
          Utils.showToast(err.message || 'Failed to submit request.', 'error')
        }
      })
    })
  }

  /* ── Refresh ───────────────────────────────────────────────── */

  async function _refresh() {
    const [assetsRes, repairsRes] = await Promise.all([
      API.getAssets(),
      _p.can_manage ? API.getAllAssetRepairs() : Promise.resolve({ data: [] }),
    ])
    _assets  = assetsRes.data  || []
    _repairs = repairsRes.data || []
    _loadTab(_activeTab)
  }

  return { render, init }

})()

ModuleRegistry.register({
  key:       'asset_management',
  routeId:   'assets',
  label:     'Asset Management',
  order:     6,
  icon:      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"></line><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>`,
  getModule: () => Assets,
  features:  {
    view_assets:           'View Assets',
    view_available_assets: 'View Available Assets',
    request_asset:         'Request Asset',
    manage_assets:         'Manage Assets (assign/return)',
    report_issue:          'Report Repair / Issue',
    resolve_repair:        'Resolve / Close Repairs',
    manage_asset_types:    'Manage Asset Types',
  },
})
