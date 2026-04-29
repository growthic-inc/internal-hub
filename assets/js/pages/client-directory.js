/* ============================================================
   CLIENT DIRECTORY — Phase 6
   Card-based layout · Entity → Platform + Service detail
   ============================================================ */

const ClientDirectory = (() => {

  /* ── State ─────────────────────────────────────────────────── */
  let _user      = null
  let _clients   = []
  let _employees = []
  let _filter    = { category: 'all', status: 'active', search: '' }
  let _p         = null

  // Form state
  let _editingClientId       = null
  let _formEntities          = []   // [{ id, name, platforms[], services[] }]
  let _formSelPlatforms      = []   // client-level platforms

  /* ── Constants ─────────────────────────────────────────────── */
  const PLATFORMS = ['LinkedIn', 'Instagram', 'Reddit', 'Quora', 'YouTube']

  const SERVICES = [
    'Performance Marketing', 'SEO', 'OTT & TV Ads', 'Website Development',
    'Employer Branding', 'Personal Branding', 'Founder Branding',
    'Content Strategy', 'UGC', 'Influencer Marketing', 'Company Branding',
  ]

  const PROJECT_TYPE_LABELS = {
    retainer:      'Retainer',
    project_based: 'Project-based',
    one_time:      'One-time',
  }

  const CAT_BADGE = {
    Shark: 'badge--primary', Dolphin: 'badge--success',
    Turtle: 'badge--warning', Snail: 'badge--muted',
  }

  const STATUS_BADGE = {
    active: 'badge--success', paused: 'badge--warning',
    inactive: 'badge--danger', archived: 'badge--muted',
  }

  const ICONS = {
    search: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    close:  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    file:   `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    ext:    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
  }

  /* ── Helpers ────────────────────────────────────────────────── */
  function _cap(str) {
    if (!str) return ''
    return str.charAt(0).toUpperCase() + str.slice(1)
  }
  function _canWrite()      { return ['super_admin', 'founders_office', 'bde'].includes(_user?.role) && !!_p?.can_create }
  function _canEdit()       { return ['super_admin', 'bde'].includes(_user?.role) && !!_p?.can_edit }
  function _canCommercial() { return ['super_admin', 'bde'].includes(_user?.role) }

  /* ── render ─────────────────────────────────────────────────── */
  function render(user) {
    _user = user
    return `
      <div class="page-inner">
        <div class="page-header">
          <div class="tabs" style="border:none;margin:0;gap:0;">
            <button class="tab-btn tab-btn--active" data-cat="all">All</button>
            <button class="tab-btn" data-cat="Shark">Shark</button>
            <button class="tab-btn" data-cat="Dolphin">Dolphin</button>
            <button class="tab-btn" data-cat="Turtle">Turtle</button>
            <button class="tab-btn" data-cat="Snail">Snail</button>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <div class="search-wrap">
              <span class="search-icon">${ICONS.search}</span>
              <input class="form-input" id="cd-search" type="search"
                     placeholder="Search clients, codes or managers…">
            </div>
            <select class="form-select" id="cd-status" style="width:auto;height:38px;">
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="inactive">Inactive</option>
              <option value="all">All statuses</option>
            </select>
            ${_canWrite() ? `<button class="btn btn-primary btn-sm" id="cd-add-btn">+ Add Client</button>` : ''}
          </div>
        </div>
        <div id="cd-content" class="page-loading">Loading clients…</div>
      </div>`
  }

  /* ── init ───────────────────────────────────────────────────── */
  async function init(user) {
    _user   = user
    _p      = {
      can_create: App.hasAccess('client_directory', 'create_client', 'can_upload'),
      can_edit:   App.hasAccess('client_directory', 'edit_client',   'can_edit'),
    }
    _filter = { category: 'all', status: 'active', search: '' }

    const { data: emps } = await API.getAllEmployees()
    _employees = (emps || []).filter(e => e.status === 'active')

    await _loadClients()
    _bindFilters()
    if (_canWrite()) document.getElementById('cd-add-btn')?.addEventListener('click', () => _openForm(null))
  }

  /* ── Data ───────────────────────────────────────────────────── */
  async function _loadClients() {
    const { data, error } = await API.getClients(true)
    if (error) { Utils.showToast('Failed to load clients', 'error'); return }
    _clients = data || []
    _renderCards()
  }

  function _filtered() {
    const q = _filter.search.toLowerCase()
    return _clients.filter(c => {
      const cat = _cap(c.category || '')
      if (_filter.category !== 'all' && cat !== _filter.category) return false
      if (_filter.status   !== 'all' && c.status !== _filter.status) return false
      const am = (c.account_manager?.name || '').toLowerCase()
      if (q && !c.client_name.toLowerCase().includes(q) &&
               !c.project_code.toLowerCase().includes(q) &&
               !am.includes(q)) return false
      return true
    })
  }

  /* ── Cards ──────────────────────────────────────────────────── */
  function _renderCards() {
    const el = document.getElementById('cd-content')
    if (!el) return
    const list = _filtered()

    if (!list.length) {
      el.className = ''
      el.innerHTML = `<div class="empty-state"><h3>No clients found</h3><p>Try adjusting your filters or search.</p></div>`
      return
    }

    el.className = ''
    el.innerHTML = `<div class="client-grid">${list.map(_cardHTML).join('')}</div>`
    el.querySelectorAll('.client-card').forEach(card =>
      card.addEventListener('click', () => _openDrawer(card.dataset.id))
    )
  }

  function _cardHTML(c) {
    const cat          = _cap(c.category || '')
    const platforms    = c.client_platforms || []
    const entityCount  = (c.client_entities || []).length
    const amName       = c.account_manager?.name || '—'
    const visible      = platforms.slice(0, 4)
    const extra        = platforms.length - visible.length

    return `
      <div class="client-card" data-id="${c.id}">
        <div class="client-card-top">
          <div class="client-card-header">
            <div class="client-card-name">${Utils.escapeHtml(c.client_name)}</div>
            ${cat ? `<span class="badge ${CAT_BADGE[cat] || 'badge--muted'}">${cat}</span>` : ''}
          </div>
          <div class="client-card-code">${c.project_code}</div>
        </div>

        <div class="client-card-platforms">
          ${visible.map(p => `<span class="client-platform-tag">${p.platform_name || p.platform}</span>`).join('')}
          ${extra > 0 ? `<span class="client-platform-tag client-platform-more">+${extra}</span>` : ''}
          ${!platforms.length ? `<span class="client-card-no-platform">No platforms set</span>` : ''}
        </div>

        <div class="client-card-footer">
          <div class="client-card-am">
            <div class="client-card-am-avatar">${Utils.getInitials(amName)}</div>
            <span>${Utils.escapeHtml(amName)}</span>
          </div>
          <div class="client-card-meta">
            <span>${entityCount} ${entityCount === 1 ? 'entity' : 'entities'}</span>
            <span class="badge ${STATUS_BADGE[c.status] || 'badge--muted'}" style="font-size:10px;padding:2px 7px;">${c.status}</span>
          </div>
        </div>
      </div>`
  }

  /* ── Filters ────────────────────────────────────────────────── */
  function _bindFilters() {
    document.querySelectorAll('[data-cat]').forEach(btn =>
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-cat]').forEach(b => b.classList.remove('tab-btn--active'))
        btn.classList.add('tab-btn--active')
        _filter.category = btn.dataset.cat
        _renderCards()
      })
    )
    const s = document.getElementById('cd-search')
    if (s) s.addEventListener('input', Utils.debounce(e => { _filter.search = e.target.value; _renderCards() }, 200))
    const st = document.getElementById('cd-status')
    if (st) st.addEventListener('change', e => { _filter.status = e.target.value; _renderCards() })
  }

  /* ── Drawer ─────────────────────────────────────────────────── */
  async function _openDrawer(clientId) {
    Utils.openDrawer(`
      <div class="drawer-header">
        <div>
          <div class="drawer-title" id="cdd-name">Loading…</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px;" id="cdd-code"></div>
        </div>
        <button class="btn-icon-sm" onclick="Utils.closeDrawer()">${ICONS.close}</button>
      </div>
      <div class="drawer-body" id="cdd-body"><div class="page-loading">Loading…</div></div>`)

    const { data, error } = await API.getClient(clientId)
    if (error || !data) {
      const b = document.getElementById('cdd-body')
      if (b) b.innerHTML = '<div class="empty-state"><p>Failed to load client.</p></div>'
      return
    }

    const nameEl = document.getElementById('cdd-name')
    const codeEl = document.getElementById('cdd-code')
    if (nameEl) nameEl.textContent = data.client_name
    if (codeEl) codeEl.textContent = data.project_code

    _renderDrawerBody(data)
  }

  function _renderDrawerBody(c) {
    const body = document.getElementById('cdd-body')
    if (!body) return

    const cat      = _cap(c.category || '')
    const entities = c.client_entities || []
    const platforms = c.client_platforms || []
    const canComm  = _canCommercial()
    const canEdit  = _canEdit()
    const ptLabel  = PROJECT_TYPE_LABELS[c.project_type] || ''

    body.innerHTML = `
      <!-- Info grid -->
      <div class="cd-drawer-section">
        <div class="cd-info-grid">
          <div class="cd-info-item">
            <div class="cd-info-label">Category</div>
            <span class="badge ${CAT_BADGE[cat] || 'badge--muted'}">${cat || '—'}</span>
          </div>
          <div class="cd-info-item">
            <div class="cd-info-label">Status</div>
            <span class="badge ${STATUS_BADGE[c.status] || 'badge--muted'}">${c.status}</span>
          </div>
          <div class="cd-info-item">
            <div class="cd-info-label">Account Manager</div>
            <div class="cd-info-value">${Utils.escapeHtml(c.account_manager?.name || '—')}</div>
          </div>
          <div class="cd-info-item">
            <div class="cd-info-label">Client Since</div>
            <div class="cd-info-value">${Utils.formatDate(c.created_at)}</div>
          </div>
          ${ptLabel ? `
          <div class="cd-info-item">
            <div class="cd-info-label">Project Type</div>
            <div class="cd-info-value">${ptLabel}</div>
          </div>` : ''}
          ${canComm && c.price ? `
          <div class="cd-info-item">
            <div class="cd-info-label">Monthly Value</div>
            <div class="cd-info-value" style="font-weight:700;color:var(--green);">${Utils.formatCurrency(c.price)}</div>
          </div>` : ''}
        </div>
      </div>

      <div class="divider"></div>

      <!-- Platforms -->
      <div class="cd-drawer-section">
        <div class="cd-drawer-label">Client Platforms</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${platforms.length
            ? platforms.map(p => `<span class="badge badge--outline">${p.platform_name || p.platform}</span>`).join('')
            : '<span style="font-size:13px;color:var(--text-muted)">—</span>'}
        </div>
      </div>

      ${c.sow_notes ? `
      <div class="divider"></div>
      <div class="cd-drawer-section">
        <div class="cd-drawer-label">Scope of Work</div>
        <div style="font-size:13px;color:var(--text);white-space:pre-wrap;line-height:1.6;">${Utils.escapeHtml(c.sow_notes)}</div>
      </div>` : ''}

      ${(c.brand_guidelines_url || (canComm && c.service_agreement_url)) ? `
      <div class="divider"></div>
      <div class="cd-drawer-section">
        <div class="cd-drawer-label">Documents</div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${c.brand_guidelines_url ? `
          <a href="${Utils.escapeHtml(c.brand_guidelines_url)}" target="_blank" rel="noopener" class="cd-doc-link">
            ${ICONS.file} Brand Guidelines ${ICONS.ext}
          </a>` : ''}
          ${canComm && c.service_agreement_url ? `
          <a href="${Utils.escapeHtml(c.service_agreement_url)}" target="_blank" rel="noopener" class="cd-doc-link">
            ${ICONS.file} Service Agreement ${ICONS.ext}
          </a>` : ''}
        </div>
      </div>` : ''}

      <div class="divider"></div>

      <!-- Entities -->
      <div class="cd-drawer-section">
        <div class="cd-drawer-label">Entities (${entities.length})</div>
        ${entities.length
          ? `<div class="cd-entity-list">${entities.map(_entityRowHTML).join('')}</div>`
          : `<p style="font-size:13px;color:var(--text-muted);">No entities added yet.</p>`}
      </div>

      ${canEdit ? `
      <div class="divider"></div>
      <div class="cd-drawer-section">
        <button class="btn btn-secondary btn-sm" id="cdd-edit-btn">Edit Client</button>
      </div>` : ''}
    `

    /* Entity accordion toggles */
    body.querySelectorAll('.cd-entity-row[data-has-detail]').forEach(row => {
      row.querySelector('.cd-entity-toggle')?.addEventListener('click', () => {
        const detail  = row.querySelector('.cd-entity-detail')
        const chevron = row.querySelector('.cd-entity-chevron')
        if (!detail) return
        const open = detail.style.display !== 'none'
        detail.style.display = open ? 'none' : 'block'
        if (chevron) chevron.style.transform = open ? '' : 'rotate(90deg)'
      })
    })

    /* Edit button */
    if (canEdit) {
      document.getElementById('cdd-edit-btn')?.addEventListener('click', () => {
        Utils.closeDrawer()
        _openForm(c)
      })
    }
  }

  function _entityRowHTML(e) {
    const platforms = (e.entity_platforms || []).map(p => p.platform)
    const services  = (e.entity_services  || []).map(s => s.service)
    const hasDetail = platforms.length > 0 || services.length > 0

    return `
      <div class="cd-entity-row${hasDetail ? '" data-has-detail="1"' : '"'}>
        <div class="cd-entity-toggle" style="${hasDetail ? 'cursor:pointer;' : ''}">
          <span class="cd-entity-chevron" style="display:inline-block;transition:transform 0.15s;margin-right:6px;font-size:10px;color:var(--text-muted);">${hasDetail ? '▶' : ' '}</span>
          <span class="cd-entity-name">${Utils.escapeHtml(e.entity_name)}</span>
        </div>
        ${hasDetail ? `
        <div class="cd-entity-detail" style="display:none;padding-left:20px;margin-top:10px;">
          ${platforms.length ? `
          <div style="margin-bottom:8px;">
            <div class="cd-entity-sub-label">Platforms</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">
              ${platforms.map(p => `<span class="badge badge--blue" style="font-size:11px;">${p}</span>`).join('')}
            </div>
          </div>` : ''}
          ${services.length ? `
          <div>
            <div class="cd-entity-sub-label">Services</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">
              ${services.map(s => `<span class="badge badge--outline" style="font-size:11px;">${s}</span>`).join('')}
            </div>
          </div>` : ''}
        </div>` : ''}
      </div>`
  }

  /* ── Add / Edit Form Modal ──────────────────────────────────── */
  function _openForm(client) {
    _editingClientId  = client?.id || null
    _formEntities     = []
    _formSelPlatforms = []

    if (client) {
      _formSelPlatforms = (client.client_platforms || []).map(p => p.platform_name || p.platform)
      _formEntities     = (client.client_entities  || []).map(e => ({
        id:        e.id,
        name:      e.entity_name,
        platforms: (e.entity_platforms || []).map(p => p.platform),
        services:  (e.entity_services  || []).map(s => s.service),
      }))
    }

    const isEdit     = !!client
    const canComm    = _canCommercial()
    const amOptions  = _employees
      .map(e => `<option value="${e.id}" ${client?.am_id === e.id ? 'selected' : ''}>${Utils.escapeHtml(e.name)}</option>`)
      .join('')

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">${isEdit ? 'Edit Client' : 'Add New Client'}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">${ICONS.close}</button>
      </div>
      <div class="modal-body" style="padding-bottom:8px;">
        <div id="cd-form-err" class="alert alert-danger" style="display:none;margin-bottom:16px;"></div>

        <!-- BASIC INFO -->
        <div class="cd-form-section">
          <div class="cd-form-section-title">Basic Information</div>
          <div class="grid-2">
            <div class="form-group">
              <label class="form-label">Project Code <span style="color:var(--danger)">*</span></label>
              <input class="form-input" id="cdf-code" placeholder="e.g. CRYSTA" maxlength="12"
                     value="${Utils.escapeHtml(client?.project_code || '')}" style="text-transform:uppercase;">
              <span class="form-hint">All caps · no spaces</span>
            </div>
            <div class="form-group">
              <label class="form-label">Client Name <span style="color:var(--danger)">*</span></label>
              <input class="form-input" id="cdf-name" placeholder="Full client or brand name"
                     value="${Utils.escapeHtml(client?.client_name || '')}">
            </div>
          </div>
          <div class="grid-3">
            <div class="form-group">
              <label class="form-label">Category</label>
              <select class="form-select" id="cdf-cat">
                ${['Shark','Dolphin','Turtle','Snail'].map(v =>
                  `<option value="${v}" ${_cap(client?.category) === v ? 'selected' : ''}>${v}</option>`
                ).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Status</label>
              <select class="form-select" id="cdf-status">
                ${['active','paused','inactive'].map(v =>
                  `<option value="${v}" ${client?.status === v ? 'selected' : ''}>${_cap(v)}</option>`
                ).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Project Type</label>
              <select class="form-select" id="cdf-type">
                <option value="">— Select —</option>
                ${Object.entries(PROJECT_TYPE_LABELS).map(([v, l]) =>
                  `<option value="${v}" ${client?.project_type === v ? 'selected' : ''}>${l}</option>`
                ).join('')}
              </select>
            </div>
          </div>
        </div>

        <!-- ACCOUNT -->
        <div class="cd-form-section">
          <div class="cd-form-section-title">Account</div>
          <div class="form-group" style="max-width:320px;">
            <label class="form-label">Account Manager</label>
            <select class="form-select" id="cdf-am">
              <option value="">— Not assigned —</option>
              ${amOptions}
            </select>
          </div>
        </div>

        ${canComm ? `
        <!-- COMMERCIAL -->
        <div class="cd-form-section">
          <div class="cd-form-section-title">
            Commercial
            <span class="cd-bde-tag">BDE Only</span>
          </div>
          <div class="grid-2">
            <div class="form-group">
              <label class="form-label">Monthly Price (₹)</label>
              <input class="form-input" id="cdf-price" type="number" min="0" placeholder="e.g. 150000"
                     value="${client?.price || ''}">
            </div>
            <div class="form-group">
              <label class="form-label">Service Agreement URL</label>
              <input class="form-input" id="cdf-agreement-url" type="url"
                     placeholder="Paste Drive / Notion link"
                     value="${Utils.escapeHtml(client?.service_agreement_url || '')}">
            </div>
          </div>
        </div>` : ''}

        <!-- PLATFORMS -->
        <div class="cd-form-section">
          <div class="cd-form-section-title">Client Platforms</div>
          <div class="form-group">
            <label class="form-label">Active Platforms <span class="form-hint" style="display:inline;margin-left:6px;">Select all that apply</span></label>
            <div class="pill-select" id="cdf-platforms">
              ${PLATFORMS.map(p => `
                <button type="button" class="pill-opt${_formSelPlatforms.includes(p) ? ' pill-opt--active' : ''}"
                        data-platform="${p}">${p}</button>`).join('')}
            </div>
          </div>
        </div>

        <!-- CLIENT DETAILS -->
        <div class="cd-form-section">
          <div class="cd-form-section-title">Client Details</div>
          <div class="form-group">
            <label class="form-label">Brand Guidelines URL</label>
            <input class="form-input" id="cdf-bg-url" type="url"
                   placeholder="Paste Drive / Notion link"
                   value="${Utils.escapeHtml(client?.brand_guidelines_url || '')}">
          </div>
          <div class="form-group">
            <label class="form-label">Scope of Work</label>
            <textarea class="form-input" id="cdf-sow" rows="4"
                      placeholder="Describe deliverables, cadence, key context…"
                      style="resize:vertical;">${Utils.escapeHtml(client?.sow_notes || '')}</textarea>
          </div>
        </div>

        <!-- ENTITIES -->
        <div class="cd-form-section" style="border-bottom:none;padding-bottom:0;">
          <div class="cd-form-section-title" style="display:flex;align-items:center;justify-content:space-between;">
            Entities
            <button type="button" class="btn btn-secondary btn-sm" id="cdf-add-entity">+ Add Entity</button>
          </div>
          <div id="cdf-entities-list"></div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="cdf-save">${isEdit ? 'Save Changes' : 'Create Client'}</button>
      </div>`, 'modal--lg')

    /* Render existing entities (edit mode) */
    _renderFormEntities()

    /* Platform pills */
    document.getElementById('cdf-platforms')?.querySelectorAll('.pill-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = btn.dataset.platform
        if (_formSelPlatforms.includes(p)) {
          _formSelPlatforms = _formSelPlatforms.filter(x => x !== p)
          btn.classList.remove('pill-opt--active')
        } else {
          _formSelPlatforms.push(p)
          btn.classList.add('pill-opt--active')
        }
      })
    })

    /* Project code auto-uppercase */
    document.getElementById('cdf-code')?.addEventListener('input', e => {
      e.target.value = e.target.value.toUpperCase()
    })

    /* Add entity */
    document.getElementById('cdf-add-entity')?.addEventListener('click', () => {
      _formEntities.push({ id: null, name: '', platforms: [], services: [] })
      _renderFormEntities()
    })

    /* Save */
    document.getElementById('cdf-save')?.addEventListener('click', _saveClient)
  }

  /* ── Entity Form Section ────────────────────────────────────── */
  function _renderFormEntities() {
    const list = document.getElementById('cdf-entities-list')
    if (!list) return

    if (!_formEntities.length) {
      list.innerHTML = `<p style="font-size:13px;color:var(--text-muted);padding:8px 0;">No entities yet. Click "+ Add Entity" to add one.</p>`
      return
    }

    list.innerHTML = _formEntities.map((e, idx) => `
      <div class="cd-entity-form-card" data-idx="${idx}">
        <div class="cd-entity-form-header">
          <input class="form-input" placeholder="Entity name (e.g. Viren Khullar, STIM)"
                 style="flex:1;" value="${Utils.escapeHtml(e.name)}" data-ename="${idx}">
          <button type="button" class="btn-icon-sm" data-rm="${idx}" title="Remove entity"
                  style="margin-left:8px;flex-shrink:0;">${ICONS.close}</button>
        </div>
        <div style="margin-bottom:10px;">
          <label class="cd-entity-sub-label" style="display:block;margin-bottom:6px;">Platforms</label>
          <div class="pill-select">
            ${PLATFORMS.map(p => `
              <button type="button" class="pill-opt${e.platforms.includes(p) ? ' pill-opt--active' : ''}"
                      data-ep="${idx}" data-val="${p}">${p}</button>`).join('')}
          </div>
        </div>
        <div>
          <label class="cd-entity-sub-label" style="display:block;margin-bottom:6px;">Services</label>
          <div class="pill-select">
            ${SERVICES.map(s => `
              <button type="button" class="pill-opt${e.services.includes(s) ? ' pill-opt--active' : ''}"
                      data-es="${idx}" data-val="${s}">${s}</button>`).join('')}
          </div>
        </div>
      </div>`).join('')

    /* Entity name inputs */
    list.querySelectorAll('[data-ename]').forEach(inp =>
      inp.addEventListener('input', () => {
        const idx = parseInt(inp.dataset.ename)
        _formEntities[idx].name = inp.value
      })
    )

    /* Entity platform pills */
    list.querySelectorAll('[data-ep]').forEach(btn =>
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.ep)
        const val = btn.dataset.val
        const arr = _formEntities[idx].platforms
        if (arr.includes(val)) {
          _formEntities[idx].platforms = arr.filter(x => x !== val)
          btn.classList.remove('pill-opt--active')
        } else {
          arr.push(val)
          btn.classList.add('pill-opt--active')
        }
      })
    )

    /* Entity service pills */
    list.querySelectorAll('[data-es]').forEach(btn =>
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.es)
        const val = btn.dataset.val
        const arr = _formEntities[idx].services
        if (arr.includes(val)) {
          _formEntities[idx].services = arr.filter(x => x !== val)
          btn.classList.remove('pill-opt--active')
        } else {
          arr.push(val)
          btn.classList.add('pill-opt--active')
        }
      })
    )

    /* Remove entity */
    list.querySelectorAll('[data-rm]').forEach(btn =>
      btn.addEventListener('click', () => {
        _formEntities.splice(parseInt(btn.dataset.rm), 1)
        _renderFormEntities()
      })
    )
  }

  /* ── Save ───────────────────────────────────────────────────── */
  async function _saveClient() {
    const saveBtn = document.getElementById('cdf-save')
    const errEl   = document.getElementById('cd-form-err')

    const code   = (document.getElementById('cdf-code')?.value || '').trim().toUpperCase()
    const name   = (document.getElementById('cdf-name')?.value || '').trim()
    const cat    = document.getElementById('cdf-cat')?.value
    const status = document.getElementById('cdf-status')?.value
    const type   = document.getElementById('cdf-type')?.value || null
    const amId   = document.getElementById('cdf-am')?.value   || null
    const price  = document.getElementById('cdf-price')?.value || null
    const agUrl  = (document.getElementById('cdf-agreement-url')?.value || '').trim() || null
    const bgUrl  = (document.getElementById('cdf-bg-url')?.value || '').trim() || null
    const sow    = (document.getElementById('cdf-sow')?.value || '').trim() || null

    errEl.style.display = 'none'

    if (!code || !name) {
      errEl.textContent = 'Project code and client name are required.'
      errEl.style.display = 'block'; return
    }
    if (!/^[A-Z0-9]+$/.test(code)) {
      errEl.textContent = 'Project code must be alphanumeric, all caps, no spaces.'
      errEl.style.display = 'block'; return
    }
    for (const e of _formEntities) {
      if (!e.name.trim()) {
        errEl.textContent = 'Every entity must have a name.'
        errEl.style.display = 'block'; return
      }
    }

    saveBtn.disabled    = true
    saveBtn.textContent = 'Saving…'

    try {
      const isEdit     = !!_editingClientId
      const clientData = {
        project_code:         code,
        client_name:          name,
        category:             cat.toLowerCase(),
        status,
        project_type:         type,
        am_id:                amId,
        price:                price ? Number(price) : null,
        service_agreement_url: agUrl,
        brand_guidelines_url:  bgUrl,
        sow_notes:            sow,
      }

      let clientId

      if (isEdit) {
        const { error } = await Config.supabase.from('clients')
          .update(clientData).eq('id', _editingClientId)
        if (error) throw error
        clientId = _editingClientId

        /* Replace platforms */
        await Config.supabase.from('client_platforms').delete().eq('client_id', clientId)
        /* Replace entities (cascade deletes entity_platforms + entity_services) */
        await Config.supabase.from('client_entities').delete().eq('client_id', clientId)
      } else {
        const { data, error } = await Config.supabase.from('clients')
          .insert({ ...clientData, created_by: _user.id })
          .select('id').single()
        if (error) throw error
        clientId = data.id
      }

      /* Client-level platforms */
      if (_formSelPlatforms.length) {
        await Config.supabase.from('client_platforms').insert(
          _formSelPlatforms.map(p => ({ client_id: clientId, platform_name: p }))
        )
      }

      /* Entities → entity_platforms → entity_services */
      for (const entity of _formEntities) {
        const { data: entRow, error: entErr } = await Config.supabase
          .from('client_entities')
          .insert({ client_id: clientId, entity_name: entity.name.trim() })
          .select('id').single()
        if (entErr) continue

        const eid = entRow.id
        if (entity.platforms.length) {
          await Config.supabase.from('entity_platforms').insert(
            entity.platforms.map(p => ({ entity_id: eid, platform: p }))
          )
        }
        if (entity.services.length) {
          await Config.supabase.from('entity_services').insert(
            entity.services.map(s => ({ entity_id: eid, service: s }))
          )
        }
      }

      Utils.closeModal()
      Utils.showToast(`Client ${isEdit ? 'updated' : 'created'} successfully`, 'success')
      await _loadClients()

    } catch (err) {
      const msg = err.message || ''
      errEl.textContent = (msg.includes('unique') || msg.includes('duplicate'))
        ? `Project code "${code}" is already in use.`
        : (msg || 'Something went wrong. Please try again.')
      errEl.style.display = 'block'
    } finally {
      saveBtn.disabled    = false
      saveBtn.textContent = _editingClientId ? 'Save Changes' : 'Create Client'
    }
  }

  return { render, init }
})()
