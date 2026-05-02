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

  // Project Codes tab state
  let _pcView           = false
  let _internalProjects = []
  let _pcPerms          = null

  // Form state
  let _editingClientId  = null
  let _formEntities     = []   // [{ id, name, platforms[], services[] }]
  let _formSelPlatforms = []   // client-level platform selection
  let _files            = { bg: null, sa: null }   // pending file uploads
  let _existingBgUrl    = null   // storage path or URL from DB
  let _existingSaUrl    = null

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
    upload: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>`,
  }

  /* ── Helpers ────────────────────────────────────────────────── */
  function _cap(str) {
    if (!str) return ''
    return str.charAt(0).toUpperCase() + str.slice(1)
  }
  function _canWrite()      { return !!_p?.can_create }
  function _canEdit()       { return !!_p?.can_edit }
  function _canCommercial() { return _user?.role === 'super_admin' || _user?.department === 'business_development' }

  /* ── Document helpers ───────────────────────────────────────── */

  // Uploads to Google Drive via the upload-client-doc Edge Function.
  // clientName is passed directly — no DB lookup needed (works for new clients too).
  // Returns a Drive /view URL stored directly in the DB column.
  async function _uploadClientDoc(clientName, file, type) {
    const { data: { session } } = await Config.supabase.auth.getSession()
    if (!session) throw new Error('Not authenticated')

    const form = new FormData()
    form.append('file',        file)
    form.append('client_name', clientName)
    form.append('doc_type',    type)   // 'brand_guidelines' | 'service_agreement'

    const res = await fetch(
      `${Config.SUPABASE_URL}/functions/v1/upload-client-doc`,
      {
        method:  'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body:    form,
      }
    )
    const payload = await res.json()
    if (!res.ok || !payload.driveUrl) {
      throw new Error(payload.error || 'Document upload failed')
    }
    return payload.driveUrl   // store the Drive URL directly in DB
  }

  // Drive URLs are plain https:// links — no signed URL needed.
  // Keep legacy Supabase storage path support just in case.
  async function _resolveDocUrl(path) {
    if (!path) return null
    if (path.startsWith('http://') || path.startsWith('https://')) return path
    // Legacy: Supabase storage path — generate a signed URL
    const { data, error } = await Config.supabase.storage
      .from('client-documents')
      .createSignedUrl(path, 7200)
    return (error || !data?.signedUrl) ? null : data.signedUrl
  }

  /* ── render ─────────────────────────────────────────────────── */
  function render(user) {
    _user = user
    return `
      <div class="page-inner">
        <div class="page-header">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <div class="tabs" style="border:none;margin:0;gap:0;">
              <button class="tab-btn tab-btn--active" data-cat="all">All</button>
              <button class="tab-btn" data-cat="Shark">Shark</button>
              <button class="tab-btn" data-cat="Dolphin">Dolphin</button>
              <button class="tab-btn" data-cat="Turtle">Turtle</button>
              <button class="tab-btn" data-cat="Snail">Snail</button>
            </div>
            <span style="width:1px;height:20px;background:var(--border);flex-shrink:0;margin:0 4px;display:inline-block;"></span>
            <button class="tab-btn tab-btn--pc" id="cd-pc-tab">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="9" y1="7" x2="15" y2="7"/><line x1="9" y1="11" x2="15" y2="11"/><line x1="9" y1="15" x2="13" y2="15"/></svg>
              Project Codes
            </button>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <div id="cd-dir-controls" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
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
              <button class="btn btn--primary btn--sm" id="cd-add-btn" style="display:none;">+ Add Client</button>
            </div>
            <div id="cd-pc-controls" style="display:none;align-items:center;gap:8px;">
              <button class="btn btn--primary btn--sm" id="cd-pc-add-btn" style="display:none;">+ Add Internal Project</button>
            </div>
          </div>
        </div>
        <div id="cd-content" class="page-loading">Loading clients…</div>
      </div>`
  }

  /* ── init ───────────────────────────────────────────────────── */
  async function init(user) {
    _user = user
    _p = {
      can_create: App.hasAccess('client_directory', 'create_client', 'can_upload'),
      can_edit:   App.hasAccess('client_directory', 'edit_client',   'can_edit'),
    }
    _pcPerms = {
      can_edit:   App.hasAccess('client_directory', 'edit_project_codes',   'can_edit'),
      can_manage: App.hasAccess('client_directory', 'manage_project_codes', 'can_manage'),
    }
    _filter = { category: 'all', status: 'active', search: '' }

    if (_canWrite()) {
      const btn = document.getElementById('cd-add-btn')
      if (btn) { btn.style.display = ''; btn.addEventListener('click', () => _openForm(null)) }
    }

    const { data: emps } = await API.getEmployees(false)
    _employees = emps || []

    await _loadClients()
    _bindFilters()
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
    const cat         = _cap(c.category || '')
    const platforms   = c.client_platforms || []
    const entityCount = (c.client_entities || []).length
    const amName      = c.account_manager?.name || '—'
    const visible     = platforms.slice(0, 3)
    const extra       = platforms.length - visible.length

    return `
      <div class="client-card" data-id="${c.id}">
        <div>
          <div class="client-card-header">
            <div class="client-card-name">${Utils.escapeHtml(c.client_name)}</div>
            ${cat ? `<span class="badge ${CAT_BADGE[cat] || 'badge--muted'}">${cat}</span>` : ''}
          </div>
          <div style="margin-top:5px;">
            <span class="client-card-code">${c.project_code}</span>
          </div>
          ${c.overview ? `<div class="client-card-overview">${Utils.escapeHtml(Utils.truncate(c.overview, 90))}</div>` : ''}
        </div>

        <div class="client-card-platforms">
          ${visible.map(p => `<span class="client-platform-tag">${p.platform_name || p.platform}</span>`).join('')}
          ${extra > 0 ? `<span class="client-platform-tag client-platform-more">+${extra}</span>` : ''}
          ${!platforms.length ? `<span class="client-card-no-platform">No platforms set</span>` : ''}
        </div>

        <div class="client-card-footer">
          <div class="client-card-am">
            <div class="client-card-am-avatar">${c.account_manager?.profile_image_url ? `<img src="${Utils.escapeHtml(c.account_manager.profile_image_url)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">` : Utils.getInitials(amName)}</div>
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
        if (_pcView) _switchToDirectory()
        document.querySelectorAll('[data-cat]').forEach(b => b.classList.remove('tab-btn--active'))
        btn.classList.add('tab-btn--active')
        _filter.category = btn.dataset.cat
        _renderCards()
      })
    )
    const s  = document.getElementById('cd-search')
    const st = document.getElementById('cd-status')
    if (s)  s.addEventListener('input', Utils.debounce(e => { _filter.search = e.target.value; _renderCards() }, 200))
    if (st) st.addEventListener('change', e => { _filter.status = e.target.value; _renderCards() })
    document.getElementById('cd-pc-tab')?.addEventListener('click', _switchToProjectCodes)
  }

  function _switchToDirectory() {
    _pcView = false
    document.getElementById('cd-pc-tab')?.classList.remove('tab-btn--active')
    const dirCtrl = document.getElementById('cd-dir-controls')
    const pcCtrl  = document.getElementById('cd-pc-controls')
    if (dirCtrl) dirCtrl.style.display = 'flex'
    if (pcCtrl)  pcCtrl.style.display  = 'none'
  }

  function _switchToProjectCodes() {
    _pcView = true
    document.querySelectorAll('[data-cat]').forEach(b => b.classList.remove('tab-btn--active'))
    document.getElementById('cd-pc-tab')?.classList.add('tab-btn--active')
    const dirCtrl = document.getElementById('cd-dir-controls')
    const pcCtrl  = document.getElementById('cd-pc-controls')
    if (dirCtrl) dirCtrl.style.display = 'none'
    if (pcCtrl) {
      pcCtrl.style.display = 'flex'
      if (_pcPerms?.can_manage) {
        const addBtn = document.getElementById('cd-pc-add-btn')
        if (addBtn) { addBtn.style.display = ''; addBtn.onclick = () => _openInternalProjectModal(null) }
      }
    }
    _loadProjectCodes()
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

    // Pre-generate signed URLs so document links render as real <a> tags
    const [bgUrl, saUrl] = await Promise.all([
      data.brand_guidelines_url
        ? _resolveDocUrl(data.brand_guidelines_url)
        : Promise.resolve(null),
      data.service_agreement_url && _canCommercial()
        ? _resolveDocUrl(data.service_agreement_url)
        : Promise.resolve(null),
    ])

    _renderDrawerBody(data, { bg: bgUrl, sa: saUrl })
  }

  function _renderDrawerBody(c, docUrls = {}) {
    const body = document.getElementById('cdd-body')
    if (!body) return

    const cat      = _cap(c.category || '')
    const entities = c.client_entities || []
    const platforms = c.client_platforms || []
    const canComm  = _canCommercial()
    const canEdit  = _canEdit()
    const ptLabel  = PROJECT_TYPE_LABELS[c.project_type] || ''
    const hasBg    = !!docUrls.bg
    const hasSa    = canComm && !!docUrls.sa

    body.innerHTML = `
      <!-- Core info grid (visible to all) -->
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
        </div>
      </div>

      ${c.overview ? `
      <div class="divider"></div>
      <div class="cd-drawer-section">
        <div class="cd-drawer-label">Overview</div>
        <div style="font-size:13px;color:var(--text);line-height:1.6;">${Utils.escapeHtml(c.overview)}</div>
      </div>` : ''}

      ${canComm && (ptLabel || c.price) ? `
      <div class="divider"></div>
      <!-- Commercial details (BDE + Super Admin only) -->
      <div class="cd-drawer-section">
        <div class="cd-drawer-label" style="display:flex;align-items:center;gap:8px;">
          Commercial <span class="cd-bde-tag">BDE Only</span>
        </div>
        <div class="cd-info-grid">
          ${ptLabel ? `
          <div class="cd-info-item">
            <div class="cd-info-label">Project Type</div>
            <div class="cd-info-value">${ptLabel}</div>
          </div>` : ''}
          ${c.price ? `
          <div class="cd-info-item">
            <div class="cd-info-label">Monthly Value</div>
            <div class="cd-info-value" style="font-weight:700;color:var(--green);">${Utils.formatCurrency(c.price)}</div>
          </div>` : ''}
        </div>
      </div>` : ''}

      <div class="divider"></div>

      <!-- Platforms (visible to all) -->
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
      <!-- SOW (visible to all) -->
      <div class="cd-drawer-section">
        <div class="cd-drawer-label">Scope of Work</div>
        <div style="font-size:13px;color:var(--text);white-space:pre-wrap;line-height:1.6;">${Utils.escapeHtml(c.sow_notes)}</div>
      </div>` : ''}

      ${hasBg || hasSa ? `
      <div class="divider"></div>
      <!-- Documents: Brand Guidelines = all, Service Agreement = BDE only -->
      <div class="cd-drawer-section">
        <div class="cd-drawer-label">Documents</div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${hasBg ? `
          <a href="${Utils.escapeHtml(docUrls.bg)}"
             target="_blank" rel="noopener noreferrer"
             class="cd-doc-link">
            ${ICONS.file} Brand Guidelines ${ICONS.ext}
          </a>` : ''}
          ${hasSa ? `
          <a href="${Utils.escapeHtml(docUrls.sa)}"
             target="_blank" rel="noopener noreferrer"
             class="cd-doc-link">
            ${ICONS.file} Service Agreement ${ICONS.ext}
          </a>` : ''}
        </div>
      </div>` : ''}

      <div class="divider"></div>

      <!-- Entities (visible to all) -->
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
    _files            = { bg: null, sa: null }
    _existingBgUrl    = client?.brand_guidelines_url  || null
    _existingSaUrl    = client?.service_agreement_url || null

    if (client) {
      _formSelPlatforms = (client.client_platforms || []).map(p => p.platform_name || p.platform)
      _formEntities     = (client.client_entities  || []).map(e => ({
        id:        e.id,
        name:      e.entity_name,
        platforms: (e.entity_platforms || []).map(p => p.platform),
        services:  (e.entity_services  || []).map(s => s.service),
      }))
    }

    const isEdit    = !!client
    const canComm   = _canCommercial()
    const amOptions = _employees
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
          <div class="grid-2">
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
        <!-- COMMERCIAL (BDE + Super Admin only) -->
        <div class="cd-form-section">
          <div class="cd-form-section-title">
            Commercial <span class="cd-bde-tag">BDE Only</span>
          </div>
          <div class="grid-2">
            <div class="form-group">
              <label class="form-label">Monthly Price (₹)</label>
              <input class="form-input" id="cdf-price" type="number" min="0" placeholder="e.g. 150000"
                     value="${client?.price || ''}">
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
          <div class="form-group">
            <label class="form-label">Service Agreement</label>
            <div id="cdf-sa-field"></div>
            <span class="form-hint">PDF, DOC, DOCX · max 10 MB</span>
          </div>
        </div>` : ''}

        <!-- PLATFORMS -->
        <div class="cd-form-section">
          <div class="cd-form-section-title">Client Platforms</div>
          <div class="form-group">
            <label class="form-label">
              Active Platforms
              <span class="form-hint" style="display:inline;margin-left:6px;">Select all that apply</span>
            </label>
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
            <label class="form-label">Overview</label>
            <textarea class="form-input" id="cdf-overview" rows="2"
                      placeholder="One or two lines about this client — visible on the card to everyone…"
                      style="resize:vertical;">${Utils.escapeHtml(client?.overview || '')}</textarea>
            <span class="form-hint">Shown on the directory card · visible to all employees</span>
          </div>
          <div class="form-group">
            <label class="form-label">Brand Guidelines</label>
            <div id="cdf-bg-field"></div>
            <span class="form-hint">PDF, DOC, DOCX · max 10 MB</span>
          </div>
          <div class="form-group" style="margin-bottom:0;">
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

    /* Render file upload fields */
    _renderFileField('bg', _existingBgUrl)
    if (canComm) _renderFileField('sa', _existingSaUrl)

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

  /* ── File Field ─────────────────────────────────────────────── */
  function _renderFileField(fieldId, existingUrl) {
    const container = document.getElementById(`cdf-${fieldId}-field`)
    if (!container) return

    const file = _files[fieldId]

    if (file) {
      /* New file selected — show name + remove */
      container.innerHTML = `
        <div class="cd-file-chosen">
          <span class="cd-file-icon">${ICONS.file}</span>
          <span class="cd-file-name">${Utils.escapeHtml(file.name)}</span>
          <button type="button" class="cd-file-remove" data-clear="${fieldId}" title="Remove">×</button>
        </div>`
    } else if (existingUrl) {
      /* Existing file — show View + Replace */
      container.innerHTML = `
        <div class="cd-file-chosen">
          <span class="cd-file-icon">${ICONS.file}</span>
          <span class="cd-file-name cd-file-name--existing">Uploaded document</span>
          <button type="button" class="cd-file-action" data-view-file="${fieldId}">View</button>
          <span class="cd-file-sep">·</span>
          <label class="cd-file-action" style="cursor:pointer;">
            Replace<input type="file" id="cdf-${fieldId}-input" accept=".pdf,.doc,.docx" style="display:none;">
          </label>
        </div>`
    } else {
      /* Empty — show choose file */
      container.innerHTML = `
        <label class="cd-file-pick-label">
          ${ICONS.upload} Choose File
          <input type="file" id="cdf-${fieldId}-input" accept=".pdf,.doc,.docx" style="display:none;">
        </label>`
    }

    /* Bind file input (appears in both empty and Replace states) */
    const input = container.querySelector(`#cdf-${fieldId}-input`)
    if (input) {
      input.addEventListener('change', e => {
        const f = e.target.files?.[0]
        if (!f) return
        if (f.size > 10 * 1024 * 1024) {
          Utils.showToast('File must be under 10 MB', 'error')
          return
        }
        _files[fieldId] = f
        _renderFileField(fieldId, existingUrl)
      })
    }

    /* Bind clear */
    container.querySelector('[data-clear]')?.addEventListener('click', () => {
      _files[fieldId] = null
      _renderFileField(fieldId, existingUrl)
    })

    /* Bind view */
    container.querySelector('[data-view-file]')?.addEventListener('click', () => {
      _viewDoc(existingUrl)
    })
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
    const amId    = document.getElementById('cdf-am')?.value || null
    const overview = (document.getElementById('cdf-overview')?.value || '').trim() || null
    const sow     = (document.getElementById('cdf-sow')?.value || '').trim() || null

    // Commercial fields — only present in DOM when canComm is true
    const price = _canCommercial() ? (document.getElementById('cdf-price')?.value || null) : null
    const type  = _canCommercial() ? (document.getElementById('cdf-type')?.value  || null) : null

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
      const isEdit   = !!_editingClientId
      // Pre-generate UUID for new clients so files can be uploaded before DB insert
      const clientId = isEdit ? _editingClientId : crypto.randomUUID()

      /* Upload any new files first — pass client name directly, no DB lookup */
      let bgUrl = _existingBgUrl
      let saUrl = _existingSaUrl

      if (_files.bg) {
        bgUrl = await _uploadClientDoc(name, _files.bg, 'brand_guidelines')
      }
      if (_files.sa && _canCommercial()) {
        saUrl = await _uploadClientDoc(name, _files.sa, 'service_agreement')
      }

      /* Build client record — category must match DB check constraint exactly */
      const clientData = {
        project_code:         code,
        client_name:          name,
        category:             cat,   // 'Shark' | 'Dolphin' | 'Turtle' | 'Snail'
        status,
        am_id:                amId,
        overview,
        sow_notes:            sow,
        brand_guidelines_url: bgUrl,
      }

      // Only write commercial fields if the user has that permission
      if (_canCommercial()) {
        clientData.project_type          = type
        clientData.price                 = price ? Number(price) : null
        clientData.service_agreement_url = saUrl
      }

      if (isEdit) {
        const { error } = await Config.supabase.from('clients')
          .update(clientData).eq('id', clientId)
        if (error) throw error

        /* Replace platforms */
        await Config.supabase.from('client_platforms').delete().eq('client_id', clientId)
        /* Replace entities (cascades to entity_platforms + entity_services) */
        await Config.supabase.from('client_entities').delete().eq('client_id', clientId)
      } else {
        const { error } = await Config.supabase.from('clients')
          .insert({ id: clientId, ...clientData, created_by: _user.id })
        if (error) throw error
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

      // Reset status filter to "all" so the saved client is always visible
      // regardless of what status it was saved with
      _filter.status = 'all'
      const stDropdown = document.getElementById('cd-status')
      if (stDropdown) stDropdown.value = 'all'

      await _loadClients()

    } catch (err) {
      const msg = err.message || ''
      errEl.textContent = (msg.includes('unique') || msg.includes('duplicate'))
        ? `Project code "${code}" is already in use.`
        : (msg.includes('brand_guidelines_url') || msg.includes('service_agreement_url') || msg.includes('schema cache'))
          ? 'DB schema update required. Please run phase6_migration.sql in Supabase first.'
          : (msg || 'Something went wrong. Please try again.')
      errEl.style.display = 'block'
    } finally {
      saveBtn.disabled    = false
      saveBtn.textContent = _editingClientId ? 'Save Changes' : 'Create Client'
    }
  }

  /* ══════════════════════════════════════════════════════════
     PROJECT CODES TAB
  ══════════════════════════════════════════════════════════ */

  async function _loadProjectCodes() {
    const el = document.getElementById('cd-content')
    if (el) { el.className = ''; el.innerHTML = '<p class="loading-text">Loading project codes…</p>' }
    const { data, error } = await API.getInternalProjects()
    if (error) { Utils.showToast('Failed to load internal projects', 'error'); return }
    _internalProjects = data || []
    _renderProjectCodesTable()
  }

  const SVG_EDIT  = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`
  const SVG_CHECK = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
  const SVG_CROSS = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`

  function _renderProjectCodesTable() {
    const el = document.getElementById('cd-content')
    if (!el) return

    const sortedClients = [..._clients].sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1
      if (b.status === 'active' && a.status !== 'active') return 1
      return a.client_name.localeCompare(b.client_name)
    })
    const activeInt   = _internalProjects.filter(p => p.status === 'active')
    const inactiveInt = _internalProjects.filter(p => p.status !== 'active')

    el.className = ''
    el.innerHTML = `
      <!-- ── Client Projects ────────────────────────────────── -->
      <div class="pc-section" style="margin-bottom:28px;">
        <div class="pc-section-header">
          <div>
            <h3 class="pc-section-title">Client Projects</h3>
            <p class="pc-section-sub">${sortedClients.length} client${sortedClients.length !== 1 ? 's' : ''} · tiers and codes are managed in the Client Directory</p>
          </div>
        </div>
        <div class="section-card" style="overflow-x:auto;">
          <table class="data-table pc-table">
            <thead>
              <tr>
                <th style="min-width:200px;">Client Name</th>
                <th style="min-width:100px;">Project Code</th>
                <th style="min-width:90px;">Category</th>
                <th style="min-width:200px;">Entities / Contacts</th>
                <th>Description</th>
                <th style="width:52px;"></th>
              </tr>
            </thead>
            <tbody>
              ${sortedClients.length
                ? sortedClients.map(_clientProjectRow).join('')
                : '<tr><td colspan="6" class="pc-empty">No clients found.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <!-- ── Internal Projects ──────────────────────────────── -->
      <div class="pc-section">
        <div class="pc-section-header">
          <div>
            <h3 class="pc-section-title">Internal Projects</h3>
            <p class="pc-section-sub">Growthic brands, sister companies, and departmental initiatives</p>
          </div>
        </div>
        <div class="section-card" style="overflow-x:auto;">
          <table class="data-table pc-table">
            <thead>
              <tr>
                <th style="min-width:200px;">Project Name</th>
                <th style="min-width:100px;">Project Code</th>
                <th style="min-width:90px;">Category</th>
                <th style="min-width:200px;">Work Areas</th>
                <th>Description</th>
                <th style="width:80px;"></th>
              </tr>
            </thead>
            <tbody>
              ${activeInt.length
                ? activeInt.map(p => _internalProjectRow(p, false)).join('')
                : '<tr><td colspan="6" class="pc-empty">No internal projects yet.</td></tr>'}
              ${inactiveInt.length ? `
                <tr class="pc-inactive-divider"><td colspan="6">Inactive</td></tr>
                ${inactiveInt.map(p => _internalProjectRow(p, true)).join('')}
              ` : ''}
            </tbody>
          </table>
        </div>
      </div>
    `

    // Bind edit buttons
    el.querySelectorAll('.pc-edit-client').forEach(btn =>
      btn.addEventListener('click', () => {
        const c = _clients.find(x => x.id === btn.dataset.id)
        if (c) _openClientEditModal(c)
      })
    )
    el.querySelectorAll('.pc-edit-internal').forEach(btn =>
      btn.addEventListener('click', () => {
        const p = _internalProjects.find(x => x.id === btn.dataset.id)
        if (p) _openInternalProjectModal(p)
      })
    )
    el.querySelectorAll('.pc-toggle-status').forEach(btn =>
      btn.addEventListener('click', async () => {
        const p = _internalProjects.find(x => x.id === btn.dataset.id)
        if (!p) return
        const next = p.status === 'active' ? 'inactive' : 'active'
        const { error } = await API.setInternalProjectStatus(p.id, next)
        if (error) { Utils.showToast('Failed to update status', 'error'); return }
        Utils.showToast(`Project ${next === 'active' ? 'activated' : 'deactivated'}`, 'success')
        await _loadProjectCodes()
      })
    )
  }

  function _clientProjectRow(c) {
    const cat      = _cap(c.category || '')
    const entities = c.client_entities || []
    const inactive = c.status !== 'active'

    return `
      <tr class="${inactive ? 'pc-row--inactive' : ''}">
        <td>
          <div class="pc-row-name">${Utils.escapeHtml(c.client_name)}</div>
          ${inactive ? `<span class="badge badge--muted" style="font-size:10px;margin-top:3px;">${c.status}</span>` : ''}
        </td>
        <td><code class="pc-code">${Utils.escapeHtml(c.project_code)}</code></td>
        <td>
          ${cat ? `<span class="badge ${CAT_BADGE[cat] || 'badge--muted'}">${cat}</span>` : '<span style="color:var(--text-muted);">—</span>'}
        </td>
        <td>
          <div style="display:flex;flex-wrap:wrap;gap:4px;">
            ${entities.length
              ? entities.map(e => `<span class="badge badge--outline" style="font-size:11px;">${Utils.escapeHtml(e.entity_name)}</span>`).join('')
              : '<span style="color:var(--text-muted);font-size:12px;">—</span>'}
          </div>
        </td>
        <td class="pc-desc-cell">
          ${c.project_description ? Utils.escapeHtml(c.project_description) : '<span class="pc-desc-empty">No description set</span>'}
        </td>
        <td>
          ${_pcPerms?.can_edit ? `<button class="btn-icon-sm pc-edit-client" data-id="${c.id}" title="Edit">${SVG_EDIT}</button>` : ''}
        </td>
      </tr>`
  }

  function _internalProjectRow(p, isInactive) {
    const entities = [...(p.internal_project_entities || [])].sort((a, b) => a.sort_order - b.sort_order)
    const cat      = _cap(p.category || 'internal')

    return `
      <tr class="${isInactive ? 'pc-row--inactive' : ''}">
        <td><div class="pc-row-name">${Utils.escapeHtml(p.name)}</div></td>
        <td><code class="pc-code">${Utils.escapeHtml(p.project_code)}</code></td>
        <td><span class="badge badge--internal">${Utils.escapeHtml(cat)}</span></td>
        <td>
          <div style="display:flex;flex-wrap:wrap;gap:4px;">
            ${entities.length
              ? entities.map(e => `<span class="badge badge--outline" style="font-size:11px;">${Utils.escapeHtml(e.entity_name)}</span>`).join('')
              : '<span style="color:var(--text-muted);font-size:12px;">—</span>'}
          </div>
        </td>
        <td class="pc-desc-cell">
          ${p.description ? Utils.escapeHtml(p.description) : '<span class="pc-desc-empty">No description set</span>'}
        </td>
        <td>
          <div style="display:flex;gap:4px;justify-content:flex-end;align-items:center;">
            ${_pcPerms?.can_edit ? `<button class="btn-icon-sm pc-edit-internal" data-id="${p.id}" title="Edit">${SVG_EDIT}</button>` : ''}
            ${_pcPerms?.can_manage ? `
              <button class="btn-icon-sm pc-toggle-status" data-id="${p.id}"
                      title="${isInactive ? 'Activate' : 'Deactivate'}"
                      style="color:${isInactive ? 'var(--success)' : 'var(--danger)'};">
                ${isInactive ? SVG_CHECK : SVG_CROSS}
              </button>` : ''}
          </div>
        </td>
      </tr>`
  }

  /* ── Edit client project details (category + description) ── */
  function _openClientEditModal(client) {
    const cats = ['Shark', 'Dolphin', 'Turtle', 'Snail']
    const curCat = _cap(client.category || '')

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Edit Project Details</h3>
        <button class="modal-close" onclick="Utils.closeModal()">${ICONS.close}</button>
      </div>
      <div class="modal-body">
        <div style="display:flex;align-items:center;gap:10px;padding:10px 0 16px;border-bottom:1px solid var(--border-light);margin-bottom:16px;">
          <code class="pc-code">${Utils.escapeHtml(client.project_code)}</code>
          <span style="font-size:14px;font-weight:600;color:var(--text);">${Utils.escapeHtml(client.client_name)}</span>
        </div>
        <div class="form-group">
          <label class="form-label">Category</label>
          <select class="form-select" id="pc-client-cat" style="height:38px;">
            <option value="">— None —</option>
            ${cats.map(c => `<option value="${c.toLowerCase()}" ${curCat === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">Description</label>
          <span class="form-hint" style="display:block;margin-bottom:6px;">Guidance for employees logging time to this project</span>
          <textarea class="form-input" id="pc-client-desc" rows="4"
            placeholder="e.g. Log hours here for any work related to this client…"
            style="resize:vertical;">${Utils.escapeHtml(client.project_description || '')}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="pc-client-save">Save Changes</button>
      </div>
    `)

    document.getElementById('pc-client-save')?.addEventListener('click', async () => {
      const btn  = document.getElementById('pc-client-save')
      const cat  = document.getElementById('pc-client-cat').value
      const desc = document.getElementById('pc-client-desc').value.trim()

      btn.disabled = true; btn.textContent = 'Saving…'
      const { error } = await API.updateClientProjectDetails(client.id, { project_description: desc, category: cat || null })
      btn.disabled = false; btn.textContent = 'Save Changes'

      if (error) { Utils.showToast('Failed to save changes', 'error'); return }

      // Update local cache
      const c = _clients.find(x => x.id === client.id)
      if (c) { c.project_description = desc || null; c.category = cat || null }
      Utils.closeModal()
      Utils.showToast('Project details updated', 'success')
      _renderProjectCodesTable()
    })
  }

  /* ── Add / Edit internal project ──────────────────────────── */
  function _openInternalProjectModal(project) {
    const isEdit = !!project
    let _ents = project
      ? [...(project.internal_project_entities || [])].sort((a, b) => a.sort_order - b.sort_order).map(e => e.entity_name)
      : []

    const renderEntList = () => {
      const wrap = document.getElementById('pc-ent-list')
      if (!wrap) return
      wrap.innerHTML = _ents.map((e, i) => `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <input class="form-input pc-ent-inp" data-idx="${i}"
            value="${Utils.escapeHtml(e)}" placeholder="Work area name" style="flex:1;">
          <button class="btn-icon-sm pc-ent-del" data-idx="${i}" type="button" title="Remove" style="flex-shrink:0;">
            ${SVG_CROSS}
          </button>
        </div>`).join('') +
        `<button class="btn btn--ghost btn--sm" id="pc-ent-add" type="button">+ Add Work Area</button>`

      wrap.querySelectorAll('.pc-ent-inp').forEach(inp =>
        inp.addEventListener('input', e => { _ents[parseInt(e.target.dataset.idx)] = e.target.value })
      )
      wrap.querySelectorAll('.pc-ent-del').forEach(btn =>
        btn.addEventListener('click', () => { _ents.splice(parseInt(btn.dataset.idx), 1); renderEntList() })
      )
      document.getElementById('pc-ent-add')?.addEventListener('click', () => { _ents.push(''); renderEntList() })
    }

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">${isEdit ? 'Edit Internal Project' : 'Add Internal Project'}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">${ICONS.close}</button>
      </div>
      <div class="modal-body">
        <div id="pc-ip-err" class="alert--danger" style="display:none;margin-bottom:12px;padding:10px 14px;border-radius:var(--radius);font-size:13px;"></div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Project Name <span class="required">*</span></label>
            <input class="form-input" id="pc-ip-name"
              value="${Utils.escapeHtml(project?.name || '')}"
              placeholder="e.g. Growthic People & Culture">
          </div>
          <div class="form-group">
            <label class="form-label">Project Code <span class="required">*</span></label>
            <input class="form-input" id="pc-ip-code"
              value="${Utils.escapeHtml(project?.project_code || '')}"
              placeholder="e.g. GRW-HR" maxlength="12"
              style="text-transform:uppercase;font-family:monospace;">
            <span class="form-hint">All caps · hyphens allowed · max 12 chars</span>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Category</label>
          <input class="form-input" id="pc-ip-cat"
            value="${Utils.escapeHtml(project?.category || 'internal')}"
            placeholder="e.g. Internal">
          <span class="form-hint">Displayed as a badge in the Project Codes table</span>
        </div>
        <div class="form-group">
          <label class="form-label">Description</label>
          <textarea class="form-input" id="pc-ip-desc" rows="2"
            placeholder="Guidance for employees logging time here…"
            style="resize:vertical;">${Utils.escapeHtml(project?.description || '')}</textarea>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">Work Areas</label>
          <span class="form-hint" style="display:block;margin-bottom:8px;">Sub-tasks or activity types within this project</span>
          <div id="pc-ent-list"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="pc-ip-save">${isEdit ? 'Save Changes' : 'Create Project'}</button>
      </div>
    `)

    document.getElementById('pc-ip-code')?.addEventListener('input', e => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9\-]/g, '')
    })
    renderEntList()

    document.getElementById('pc-ip-save')?.addEventListener('click', async () => {
      const errEl = document.getElementById('pc-ip-err')
      const btn   = document.getElementById('pc-ip-save')
      const name  = document.getElementById('pc-ip-name').value.trim()
      const code  = document.getElementById('pc-ip-code').value.trim()
      const cat   = document.getElementById('pc-ip-cat').value.trim() || 'internal'
      const desc  = document.getElementById('pc-ip-desc').value.trim()
      const ents  = Array.from(document.querySelectorAll('.pc-ent-inp'))
                         .map(i => i.value.trim()).filter(Boolean)

      errEl.style.display = 'none'
      if (!name) { errEl.textContent = 'Project name is required.'; errEl.style.display = 'block'; return }
      if (!code) { errEl.textContent = 'Project code is required.'; errEl.style.display = 'block'; return }

      btn.disabled = true; btn.textContent = isEdit ? 'Saving…' : 'Creating…'

      const { error } = isEdit
        ? await API.updateInternalProject(project.id, { name, project_code: code, category: cat, description: desc, entities: ents })
        : await API.createInternalProject({ name, project_code: code, category: cat, description: desc, entities: ents })

      btn.disabled = false; btn.textContent = isEdit ? 'Save Changes' : 'Create Project'

      if (error) {
        const msg = error.message || ''
        errEl.textContent = (msg.includes('unique') || msg.includes('duplicate'))
          ? `Project code "${code}" is already in use.`
          : (msg || 'Something went wrong. Please try again.')
        errEl.style.display = 'block'
        return
      }

      Utils.closeModal()
      Utils.showToast(`Project ${isEdit ? 'updated' : 'created'} successfully`, 'success')
      await _loadProjectCodes()
    })
  }

  return { render, init }
})()

ModuleRegistry.register({
  key:       'client_directory',
  routeId:   'client-directory',
  label:     'Client Directory',
  order:     2,
  icon:      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>`,
  getModule: () => ClientDirectory,
  features:  {
    view_clients:         'View Clients',
    create_client:        'Create Client',
    edit_client:          'Edit Client',
    edit_project_codes:   'Edit Project Codes',
    manage_project_codes: 'Manage Internal Projects',
  },
})
