/* ============================================================
   ASSET MANAGEMENT v3 — Revamped Flow
   Self-service return · HR-only approval with auto-assign
   Inventories tab · Retire & Delete lifecycle · Detail redesign
   ============================================================ */

const Assets = (() => {

  let _user      = null
  let _assets    = []
  let _employees = []
  let _types     = []
  let _repairs   = []
  let _requests       = []
  let _returnRequests = []
  let _isManager = false
  let _activeTab = 'all'
  let _p         = null
  let _filterType   = ''
  let _filterStatus = ''
  let _filterSearch = ''

  const CONDITIONS = ['New', 'Good', 'Fair', 'Poor']

  const STATUSES = {
    available:      { label: 'Available',      cls: 'badge--success' },
    in_use:         { label: 'In Use',         cls: 'badge--primary' },
    pending_return: { label: 'Pending Return', cls: 'badge--warning' },
    under_repair:   { label: 'Under Repair',   cls: 'badge--warning' },
    lost:           { label: 'Lost',           cls: 'badge--danger'  },
    retired:        { label: 'Retired',        cls: 'badge--muted'   },
  }

  const REPAIR_STATUS = {
    open:        { label: 'Open',        cls: 'badge--danger'  },
    in_progress: { label: 'In Progress', cls: 'badge--warning' },
    resolved:    { label: 'Resolved',    cls: 'badge--success' },
  }

  const HISTORY_ICONS = {
    created:          '📦',
    assigned:         '👤',
    returned:         '↩️',
    return_requested: '📤',
    condition_updated:'🔄',
    photo_added:      '📷',
    lost:             '⚠️',
    retired:          '🗃️',
    repair_logged:    '🔧',
    repair_resolved:  '✅',
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

  function _typeIcon(type, size = 16) {
    const t = (type || '').toLowerCase()
    const icons = {
      laptop:   `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M2 20h20"/></svg>`,
      phone:    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><circle cx="12" cy="17" r="1"/></svg>`,
      monitor:  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`,
      keyboard: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12"/></svg>`,
      mouse:    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12 2v8M6 10h12"/></svg>`,
      headset:  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>`,
      camera:   `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
      tablet:   `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><circle cx="12" cy="18" r="1"/></svg>`,
      printer:  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>`,
      chair:    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 20v-8a6 6 0 0 1 12 0v8"/><path d="M4 20h16"/><path d="M6 14h12"/></svg>`,
      other:    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3h-8l-2 4h12z"/></svg>`,
    }
    const match = Object.keys(icons).find(k => t.includes(k))
    return `<span class="ast-type-icon" style="color:var(--primary);opacity:0.8;display:inline-flex;align-items:center;flex-shrink:0;">${icons[match] || icons.other}</span>`
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
      case 'returned':           return `Returned by ${h.from_emp?.name || '—'} (HR approved)`
      case 'return_requested':   return `Return requested by ${h.from_emp?.name || '—'}`
      case 'condition_updated':  return `Condition updated → ${h.condition_after || '—'}`
      case 'photo_added':        return 'Photo added'
      case 'lost':               return 'Marked as lost'
      case 'retired':            return 'Asset retired'
      case 'repair_logged':      return 'Repair/issue logged'
      case 'repair_resolved':    return 'Repair/issue resolved'
      default:                   return h.action
    }
  }

  function _modalCloseBtn() {
    return `<button class="modal-close" onclick="Utils.closeModal()">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>`
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
      can_inventories:     App.hasAccess('asset_management', 'view_inventories',      'can_manage'),
      can_retire_delete:   App.hasAccess('asset_management', 'retire_delete_asset',   'can_manage'),
      can_resolve:         App.hasAccess('asset_management', 'resolve_repair',        'can_manage'),
      can_manage_types:    App.hasAccess('asset_management', 'manage_asset_types',    'can_manage'),
    }
    const canManage = _p.can_manage

    // Check if this user is a reporting manager
    const [assetsRes, typesRes, managerCheckRes] = await Promise.all([
      API.getAssets(),
      API.getAssetTypes(),
      Config.supabase.from('employees').select('id', { count: 'exact', head: true }).eq('manager_id', user.id).eq('status', 'active'),
    ])
    _assets    = assetsRes.data  || []
    _types     = typesRes.data   || []
    _isManager = (managerCheckRes.count || 0) > 0

    // HR/managers load employees + all repairs; everyone else loads their own repairs
    if (canManage || _p.can_resolve) {
      const [empRes, repairRes] = await Promise.all([API.getEmployees(true), API.getAllAssetRepairs()])
      _employees = empRes.data   || []
      _repairs   = repairRes.data || []
    } else {
      const { data } = await API.getMyAssetRepairs(user.id)
      _repairs = data || []
    }

    // Load asset requests + return requests
    if (canManage) {
      const [reqsRes, retReqsRes] = await Promise.all([
        API.getAllAssetRequests(),
        API.getAllAssetReturnRequests(),
      ])
      _requests       = reqsRes.data    || []
      _returnRequests = retReqsRes.data || []
    } else {
      const assetReqFetch  = API.getMySubmittedAssetRequests(user.id)
      const returnReqFetch = API.getMyReturnRequests(user.id)
      const fetches = [assetReqFetch, returnReqFetch]
      if (_isManager) fetches.push(API.getPendingManagerAssetRequests(user.id))
      const results = await Promise.all(fetches)
      const seen = new Set()
      _requests       = [...(results[0].data || []), ...(results[2]?.data || [])]
        .filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true })
      _returnRequests = results[1].data || []
    }

    // Build tabs
    const pendingReturnCount = canManage ? _returnRequests.filter(r => r.status === 'pending').length : 0
    const pendingCount = _requests.filter(r => r.status === 'pending_hr' && canManage).length + pendingReturnCount
    const tabs = []
    if (canManage) tabs.push({ id: 'all',         label: 'All Assets' })
    tabs.push(              { id: 'mine',        label: 'My Assets' })
    tabs.push(              { id: 'requests',    label: `Requests${pendingCount ? ` (${pendingCount})` : ''}` })
    tabs.push(              { id: 'repairs',     label: 'Repairs & Issues' })
    if (_p.can_inventories) tabs.push({ id: 'inventories', label: 'Inventories' })
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
      case 'all':          return _renderAllTab()
      case 'mine':         return _renderMineTab()
      case 'requests':     return _renderRequestsTab()
      case 'repairs':      return _renderRepairsTab()
      case 'inventories':  return _renderInventoriesTab()
      case 'settings':     return _renderSettingsTab()
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
            <th>Name</th><th>Type</th><th>Tag</th>
            <th>Condition</th><th>Assigned To</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            ${rows.map(a => `
              <tr>
                <td><strong>${Utils.escapeHtml(a.name)}</strong></td>
                <td><span style="display:inline-flex;align-items:center;gap:6px;">${_typeIcon(a.type, 14)}<span class="text-muted">${Utils.escapeHtml(a.type || '—')}</span></span></td>
                <td class="text-sm text-muted">${Utils.escapeHtml(a.asset_tag || a.serial_number || '—')}</td>
                <td>${_conditionBadge(a.condition)}</td>
                <td>${a.employees ? Utils.escapeHtml(a.employees.name) : '<span class="text-muted">—</span>'}</td>
                <td>${_statusBadge(a.status)}</td>
                <td style="white-space:nowrap;text-align:right;">
                  <button class="btn btn--xs btn--ghost ast-view" data-id="${a.id}">View</button>
                  ${_p.can_manage && a.status === 'available'
                    ? `<button class="btn btn--xs btn--secondary ast-assign" data-id="${a.id}">Assign</button>`
                    : ''}
                  ${_p.can_manage && a.status !== 'retired'
                    ? `<button class="btn btn--xs btn--ghost ast-status" data-id="${a.id}" title="Update status">Status</button>`
                    : ''}
                  ${_p.can_retire_delete && a.status !== 'retired'
                    ? `<button class="btn btn--xs btn--ghost ast-retire" data-id="${a.id}" style="color:var(--warning);">Retire</button>`
                    : ''}
                  ${_p.can_retire_delete
                    ? `<button class="btn btn--xs btn--ghost ast-delete" data-id="${a.id}" style="color:var(--danger);">Delete</button>`
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
    document.querySelectorAll('.ast-status').forEach(btn =>
      btn.addEventListener('click', () => {
        const a = _assets.find(x => x.id === btn.dataset.id)
        if (a) _openStatusModal(a)
      })
    )
    document.querySelectorAll('.ast-retire').forEach(btn =>
      btn.addEventListener('click', () => {
        const a = _assets.find(x => x.id === btn.dataset.id)
        if (a) _openRetireModal(a)
      })
    )
    document.querySelectorAll('.ast-delete').forEach(btn =>
      btn.addEventListener('click', () => {
        const a = _assets.find(x => x.id === btn.dataset.id)
        if (a) _confirmDeleteAsset(a)
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
            <div style="display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--text-muted);margin-top:4px;">${_typeIcon(a.type, 13)}${Utils.escapeHtml(a.type || '')}</div>
          </div>
          ${_statusBadge(a.status)}
        </div>
        <div class="ast-card-meta">
          <div><span class="text-muted">Condition</span><br>${a.condition || '—'}</div>
          <div><span class="text-muted">Assigned Since</span><br>${a.assigned_date ? Utils.formatDate(a.assigned_date) : '—'}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
          <button class="btn btn--xs btn--ghost ast-view" data-id="${a.id}">View Details</button>
          <button class="btn btn--xs btn--danger ast-report" data-id="${a.id}">Report Issue</button>
          ${a.status === 'in_use'
            ? `<button class="btn btn--xs btn--ghost ast-return-mine" data-id="${a.id}" style="color:var(--text-muted);">Return Asset</button>`
            : ''}
          ${a.status === 'pending_return'
            ? `<span style="font-size:12px;color:var(--warning);padding:3px 8px;border:1px solid var(--warning);border-radius:var(--radius);display:inline-flex;align-items:center;gap:4px;">⏳ Return Pending HR</span>`
            : ''}
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
    content.querySelectorAll('.ast-return-mine').forEach(btn =>
      btn.addEventListener('click', () => {
        const a = _assets.find(x => x.id === btn.dataset.id)
        if (a) _openReturnModal(a)
      })
    )
  }

  /* ══════════════════════════════════════════════════════════
     REQUESTS TAB
  ══════════════════════════════════════════════════════════ */

  const REQ_STATUS = {
    pending_hr:  { label: 'Awaiting HR',  cls: 'badge--warning' },
    approved:    { label: 'Approved',     cls: 'badge--success' },
    rejected:    { label: 'Rejected',     cls: 'badge--danger'  },
  }

  const RETURN_STATUS = {
    pending:  { label: 'Pending HR',  cls: 'badge--warning' },
    approved: { label: 'Approved',    cls: 'badge--success' },
    rejected: { label: 'Rejected',    cls: 'badge--danger'  },
  }

  function _renderRequestsTab() {
    const content = document.getElementById('ast-content')
    if (!content) return

    const pendingHR      = _p.can_manage ? _requests.filter(r => r.status === 'pending_hr') : []
    const pendingReturns = _p.can_manage ? _returnRequests.filter(r => r.status === 'pending') : []
    const myRequests     = _requests.filter(r => r.requested_by === _user.id)
    const myReturns      = _returnRequests.filter(r => r.returned_by === _user.id)
    const allLog         = _p.can_manage ? _requests : []
    const allReturns     = _p.can_manage ? _returnRequests : []

    // ── Asset acquisition request row ───────────────────────────
    function _reqRow(r, showActions) {
      const asset     = r.asset || {}
      const reqBy     = r.requester?.name || '—'
      const statusCfg = REQ_STATUS[r.status] || { label: r.status, cls: 'badge--muted' }
      return `
        <tr>
          <td>
            <strong>${Utils.escapeHtml(asset.name || '—')}</strong>
            <br><span class="text-muted" style="font-size:11px;">${Utils.escapeHtml(asset.type || '')}</span>
          </td>
          <td>${Utils.escapeHtml(reqBy)}</td>
          <td style="max-width:200px;font-size:12px;">${Utils.escapeHtml(r.reason || '—')}</td>
          <td><span class="badge ${statusCfg.cls}">${statusCfg.label}</span></td>
          <td class="text-sm text-muted">${Utils.formatDate(r.created_at)}</td>
          <td style="white-space:nowrap;">
            ${showActions && r.status === 'pending_hr' && _p.can_manage ? `
              <button class="btn btn--xs btn--primary ast-req-approve" data-id="${r.id}">Approve & Assign</button>
              <button class="btn btn--xs btn--ghost ast-req-reject" data-id="${r.id}" style="color:var(--danger);">Reject</button>
            ` : ''}
          </td>
        </tr>`
    }

    function _reqTable(rows, showActions = false) {
      if (!rows.length) return '<p class="empty-state-text" style="padding:16px;">No requests.</p>'
      return `<div style="overflow-x:auto;"><table class="data-table">
        <thead><tr><th>Asset</th><th>Requested By</th><th>Reason</th><th>Status</th><th>Date</th><th></th></tr></thead>
        <tbody>${rows.map(r => _reqRow(r, showActions)).join('')}</tbody>
      </table></div>`
    }

    // ── Return request row ──────────────────────────────────────
    function _returnRow(r, showActions) {
      const asset     = _assets.find(a => a.id === r.asset_id) || r.asset || {}
      const rrStatus  = RETURN_STATUS[r.status] || { label: r.status, cls: 'badge--muted' }
      return `
        <tr>
          <td>
            <strong>${Utils.escapeHtml(asset.name || '—')}</strong>
            <br><span class="text-muted" style="font-size:11px;">${Utils.escapeHtml(asset.type || '')}</span>
          </td>
          <td>${Utils.escapeHtml(r.returned_by_emp?.name || '—')}</td>
          <td class="text-sm">${Utils.escapeHtml(r.condition_on_return || '—')}</td>
          <td style="max-width:180px;font-size:12px;">${Utils.escapeHtml(r.notes || '—')}</td>
          <td><span class="badge ${rrStatus.cls}">${rrStatus.label}</span></td>
          <td class="text-sm text-muted">${Utils.formatDate(r.created_at)}</td>
          <td class="text-sm text-muted">${r.hr_actor?.name || '—'}</td>
          <td style="white-space:nowrap;">
            ${showActions && r.status === 'pending' && _p.can_manage ? `
              <button class="btn btn--xs btn--primary ast-ret-approve" data-id="${r.id}">Approve</button>
              <button class="btn btn--xs btn--ghost ast-ret-reject" data-id="${r.id}" style="color:var(--danger);">Reject</button>
            ` : ''}
            ${r.status === 'rejected' && r.hr_notes
              ? `<span class="text-sm text-muted" title="${Utils.escapeHtml(r.hr_notes)}" style="cursor:help;">📝 Note</span>`
              : ''}
          </td>
        </tr>`
    }

    function _returnTable(rows, showActions = false) {
      if (!rows.length) return '<p class="empty-state-text" style="padding:16px;">No return requests.</p>'
      return `<div style="overflow-x:auto;"><table class="data-table">
        <thead><tr>
          <th>Asset</th><th>Returned By</th><th>Condition</th><th>Notes</th>
          <th>Status</th><th>Return Date</th><th>Approved By</th><th></th>
        </tr></thead>
        <tbody>${rows.map(r => _returnRow(r, showActions)).join('')}</tbody>
      </table></div>`
    }

    const sections = []

    // Pending asset acquisition requests (HR)
    if (pendingHR.length) {
      sections.push(`
        <div class="section-card" style="border-left:3px solid var(--warning);">
          <div class="section-card-header"><h3>Pending Asset Requests <span class="badge badge--warning" style="margin-left:8px;">${pendingHR.length}</span></h3></div>
          <div class="section-card-body" style="padding:0;">${_reqTable(pendingHR, true)}</div>
        </div>`)
    }

    // Pending return approvals (HR)
    if (pendingReturns.length) {
      sections.push(`
        <div class="section-card" style="border-left:3px solid var(--primary);">
          <div class="section-card-header"><h3>Pending Return Approvals <span class="badge badge--primary" style="margin-left:8px;">${pendingReturns.length}</span></h3></div>
          <div class="section-card-body" style="padding:0;">${_returnTable(pendingReturns, true)}</div>
        </div>`)
    }

    if (_p.can_manage) {
      sections.push(`
        <div class="section-card">
          <div class="section-card-header"><h3>All Asset Requests</h3></div>
          <div class="section-card-body" style="padding:0;">${_reqTable(allLog, true)}</div>
        </div>`)
      sections.push(`
        <div class="section-card">
          <div class="section-card-header"><h3>Return History</h3></div>
          <div class="section-card-body" style="padding:0;">${_returnTable(allReturns)}</div>
        </div>`)
    } else {
      if (myRequests.length || _p.can_request) {
        sections.push(`
          <div class="section-card">
            <div class="section-card-header"><h3>My Asset Requests</h3></div>
            <div class="section-card-body" style="padding:0;">${_reqTable(myRequests)}</div>
          </div>`)
      }
      if (myReturns.length) {
        sections.push(`
          <div class="section-card">
            <div class="section-card-header"><h3>My Return Requests</h3></div>
            <div class="section-card-body" style="padding:0;">${_returnTable(myReturns)}</div>
          </div>`)
      }
    }

    content.innerHTML = sections.length
      ? `<div style="display:flex;flex-direction:column;gap:16px;">${sections.join('')}</div>`
      : '<p class="empty-state-text">No asset requests to show.</p>'

    content.querySelectorAll('.ast-req-approve').forEach(btn =>
      btn.addEventListener('click', () => _approveRequest(btn.dataset.id))
    )
    content.querySelectorAll('.ast-req-reject').forEach(btn =>
      btn.addEventListener('click', () => _openRejectRequestModal(btn.dataset.id))
    )
    content.querySelectorAll('.ast-ret-approve').forEach(btn =>
      btn.addEventListener('click', () => _approveReturnRequest(btn.dataset.id))
    )
    content.querySelectorAll('.ast-ret-reject').forEach(btn =>
      btn.addEventListener('click', () => _openRejectReturnModal(btn.dataset.id))
    )
  }

  async function _approveRequest(reqId) {
    const req = _requests.find(r => r.id === reqId)
    if (!req) return

    const assetName = req.asset?.name || 'the asset'
    const reqByName = req.requester?.name || 'the employee'

    if (!confirm(`Approve and assign "${assetName}" to ${reqByName}?`)) return

    try {
      const now     = new Date().toISOString()
      const today   = now.split('T')[0]

      // 1. Mark request approved
      const { error: reqErr } = await API.updateAssetRequest(reqId, {
        status:      'approved',
        hr_status:   'approved',
        hr_acted_by: _user.id,
        hr_acted_at: now,
      })
      if (reqErr) throw reqErr

      // 2. Auto-assign the asset
      const { error: assetErr } = await API.updateAsset(req.asset_id, {
        assigned_to:   req.requested_by,
        assigned_date: today,
        status:        'in_use',
        updated_at:    now,
      })
      if (assetErr) throw assetErr

      // 3. History record
      await API.addAssetHistory({
        asset_id:       req.asset_id,
        action:         'assigned',
        to_employee_id: req.requested_by,
        notes:          `Auto-assigned via approved request (approved by ${_user.name})`,
        performed_by:   _user.id,
      })

      // 4. Notify the employee
      await Config.supabase.from('notifications').insert({
        recipient_employee_id: req.requested_by,
        type:      'success',
        message:   `Your request for "${assetName}" has been approved and assigned to you!`,
        module:    'assets',
        record_id: req.asset_id,
      })

      await _refreshAll()
      Utils.showToast('Request approved — asset assigned.', 'success')
      _renderRequestsTab()

    } catch (err) {
      Utils.showToast(err.message || 'Failed to approve request.', 'error')
    }
  }

  function _openRejectRequestModal(reqId) {
    const req = _requests.find(r => r.id === reqId)
    if (!req) return
    const assetName = req.asset?.name || 'this asset'

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Reject Request</h3>${_modalCloseBtn()}
      </div>
      <div class="modal-body">
        <p style="font-size:14px;margin:0 0 16px;">Reject <strong>${Utils.escapeHtml(req.requester?.name || '—')}</strong>'s request for <strong>${Utils.escapeHtml(assetName)}</strong>?</p>
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">Reason <span style="color:var(--text-muted);font-weight:400;">(optional)</span></label>
          <textarea class="form-input" id="ast-reject-note" rows="2" style="resize:vertical;" placeholder="Reason for rejection…"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--danger" id="ast-reject-confirm">Reject</button>
      </div>
    `)

    document.getElementById('ast-reject-confirm').addEventListener('click', async () => {
      const btn  = document.getElementById('ast-reject-confirm')
      const note = document.getElementById('ast-reject-note').value.trim() || null
      btn.disabled = true; btn.textContent = 'Rejecting…'

      const now = new Date().toISOString()
      const { error } = await API.updateAssetRequest(reqId, {
        status:      'rejected',
        hr_status:   'rejected',
        hr_note:     note,
        hr_acted_by: _user.id,
        hr_acted_at: now,
      })

      if (error) { Utils.showToast(error.message, 'error'); btn.disabled = false; btn.textContent = 'Reject'; return }

      await Config.supabase.from('notifications').insert({
        recipient_employee_id: req.requested_by,
        type:      'warning',
        message:   `Your request for "${assetName}" was not approved.${note ? ' Note: ' + note : ''}`,
        module:    'assets',
        record_id: reqId,
      })

      await _refreshAll()
      Utils.closeModal()
      Utils.showToast('Request rejected.', 'success')
      _renderRequestsTab()
    })
  }

  /* ══════════════════════════════════════════════════════════
     RETURN REQUEST — APPROVE / REJECT (HR only)
  ══════════════════════════════════════════════════════════ */

  async function _approveReturnRequest(returnReqId) {
    const rr    = _returnRequests.find(r => r.id === returnReqId)
    if (!rr) return
    const asset     = _assets.find(a => a.id === rr.asset_id)
    const assetName = asset?.name || rr.asset?.name || 'the asset'
    const empName   = rr.returned_by_emp?.name || 'the employee'

    if (!confirm(`Approve return of "${assetName}" from ${empName}?`)) return

    try {
      const now = new Date().toISOString()

      // 1. Approve the return request
      const { error: rrErr } = await API.updateAssetReturnRequest(returnReqId, {
        status:      'approved',
        hr_acted_by: _user.id,
        hr_acted_at: now,
      })
      if (rrErr) throw rrErr

      // 2. Mark asset as available and unassign
      const { error: assetErr } = await API.updateAsset(rr.asset_id, {
        status:        'available',
        assigned_to:   null,
        assigned_date: null,
        condition:     rr.condition_on_return || asset?.condition,
        updated_at:    now,
      })
      if (assetErr) throw assetErr

      // 3. Asset history
      await API.addAssetHistory({
        asset_id:         rr.asset_id,
        action:           'returned',
        from_employee_id: rr.returned_by,
        condition_before: asset?.condition,
        condition_after:  rr.condition_on_return,
        notes:            `Return approved by ${_user.name}.${rr.notes ? ' Employee note: ' + rr.notes : ''}`,
        performed_by:     _user.id,
      })

      // 4. Notify employee
      await Config.supabase.from('notifications').insert({
        recipient_employee_id: rr.returned_by,
        type:    'success',
        message: `Your return request for "${assetName}" has been approved. The asset has been successfully returned.`,
        module:  'assets',
      })

      await _refreshAll()
      Utils.showToast('Return approved — asset is now available.', 'success')
      _renderRequestsTab()

    } catch (err) {
      Utils.showToast(err.message || 'Failed to approve return.', 'error')
    }
  }

  function _openRejectReturnModal(returnReqId) {
    const rr    = _returnRequests.find(r => r.id === returnReqId)
    if (!rr) return
    const asset     = _assets.find(a => a.id === rr.asset_id)
    const assetName = asset?.name || rr.asset?.name || 'the asset'

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Reject Return Request</h3>${_modalCloseBtn()}
      </div>
      <div class="modal-body">
        <p style="font-size:14px;margin:0 0 16px;">
          Reject return of <strong>${Utils.escapeHtml(assetName)}</strong> from
          <strong>${Utils.escapeHtml(rr.returned_by_emp?.name || '—')}</strong>?
          The asset will remain assigned to them.
        </p>
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">Comments for Employee <span style="color:var(--text-muted);font-weight:400;">(optional)</span></label>
          <textarea class="form-input" id="ast-ret-reject-note" rows="2" style="resize:vertical;"
            placeholder="Reason for rejection or next steps…"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--danger" id="ast-ret-reject-confirm">Reject Return</button>
      </div>
    `)

    document.getElementById('ast-ret-reject-confirm').addEventListener('click', async () => {
      const btn  = document.getElementById('ast-ret-reject-confirm')
      const note = document.getElementById('ast-ret-reject-note').value.trim() || null
      btn.disabled = true; btn.textContent = 'Rejecting…'

      const now = new Date().toISOString()
      const { error } = await API.updateAssetReturnRequest(returnReqId, {
        status:      'rejected',
        hr_acted_by: _user.id,
        hr_acted_at: now,
        hr_notes:    note,
      })

      if (!error) {
        // Revert asset back to in_use
        await API.updateAsset(rr.asset_id, { status: 'in_use', updated_at: now })

        // Notify employee with HR comments
        await Config.supabase.from('notifications').insert({
          recipient_employee_id: rr.returned_by,
          type:    'warning',
          message: `Your return request for "${assetName}" was not approved.${note ? ' HR note: ' + note : ''}`,
          module:  'assets',
        })
      }

      btn.disabled = false; btn.textContent = 'Reject Return'
      if (error) { Utils.showToast(error.message, 'error'); return }

      await _refreshAll()
      Utils.closeModal()
      Utils.showToast('Return request rejected — asset remains assigned.', 'success')
      _renderRequestsTab()
    })
  }

  /* ══════════════════════════════════════════════════════════
     REPAIRS & ISSUES TAB
  ══════════════════════════════════════════════════════════ */

  function _renderRepairsTab() {
    const content = document.getElementById('ast-content')
    if (!content) return

    // HR sees all; everyone else sees only their own reports
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
                  <th>Reported By</th><th>Status</th>
                  ${_p.can_manage ? '<th>HR Notes</th>' : '<th>Update</th>'}
                  <th>Date</th><th></th>
                </tr></thead>
                <tbody>
                  ${repairs.map(r => {
                    const asset = _assets.find(a => a.id === r.asset_id)
                    return `<tr>
                      <td><strong>${Utils.escapeHtml(asset?.name || '—')}</strong></td>
                      <td><span class="badge badge--muted">${r.type === 'repair' ? 'Repair' : 'Issue'}</span></td>
                      <td class="text-sm">${Utils.escapeHtml(Utils.truncate(r.description, 55))}</td>
                      <td class="text-sm text-muted">${Utils.escapeHtml(r.reported_by_emp?.name || '—')}</td>
                      <td>${_repairBadge(r.status)}</td>
                      <td class="text-sm text-muted" style="max-width:160px;">
                        ${Utils.escapeHtml(Utils.truncate(r.resolution_notes || '—', 50))}
                      </td>
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
     INVENTORIES TAB
  ══════════════════════════════════════════════════════════ */

  function _renderInventoriesTab() {
    const content = document.getElementById('ast-content')
    if (!content) return

    // Aggregate repair costs + last repair date per asset from _repairs
    const repairCostMap = {}
    const lastRepairMap = {}
    _repairs.forEach(r => {
      if (r.cost) repairCostMap[r.asset_id] = (repairCostMap[r.asset_id] || 0) + Number(r.cost)
      const date = r.resolved_at || r.updated_at || r.created_at
      if (!lastRepairMap[r.asset_id] || date > lastRepairMap[r.asset_id]) lastRepairMap[r.asset_id] = date
    })

    const rows = _assets.map(a => ({
      ...a,
      totalRepairCost: repairCostMap[a.id] || 0,
      lastRepairDate:  lastRepairMap[a.id]  || null,
    }))

    content.innerHTML = `
      <div class="section-card">
        <div class="section-card-header">
          <h3>Inventories <span class="text-muted" style="font-weight:400;font-size:13px;">(${rows.length} assets)</span></h3>
        </div>
        <div style="overflow-x:auto;">
          <table class="data-table">
            <thead><tr>
              <th>Item Name</th>
              <th>Type</th>
              <th>Purchase Date</th>
              <th>Purchase Price</th>
              <th>Vendor</th>
              <th>Total Repair Cost</th>
              <th>Last Repair</th>
              <th></th>
            </tr></thead>
            <tbody>
              ${rows.map(a => `
                <tr>
                  <td>
                    <strong>${Utils.escapeHtml(a.name)}</strong>
                    <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${Utils.escapeHtml(a.asset_tag || a.serial_number || '')}</div>
                  </td>
                  <td>${Utils.escapeHtml(a.type || '—')}</td>
                  <td class="text-sm text-muted">${a.purchase_date ? Utils.formatDate(a.purchase_date) : '—'}</td>
                  <td class="text-sm">${a.purchase_price ? '₹' + Number(a.purchase_price).toLocaleString('en-IN') : '—'}</td>
                  <td class="text-sm text-muted">${Utils.escapeHtml(a.vendor || '—')}</td>
                  <td class="text-sm" style="${a.totalRepairCost > 0 ? 'color:var(--danger);font-weight:600;' : 'color:var(--text-muted);'}">
                    ${a.totalRepairCost > 0 ? '₹' + a.totalRepairCost.toLocaleString('en-IN') : '—'}
                  </td>
                  <td class="text-sm text-muted">${a.lastRepairDate ? Utils.formatDate(a.lastRepairDate) : '—'}</td>
                  <td>
                    <button class="btn btn--xs btn--ghost ast-inv-view" data-id="${a.id}">History</button>
                    <button class="btn btn--xs btn--ghost ast-inv-edit" data-id="${a.id}">Edit</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`

    content.querySelectorAll('.ast-inv-view').forEach(btn =>
      btn.addEventListener('click', () => _openRepairHistoryModal(btn.dataset.id))
    )
    content.querySelectorAll('.ast-inv-edit').forEach(btn =>
      btn.addEventListener('click', () => {
        const a = _assets.find(x => x.id === btn.dataset.id)
        if (a) _openInventoryEditModal(a)
      })
    )
  }

  async function _openRepairHistoryModal(assetId) {
    const asset = _assets.find(a => a.id === assetId)
    if (!asset) return

    const { data: repairs } = await API.getAssetRepairsForAsset(assetId)
    const reps = repairs || []

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Repair History — ${Utils.escapeHtml(asset.name)}</h3>
        ${_modalCloseBtn()}
      </div>
      <div class="modal-body" style="max-height:60vh;overflow-y:auto;">
        ${!reps.length
          ? '<p class="empty-state-text">No repairs logged for this asset.</p>'
          : reps.map(r => `
              <div style="padding:12px 0;border-bottom:1px solid var(--border);">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                  ${_repairBadge(r.status)}
                  <span class="badge badge--muted">${r.type === 'repair' ? 'Repair' : 'Issue'}</span>
                  <span class="text-muted text-sm">${Utils.formatDate(r.created_at)}</span>
                </div>
                <div style="font-size:13px;margin-bottom:4px;">${Utils.escapeHtml(r.description)}</div>
                ${r.resolution_notes ? `<div style="font-size:12px;color:var(--text-muted);">Notes: ${Utils.escapeHtml(r.resolution_notes)}</div>` : ''}
                <div style="display:flex;gap:16px;margin-top:6px;font-size:12px;color:var(--text-muted);">
                  ${r.cost ? `<span>Cost: <strong style="color:var(--danger);">₹${Number(r.cost).toLocaleString('en-IN')}</strong></span>` : ''}
                  ${r.vendor ? `<span>Vendor: ${Utils.escapeHtml(r.vendor)}</span>` : ''}
                  ${r.resolved_at ? `<span>Resolved: ${Utils.formatDate(r.resolved_at)}</span>` : ''}
                </div>
              </div>`).join('')}
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Close</button>
      </div>
    `)
  }

  function _openInventoryEditModal(asset) {
    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Edit Financial Details — ${Utils.escapeHtml(asset.name)}</h3>
        ${_modalCloseBtn()}
      </div>
      <div class="modal-body">
        <div id="ast-inv-err" class="alert alert--danger" style="display:none;"></div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Purchase Date</label>
            <input class="form-input" type="date" id="ast-inv-date" value="${asset.purchase_date || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">Purchase Price (₹)</label>
            <input class="form-input" type="number" id="ast-inv-price" value="${asset.purchase_price || ''}" placeholder="0">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Vendor</label>
          <input class="form-input" id="ast-inv-vendor" value="${Utils.escapeHtml(asset.vendor || '')}" placeholder="Supplier name">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="ast-inv-save">Save</button>
      </div>
    `)

    document.getElementById('ast-inv-save').addEventListener('click', async () => {
      const btn = document.getElementById('ast-inv-save')
      btn.disabled = true; btn.textContent = 'Saving…'

      const { error } = await API.updateAsset(asset.id, {
        purchase_date:  document.getElementById('ast-inv-date').value  || null,
        purchase_price: document.getElementById('ast-inv-price').value ? Number(document.getElementById('ast-inv-price').value) : null,
        vendor:         document.getElementById('ast-inv-vendor').value.trim() || null,
        updated_at:     new Date().toISOString(),
      })

      btn.disabled = false; btn.textContent = 'Save'
      if (error) { document.getElementById('ast-inv-err').textContent = error.message; document.getElementById('ast-inv-err').style.display = 'block'; return }

      Utils.closeModal()
      Utils.showToast('Financial details updated.', 'success')
      const { data } = await API.getAssets(); _assets = data || []
      _renderInventoriesTab()
    })
  }

  /* ══════════════════════════════════════════════════════════
     SETTINGS TAB (asset types only — locations removed)
  ══════════════════════════════════════════════════════════ */

  function _renderSettingsTab() {
    const content = document.getElementById('ast-content')
    if (!content) return

    const typeCount = {}
    _assets.forEach(a => { if (a.type) typeCount[a.type] = (typeCount[a.type] || 0) + 1 })

    function _managedList(items, countMap) {
      if (!items.length) return '<p class="empty-state-text" style="padding:12px 0;">None added yet.</p>'
      return items.map(item => `
        <div class="ast-setting-row" data-row-id="${item.id}">
          <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
            ${_typeIcon(item.name, 15)}
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

    const totalAssets    = _assets.length
    const activeAssigned = _assets.filter(a => a.status === 'in_use').length
    const available      = _assets.filter(a => a.status === 'available').length
    const underRepair    = _assets.filter(a => a.status === 'under_repair').length

    content.innerHTML = `
      <div class="ast-settings-wrap">
        <div class="ast-settings-summary">
          <div class="ast-settings-stat"><div class="ast-settings-stat-val">${totalAssets}</div><div class="ast-settings-stat-lbl">Total Assets</div></div>
          <div class="ast-settings-stat"><div class="ast-settings-stat-val" style="color:var(--primary)">${activeAssigned}</div><div class="ast-settings-stat-lbl">Assigned</div></div>
          <div class="ast-settings-stat"><div class="ast-settings-stat-val" style="color:var(--success)">${available}</div><div class="ast-settings-stat-lbl">Available</div></div>
          <div class="ast-settings-stat"><div class="ast-settings-stat-val" style="color:var(--warning)">${underRepair}</div><div class="ast-settings-stat-lbl">Under Repair</div></div>
          <div class="ast-settings-stat"><div class="ast-settings-stat-val">${_types.length}</div><div class="ast-settings-stat-lbl">Asset Types</div></div>
        </div>

        <div class="section-card" style="max-width:520px;">
          <div class="section-card-header">
            <h3>Asset Types</h3>
            <span class="text-muted" style="font-size:12px;">${_types.length} types</span>
          </div>
          <div class="section-card-body">
            <div style="display:flex;gap:8px;margin-bottom:14px;">
              <input class="form-input" id="ast-type-input" placeholder="New type name…" style="flex:1;">
              <button class="btn btn--primary btn--sm" id="ast-type-add">Add</button>
            </div>
            <div id="ast-type-list">${_managedList(_types, typeCount)}</div>
          </div>
        </div>
      </div>`

    _bindSettingsEvents(content)
  }

  function _bindSettingsEvents(content) {
    content.querySelector('#ast-type-add')?.addEventListener('click', async () => {
      const input = content.querySelector('#ast-type-input')
      const name  = input.value.trim(); if (!name) return
      const { error } = await API.createAssetType(name)
      if (error) { Utils.showToast(error.message, 'error'); return }
      input.value = ''
      const { data } = await API.getAssetTypes(); _types = data || []
      _renderSettingsTab(); Utils.showToast('Type added.', 'success')
    })

    content.querySelectorAll('.ast-setting-edit').forEach(btn => {
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
          const id = btn.dataset.id
          const { data: updated, error } = await API.updateAssetType(id, newName)
          if (error) { Utils.showToast(error.message, 'error'); return }
          // Mutate local state directly — avoids a stale re-fetch race
          const t = _types.find(t => t.id === id)
          if (t) t.name = updated?.name ?? newName
          _renderSettingsTab()
          Utils.showToast('Renamed.', 'success')
        })
      })
    })

    content.querySelectorAll('.ast-setting-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Remove "${btn.dataset.name}"?`)) return
        const { error } = await API.deleteAssetType(btn.dataset.id)
        if (error) { Utils.showToast(error.message, 'error'); return }
        const { data } = await API.getAssetTypes(); _types = data || []
        _renderSettingsTab(); Utils.showToast('Removed.', 'success')
      })
    })
  }

  /* ══════════════════════════════════════════════════════════
     ASSET DETAIL MODAL — actionable redesign
  ══════════════════════════════════════════════════════════ */

  async function _openDetailModal(assetId) {
    const asset = _assets.find(a => a.id === assetId)
    if (!asset) return

    const [{ data: history }, { data: repairs }] = await Promise.all([
      API.getAssetHistory(assetId),
      API.getAssetRepairsForAsset(assetId),
    ])

    const canManage      = _p.can_manage
    const isAssignedToMe = asset.assigned_to === _user.id
    const isSuperAdmin   = _user.role === 'super_admin'
    const openRepairs    = (repairs || []).filter(r => r.status !== 'resolved').length
    const latestPhoto    = (history || []).find(h => h.photo_url)

    // Determine available actions for this user
    const canReturn  = (isAssignedToMe || isSuperAdmin) && asset.status === 'in_use'
    const canReport  = isAssignedToMe && asset.status !== 'pending_return'
    const canAssign  = canManage && asset.status === 'available'
    const canEdit    = canManage
    const canRetire  = _p.can_retire_delete && asset.status !== 'retired'
    const canDelete  = _p.can_retire_delete

    Utils.openModal(`
      <div class="modal-header">
        <div>
          <h3 class="modal-title">${Utils.escapeHtml(asset.name)}</h3>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">
            ${Utils.escapeHtml(asset.type || '')}
            ${asset.asset_tag ? ' · ' + Utils.escapeHtml(asset.asset_tag) : ''}
            ${asset.serial_number ? ' · S/N: ' + Utils.escapeHtml(asset.serial_number) : ''}
          </div>
        </div>
        ${_modalCloseBtn()}
      </div>
      <div class="modal-body" style="max-height:65vh;overflow-y:auto;">

        <!-- Status + condition badges -->
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:16px;">
          ${_statusBadge(asset.status)}
          ${_conditionBadge(asset.condition)}
          ${openRepairs ? `<span class="badge badge--danger">${openRepairs} open issue${openRepairs > 1 ? 's' : ''}</span>` : ''}
          ${latestPhoto ? `<a href="${Utils.escapeHtml(latestPhoto.photo_url)}" target="_blank" rel="noopener" class="btn btn--xs btn--ghost">📷 Latest Photo</a>` : ''}
        </div>

        <!-- Action strip -->
        ${canReturn || canReport || canAssign || canEdit || canRetire || canDelete ? `
        <div style="display:flex;gap:8px;flex-wrap:wrap;padding:12px;background:var(--surface);border-radius:var(--radius);margin-bottom:20px;">
          ${canReport  ? `<button class="btn btn--sm btn--primary" id="ast-detail-report">🔧 Report Issue</button>` : ''}
          ${canReturn  ? `<button class="btn btn--sm btn--ghost" id="ast-detail-return" style="color:var(--text-muted);">↩ Return Asset</button>` : ''}
          ${canAssign  ? `<button class="btn btn--sm btn--secondary" id="ast-detail-assign">Assign</button>` : ''}
          ${canEdit    ? `<button class="btn btn--sm btn--ghost" id="ast-detail-edit">Edit</button>` : ''}
          ${canManage  ? `<button class="btn btn--sm btn--ghost" id="ast-detail-status">Status</button>` : ''}
          ${canRetire  ? `<button class="btn btn--sm btn--ghost" id="ast-detail-retire" style="color:var(--warning);">Retire</button>` : ''}
          ${canDelete  ? `<button class="btn btn--sm btn--ghost" id="ast-detail-delete" style="color:var(--danger);">Delete</button>` : ''}
        </div>` : ''}

        <!-- Details -->
        <div class="ast-detail-grid" style="margin-bottom:20px;">
          <div>
            <div class="ast-detail-label">Assigned To</div>
            ${asset.employees ? Utils.escapeHtml(asset.employees.name) : '<span class="text-muted">Unassigned</span>'}
          </div>
          <div>
            <div class="ast-detail-label">Assigned Since</div>
            ${asset.assigned_date ? Utils.formatDate(asset.assigned_date) : '—'}
          </div>
          <div><div class="ast-detail-label">Condition</div>${asset.condition || '—'}</div>
          ${canManage ? `
          <div><div class="ast-detail-label">Vendor</div>${Utils.escapeHtml(asset.vendor || '—')}</div>
          <div><div class="ast-detail-label">Purchase Price</div>${asset.purchase_price ? '₹' + Number(asset.purchase_price).toLocaleString('en-IN') : '—'}</div>
          ` : ''}
        </div>

        ${asset.notes ? `
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:13px;margin-bottom:20px;">
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Notes</div>
            ${Utils.escapeHtml(asset.notes)}
          </div>` : ''}

        <!-- Repair summary (open issues) -->
        ${openRepairs > 0 ? `
          <div style="margin-bottom:20px;">
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;font-weight:600;">Open Issues</div>
            ${(repairs || []).filter(r => r.status !== 'resolved').map(r => `
              <div style="display:flex;gap:10px;padding:8px 12px;background:var(--surface);border-radius:6px;margin-bottom:6px;">
                <div style="flex:1;">
                  <div style="font-size:13px;font-weight:500;">${Utils.escapeHtml(Utils.truncate(r.description, 80))}</div>
                  ${r.resolution_notes ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px;">Update: ${Utils.escapeHtml(r.resolution_notes)}</div>` : ''}
                </div>
                ${_repairBadge(r.status)}
              </div>`).join('')}
          </div>` : ''}

        <!-- History timeline -->
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

      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Close</button>
      </div>
    `)

    document.getElementById('ast-detail-report')?.addEventListener('click', () => { Utils.closeModal(); _openReportModal(asset) })
    document.getElementById('ast-detail-return')?.addEventListener('click', () => { Utils.closeModal(); _openReturnModal(asset) })
    document.getElementById('ast-detail-assign')?.addEventListener('click', () => { Utils.closeModal(); _openAssignModal(asset) })
    document.getElementById('ast-detail-edit')?.addEventListener('click',   () => { Utils.closeModal(); _openEditModal(asset) })
    document.getElementById('ast-detail-status')?.addEventListener('click', () => { Utils.closeModal(); _openStatusModal(asset) })
    document.getElementById('ast-detail-retire')?.addEventListener('click', () => { Utils.closeModal(); _openRetireModal(asset) })
    document.getElementById('ast-detail-delete')?.addEventListener('click', () => { Utils.closeModal(); _confirmDeleteAsset(asset) })
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
            <div class="custom-select-wrap" id="ast-name-wrap" style="min-width:0;">
              <input class="form-input" id="ast-f-name"
                value="${Utils.escapeHtml(asset?.name || '')}"
                placeholder="e.g. MacBook Pro 14"
                autocomplete="off" />
              <div class="custom-select-dropdown" id="ast-name-dropdown"
                   style="display:none;position:absolute;width:100%;left:0;z-index:200;">
                <div class="custom-select-list" id="ast-name-list"></div>
              </div>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Type <span class="required">*</span></label>
            <select class="form-select" id="ast-f-type">
              <option value="">— Select type —</option>
              ${typeOptions}
            </select>
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

    // Asset name typeahead from existing names
    const _existingNames = [...new Set(_assets.map(a => a.name).filter(Boolean))].sort()
    const _nameInput     = document.getElementById('ast-f-name')
    const _nameDropdown  = document.getElementById('ast-name-dropdown')
    const _nameList      = document.getElementById('ast-name-list')

    function _renderNameSuggestions(q) {
      const matches = q ? _existingNames.filter(n => n.toLowerCase().includes(q.toLowerCase())) : []
      if (!matches.length) { _nameDropdown.style.display = 'none'; return }
      _nameList.innerHTML = matches.map(n =>
        `<div class="custom-select-item" data-name="${Utils.escapeHtml(n)}">${Utils.escapeHtml(n)}</div>`
      ).join('')
      _nameList.querySelectorAll('.custom-select-item').forEach(el => {
        el.addEventListener('mousedown', ev => { ev.preventDefault(); _nameInput.value = el.dataset.name; _nameDropdown.style.display = 'none' })
      })
      _nameDropdown.style.display = 'block'
    }

    _nameInput?.addEventListener('input', () => _renderNameSuggestions(_nameInput.value.trim()))
    _nameInput?.addEventListener('blur',  () => setTimeout(() => { _nameDropdown.style.display = 'none' }, 150))

    document.getElementById('ast-form-save').addEventListener('click', async () => {
      const errEl = document.getElementById('ast-form-err')
      const btn   = document.getElementById('ast-form-save')
      const name  = _nameInput.value.trim()

      errEl.style.display = 'none'
      if (!name) { errEl.textContent = 'Asset name is required.'; errEl.style.display = 'block'; return }

      btn.disabled = true; btn.textContent = 'Saving…'

      const payload = {
        name,
        type:           document.getElementById('ast-f-type').value          || null,
        serial_number:  document.getElementById('ast-f-serial').value.trim() || null,
        asset_tag:      document.getElementById('ast-f-tag').value.trim()    || null,
        condition:      document.getElementById('ast-f-condition').value,
        purchase_date:  document.getElementById('ast-f-purchase-date').value || null,
        purchase_price: document.getElementById('ast-f-price').value
                          ? Number(document.getElementById('ast-f-price').value) : null,
        vendor:         document.getElementById('ast-f-vendor').value.trim() || null,
        notes:          document.getElementById('ast-f-notes').value.trim()  || null,
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
            asset_id: res.data.id, action: 'created',
            notes: 'Added to inventory', performed_by: _user.id,
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

  async function _uploadPhoto(fileInputId, statusElId, assetId, context, assetCategory = '', assetName = '') {
    const file = document.getElementById(fileInputId)?.files[0]
    if (!file) return null
    const statusEl = document.getElementById(statusElId)
    if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = 'Uploading photo…' }
    const result = await API.uploadAssetPhoto(file, assetId, context, assetCategory, assetName)
    if (statusEl) statusEl.textContent = result.drive_url ? 'Photo uploaded.' : 'Photo upload failed — continuing without photo.'
    return result.drive_url || null
  }

  /* ══════════════════════════════════════════════════════════
     ASSIGN MODAL (HR / Super Admin only)
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
          <label class="form-label">Photo <span style="font-weight:400;color:var(--text-muted);">(recommended)</span></label>
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
      const errEl = document.getElementById('ast-assign-err')
      const btn   = document.getElementById('ast-assign-save')
      const empId = document.getElementById('ast-assign-emp').value
      const cond  = document.getElementById('ast-assign-cond').value
      const notes = document.getElementById('ast-assign-notes').value.trim()

      errEl.style.display = 'none'
      if (!empId) { errEl.textContent = 'Please select an employee.'; errEl.style.display = 'block'; return }

      btn.disabled = true; btn.textContent = 'Assigning…'

      const photoUrl = await _uploadPhoto('ast-assign-photo', 'ast-assign-photo-status', asset.id, 'assign', asset.type || '', asset.name || '')

      const { error } = await API.updateAsset(asset.id, {
        assigned_to:   empId,
        assigned_date: new Date().toISOString().split('T')[0],
        status:        'in_use',
        condition:     cond,
        updated_at:    new Date().toISOString(),
      })

      if (!error) {
        await API.addAssetHistory({
          asset_id: asset.id, action: 'assigned', to_employee_id: empId,
          condition_before: asset.condition, condition_after: cond,
          notes: notes || null, photo_url: photoUrl, performed_by: _user.id,
        })
      }

      btn.disabled = false; btn.textContent = 'Assign'
      if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return }

      if (empId !== _user.id) {
        API.createNotification({
          recipient_employee_id: empId,
          type: 'info',
          message: `Asset "${asset.name}" has been assigned to you.`,
          module: 'assets', record_id: asset.id,
        })
      }
      Utils.closeModal()
      Utils.showToast('Asset assigned.', 'success')
      await _refresh()
    })
  }

  /* ══════════════════════════════════════════════════════════
     RETURN MODAL (assigned user only)
  ══════════════════════════════════════════════════════════ */

  function _openReturnModal(asset) {
    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Request Asset Return</h3>${_modalCloseBtn()}
      </div>
      <div class="modal-body">
        <div id="ast-return-err" class="alert alert--danger" style="display:none;"></div>
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;margin-bottom:16px;font-size:13px;color:var(--text-muted);">
          Your return request will be sent to HR for review. The asset will show as
          <strong>Pending Return</strong> until HR approves. You are still responsible for it until then.
        </div>
        <div style="font-size:13px;font-weight:600;margin-bottom:16px;">${Utils.escapeHtml(asset.name)}</div>
        <div class="form-group">
          <label class="form-label">Condition on Return <span class="required">*</span></label>
          <select class="form-select" id="ast-return-cond">
            ${CONDITIONS.map(c => `<option value="${c}"${(asset.condition || 'Good') === c ? ' selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Notes</label>
          <textarea class="form-input" id="ast-return-notes" rows="2" style="resize:vertical;"
            placeholder="Any observations, damage, accessories included…"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="ast-return-save">Submit Return Request</button>
      </div>
    `)

    document.getElementById('ast-return-save').addEventListener('click', async () => {
      const errEl = document.getElementById('ast-return-err')
      const btn   = document.getElementById('ast-return-save')
      const cond  = document.getElementById('ast-return-cond').value
      const notes = document.getElementById('ast-return-notes').value.trim()

      btn.disabled = true; btn.textContent = 'Submitting…'

      try {
        // 1. Create the return request record
        const { data: rr, error: rrErr } = await API.createAssetReturnRequest({
          asset_id:            asset.id,
          returned_by:         _user.id,
          condition_on_return: cond,
          notes:               notes || null,
          status:              'pending',
        })
        if (rrErr) throw rrErr

        // 2. Move asset to pending_return — still assigned to user
        const { error: assetErr } = await API.updateAsset(asset.id, {
          status:     'pending_return',
          updated_at: new Date().toISOString(),
        })
        if (assetErr) throw assetErr

        // 3. Asset history
        await API.addAssetHistory({
          asset_id:         asset.id,
          action:           'return_requested',
          from_employee_id: _user.id,
          condition_before: asset.condition,
          condition_after:  cond,
          notes:            `Return requested by ${_user.name}. Condition: ${cond}.${notes ? ' ' + notes : ''}`,
          performed_by:     _user.id,
        })

        // 4. Notify all HR / Super Admin
        const { data: hrs } = await Config.supabase
          .from('employees').select('id').in('role', ['super_admin', 'hr'])
        if (hrs?.length) {
          await Config.supabase.from('notifications').insert(
            hrs.map(e => ({
              recipient_employee_id: e.id,
              type:    'info',
              message: `${_user.name} has submitted a return request for "${asset.name}". Please review in Requests → Returns.`,
              module:  'assets',
              record_id: rr?.id || null,
            }))
          )
        }

        // Refresh local state
        const [assetsRes, retReqsRes] = await Promise.all([
          API.getAssets(),
          API.getMyReturnRequests(_user.id),
        ])
        _assets         = assetsRes.data   || []
        _returnRequests = retReqsRes.data  || []

        Utils.closeModal()
        Utils.showToast('Return request submitted — HR has been notified.', 'success')
        _renderMineTab()

      } catch (err) {
        btn.disabled = false; btn.textContent = 'Submit Return Request'
        errEl.textContent = err.message || 'Failed to submit return request.'
        errEl.style.display = 'block'
      }
    })
  }

  /* ══════════════════════════════════════════════════════════
     STATUS UPDATE MODAL (HR / Super Admin)
  ══════════════════════════════════════════════════════════ */

  function _openStatusModal(asset) {
    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Update Status — ${Utils.escapeHtml(asset.name)}</h3>${_modalCloseBtn()}
      </div>
      <div class="modal-body">
        <div id="ast-status-err" class="alert alert--danger" style="display:none;"></div>
        <div class="form-group">
          <label class="form-label">New Status <span class="required">*</span></label>
          <select class="form-select" id="ast-status-val">
            ${Object.entries(STATUSES).map(([v, s]) =>
              `<option value="${v}"${asset.status === v ? ' selected' : ''}>${s.label}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Notes</label>
          <textarea class="form-input" id="ast-status-notes" rows="2" style="resize:vertical;"
            placeholder="Reason for status change…"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="ast-status-save">Update</button>
      </div>
    `)

    document.getElementById('ast-status-save').addEventListener('click', async () => {
      const btn    = document.getElementById('ast-status-save')
      const status = document.getElementById('ast-status-val').value
      const notes  = document.getElementById('ast-status-notes').value.trim()

      btn.disabled = true; btn.textContent = 'Saving…'

      const update = { status, updated_at: new Date().toISOString() }
      // If moving back to available, clear assignment
      if (status === 'available') { update.assigned_to = null; update.assigned_date = null }

      const { error } = await API.updateAsset(asset.id, update)

      btn.disabled = false; btn.textContent = 'Update'
      if (error) { document.getElementById('ast-status-err').textContent = error.message; document.getElementById('ast-status-err').style.display = 'block'; return }

      if (notes) {
        await API.addAssetHistory({
          asset_id: asset.id, action: 'condition_updated',
          notes: `Status updated to ${STATUSES[status]?.label || status}. ${notes}`,
          performed_by: _user.id,
        })
      }

      Utils.closeModal()
      Utils.showToast('Status updated.', 'success')
      await _refresh()
    })
  }

  /* ══════════════════════════════════════════════════════════
     RETIRE MODAL
  ══════════════════════════════════════════════════════════ */

  function _openRetireModal(asset) {
    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title" style="color:var(--warning);">Retire Asset</h3>${_modalCloseBtn()}
      </div>
      <div class="modal-body">
        <div id="ast-retire-err" class="alert alert--danger" style="display:none;"></div>
        <p style="font-size:14px;margin-bottom:16px;">
          Retire <strong>${Utils.escapeHtml(asset.name)}</strong>? The asset will remain in the system for records but cannot be assigned.
        </p>
        <div class="form-group">
          <label class="form-label">Reason <span class="required">*</span></label>
          <textarea class="form-input" id="ast-retire-notes" rows="3" style="resize:vertical;"
            placeholder="e.g. End of lifecycle, replaced by newer model…"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--warning" id="ast-retire-save" style="background:var(--warning);color:#fff;border:none;">Retire Asset</button>
      </div>
    `)

    document.getElementById('ast-retire-save').addEventListener('click', async () => {
      const errEl = document.getElementById('ast-retire-err')
      const btn   = document.getElementById('ast-retire-save')
      const notes = document.getElementById('ast-retire-notes').value.trim()

      if (!notes) { errEl.textContent = 'Please provide a reason.'; errEl.style.display = 'block'; return }

      btn.disabled = true; btn.textContent = 'Retiring…'

      const { error } = await API.updateAsset(asset.id, {
        status:        'retired',
        assigned_to:   null,
        assigned_date: null,
        updated_at:    new Date().toISOString(),
      })

      if (!error) {
        await API.addAssetHistory({
          asset_id: asset.id, action: 'retired',
          notes, performed_by: _user.id,
        })
        // Notify if someone had it assigned
        if (asset.assigned_to && asset.assigned_to !== _user.id) {
          API.createNotification({
            recipient_employee_id: asset.assigned_to,
            type: 'info',
            message: `"${asset.name}" assigned to you has been retired and reclaimed.`,
            module: 'assets',
          })
        }
      }

      btn.disabled = false; btn.textContent = 'Retire Asset'
      if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return }

      Utils.closeModal()
      Utils.showToast('Asset retired.', 'success')
      await _refresh()
    })
  }

  /* ══════════════════════════════════════════════════════════
     DELETE ASSET
  ══════════════════════════════════════════════════════════ */

  async function _confirmDeleteAsset(asset) {
    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title" style="color:var(--danger);">Delete Asset</h3>${_modalCloseBtn()}
      </div>
      <div class="modal-body">
        <p style="font-size:14px;margin-bottom:8px;">
          Permanently delete <strong>${Utils.escapeHtml(asset.name)}</strong>?
        </p>
        <p style="font-size:13px;color:var(--text-muted);">
          This action is irreversible. Use this only if the asset was created by mistake. All history will be lost.
        </p>
        <div style="margin-top:16px;padding:12px;background:#FEF2F2;border-radius:var(--radius);font-size:13px;color:var(--danger);">
          Type <strong>DELETE</strong> to confirm:
        </div>
        <input class="form-input" id="ast-delete-confirm-input" placeholder="Type DELETE" style="margin-top:8px;">
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--danger" id="ast-delete-confirm">Delete Permanently</button>
      </div>
    `)

    document.getElementById('ast-delete-confirm').addEventListener('click', async () => {
      const val = document.getElementById('ast-delete-confirm-input').value.trim()
      if (val !== 'DELETE') { Utils.showToast('Type DELETE to confirm.', 'error'); return }

      const btn = document.getElementById('ast-delete-confirm')
      btn.disabled = true; btn.textContent = 'Deleting…'

      const { error } = await API.deleteAsset(asset.id)

      btn.disabled = false; btn.textContent = 'Delete Permanently'
      if (error) { Utils.showToast(error.message, 'error'); return }

      Utils.closeModal()
      Utils.showToast('Asset deleted.', 'success')
      await _refresh()
    })
  }

  /* ══════════════════════════════════════════════════════════
     REPORT ISSUE MODAL (any employee with assigned asset)
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
          <label class="form-label">Photo <span style="font-weight:400;color:var(--text-muted);">(optional)</span></label>
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

      const photoUrl = await _uploadPhoto('ast-report-photo', 'ast-report-photo-status', asset.id, 'issue', asset.type || '', asset.name || '')

      const { error } = await API.createAssetRepair({
        asset_id: asset.id, reported_by: _user.id,
        type, description: desc, photo_url: photoUrl, status: 'open',
      })

      if (!error) {
        await API.addAssetHistory({
          asset_id: asset.id, action: 'repair_logged',
          notes: `${type === 'repair' ? 'Repair request' : 'Issue'}: ${desc}`,
          performed_by: _user.id,
        })

        // Notify all HR/Super Admin
        const { data: hrs } = await Config.supabase
          .from('employees').select('id').in('role', ['super_admin', 'hr'])
        if (hrs?.length) {
          await Config.supabase.from('notifications').insert(
            hrs.map(e => ({
              recipient_employee_id: e.id,
              type:    'warning',
              message: `${_user.name} reported a ${type} on "${asset.name}": ${Utils.truncate(desc, 80)}`,
              module:  'assets',
            }))
          )
        }
      }

      btn.disabled = false; btn.textContent = 'Submit Report'
      if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return }

      Utils.closeModal()
      Utils.showToast('Issue reported — HR has been notified.', 'success')

      if (_p.can_manage || _p.can_resolve) {
        const { data } = await API.getAllAssetRepairs()
        _repairs = data || []
      } else {
        const { data } = await API.getMyAssetRepairs(_user.id)
        _repairs = data || []
      }
    })
  }

  /* ══════════════════════════════════════════════════════════
     RESOLVE / UPDATE REPAIR MODAL (HR only)
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
          <label class="form-label">Status <span class="required">*</span></label>
          <select class="form-select" id="ast-resolve-status">
            <option value="in_progress"${repair.status === 'in_progress' ? ' selected' : ''}>In Progress</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Notes / Update for Employee</label>
          <textarea class="form-input" id="ast-resolve-notes" rows="2" style="resize:vertical;"
            placeholder="What is being done? Visible to the employee."></textarea>
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
          asset_id: repair.asset_id, action: 'repair_resolved',
          notes: notes || 'Issue resolved', performed_by: _user.id,
        })
        const a = _assets.find(x => x.id === repair.asset_id)
        if (a?.status === 'under_repair') {
          await API.updateAsset(a.id, { status: 'available', updated_at: new Date().toISOString() })
        }
      }

      btn.disabled = false; btn.textContent = 'Update'
      if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return }

      // Notify the reporter
      const notifMsg = status === 'resolved'
        ? `Your reported issue on "${asset?.name}" has been resolved.${notes ? ' Note: ' + notes : ''}`
        : `Update on your reported issue for "${asset?.name}": ${notes || 'Status updated to In Progress.'}`

      await Config.supabase.from('notifications').insert({
        recipient_employee_id: repair.reported_by,
        type:    status === 'resolved' ? 'success' : 'info',
        message: notifMsg,
        module:  'assets',
      })

      // Also notify the reporter's manager
      const reporter = _employees.find(e => e.id === repair.reported_by)
      if (reporter?.manager_id && reporter.manager_id !== repair.reported_by) {
        await Config.supabase.from('notifications').insert({
          recipient_employee_id: reporter.manager_id,
          type:    'info',
          message: `FYI: Issue on "${asset?.name}" (reported by ${reporter.name}) — status updated to ${status === 'resolved' ? 'Resolved' : 'In Progress'}.`,
          module:  'assets',
        })
      }

      Utils.closeModal()
      Utils.showToast('Issue updated.', 'success')
      await _refresh()
    })
  }

  /* ══════════════════════════════════════════════════════════
     REQUEST ASSET MODAL
  ══════════════════════════════════════════════════════════ */

  function _openRequestModal() {
    const available = _assets.filter(a => a.status === 'available')

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Request an Asset</h3>
        ${_modalCloseBtn()}
      </div>
      <div class="modal-body">
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;margin-bottom:16px;font-size:13px;color:var(--text-muted);">
          Your request will go to HR for approval. Your reporting manager will also be notified.
        </div>
        <div class="form-group">
          <label class="form-label">Reason for Request <span class="required">*</span></label>
          <textarea class="form-input" id="ast-req-reason" rows="2" style="resize:vertical;"
            placeholder="Why do you need this asset?"></textarea>
        </div>
        ${!available.length
          ? '<p class="empty-state-text">No assets are currently available.</p>'
          : `<div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">
              <label class="form-label">Select Asset <span class="required">*</span></label>
              ${available.map(a => `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border:1px solid var(--border);border-radius:var(--radius);gap:12px;">
                  <div>
                    <div style="font-weight:600;font-size:14px;">${Utils.escapeHtml(a.name)}</div>
                    <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${Utils.escapeHtml(a.type || '')}${a.asset_tag ? ' · ' + Utils.escapeHtml(a.asset_tag) : ''}</div>
                  </div>
                  <button class="btn btn--sm btn--primary ast-req-btn" data-id="${a.id}" data-name="${Utils.escapeHtml(a.name)}">Request</button>
                </div>`).join('')}
            </div>`}
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
      </div>
    `)

    document.querySelectorAll('.ast-req-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const reason = document.getElementById('ast-req-reason')?.value.trim()
        if (!reason) {
          Utils.showToast('Please provide a reason for your request.', 'error')
          document.getElementById('ast-req-reason')?.focus()
          return
        }

        btn.disabled = true; btn.textContent = 'Submitting…'

        try {
          // Create request directly at pending_hr — manager gets FYI only
          const { data: req, error } = await API.createAssetRequest({
            asset_id:     btn.dataset.id,
            requested_by: _user.id,
            manager_id:   _user.manager_id || null,
            reason,
            status:       'pending_hr',
          })
          if (error) throw error

          // Notify all HR / Super Admin
          const { data: hrs } = await Config.supabase
            .from('employees').select('id').in('role', ['super_admin', 'hr'])
          if (hrs?.length) {
            await Config.supabase.from('notifications').insert(
              hrs.map(e => ({
                recipient_employee_id: e.id,
                type:    'info',
                message: `${_user.name} has requested asset "${btn.dataset.name}". Awaiting your approval.`,
                module:  'assets',
                record_id: req?.id || null,
              }))
            )
          }

          // FYI notification to reporting manager (no action needed)
          if (_user.manager_id) {
            await Config.supabase.from('notifications').insert({
              recipient_employee_id: _user.manager_id,
              type:    'info',
              message: `FYI: ${_user.name} has requested asset "${btn.dataset.name}". HR will handle the approval.`,
              module:  'assets',
              record_id: req?.id || null,
            })
          }

          // Refresh requests list
          if (_p.can_manage) {
            const { data } = await API.getAllAssetRequests()
            _requests = data || []
          } else {
            const { data } = await API.getMySubmittedAssetRequests(_user.id)
            _requests = data || []
          }

          Utils.closeModal()
          Utils.showToast('Request submitted — HR has been notified.', 'success')

        } catch (err) {
          btn.disabled = false; btn.textContent = 'Request'
          Utils.showToast(err.message || 'Failed to submit request.', 'error')
        }
      })
    })
  }

  /* ── Refresh ───────────────────────────────────────────────── */

  async function _refresh() {
    const { data } = await API.getAssets()
    _assets = data || []
    _loadTab(_activeTab)
  }

  async function _refreshAll() {
    const [assetsRes, repairsRes, retReqsRes] = await Promise.all([
      API.getAssets(),
      _p.can_manage || _p.can_resolve ? API.getAllAssetRepairs() : API.getMyAssetRepairs(_user.id),
      _p.can_manage ? API.getAllAssetReturnRequests() : API.getMyReturnRequests(_user.id),
    ])
    _assets         = assetsRes.data   || []
    _repairs        = repairsRes.data  || []
    _returnRequests = retReqsRes.data  || []
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
    manage_assets:         'Manage Assets (assign / add / edit)',
    view_inventories:      'View Inventories Tab',
    retire_delete_asset:   'Retire & Delete Assets',
    resolve_repair:        'Update & Resolve Repairs (HR)',
    manage_asset_types:    'Manage Asset Types',
  },
})
