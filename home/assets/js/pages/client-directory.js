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
  let _clientType       = 'company'   // 'company' | 'personal_profile' — set once, deliberately, at creation
  let _formEntities     = []   // [{ id, name, platforms[], services[] }] — 'company' clients only
  let _formSelPlatforms = []   // client-level platform selection
  let _personalLinkedin = ''   // 'personal_profile' clients only — the one entity's LinkedIn URL
  let _personalServices = []   // 'personal_profile' clients only — the one entity's services
  let _personalEntityId = null // 'personal_profile' clients only — the existing sole entity's id, if any
  let _formTeamIds      = []   // employee IDs for Assigned Team
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
  function _canWrite()            { return !!_p?.can_create }
  function _canEdit()             { return !!_p?.can_edit }
  function _canCommercial()       { return _user?.role === 'super_admin' || Utils.getDeptSystemKey(_user?.department) === 'business_development' }
  function _canUploadBrandBook()  { return App.hasAccess('client_directory', 'brand_book', 'can_upload') }
  function _canDeleteBrandBook()  { return App.hasAccess('client_directory', 'brand_book', 'can_edit') }

  /* ── Document helpers ───────────────────────────────────────── */

  // Creates the base client folder in both Shared Drives immediately on client creation.
  // Fire-and-forget — failure is non-fatal (upload-client-doc creates folders on demand anyway).
  async function _createClientFolder(clientName, clientStatus) {
    const { data: { session } } = await Config.supabase.auth.getSession()
    if (!session) return
    const res = await fetch(`${Config.SUPABASE_URL}/functions/v1/create-client-folder`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey':        Config.SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ client_name: clientName, client_status: clientStatus }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) console.warn('[Drive] create-client-folder failed:', json.error)
    else         console.log('[Drive] client folder created ✓', clientName)
  }

  // Uploads to Google Drive via the upload-client-doc Edge Function.
  // clientName is passed directly — no DB lookup needed (works for new clients too).
  // Returns a Drive /view URL stored directly in the DB column.
  async function _uploadClientDoc(clientName, clientStatus, file, type) {
    const { data: { session } } = await Config.supabase.auth.getSession()
    if (!session) throw new Error('Not authenticated')

    const form = new FormData()
    form.append('file',          file)
    form.append('client_name',   clientName)
    form.append('client_status', clientStatus || 'active')
    form.append('doc_type',      type)   // 'brand_guidelines' | 'service_agreement'

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

    // Fetch doc URLs, team members, and brand books in parallel
    const [bgUrl, saUrl, { data: teamData }, { data: booksData }] = await Promise.all([
      data.brand_guidelines_url
        ? _resolveDocUrl(data.brand_guidelines_url)
        : Promise.resolve(null),
      data.service_agreement_url && _canCommercial()
        ? _resolveDocUrl(data.service_agreement_url)
        : Promise.resolve(null),
      API.getClientTeam(clientId),
      API.getBrandBooks(clientId),
    ])

    _renderDrawerBody(data, { bg: bgUrl, sa: saUrl }, teamData || [], booksData || [])
  }

  function _renderDrawerBody(c, docUrls = {}, teamMembers = [], brandBooks = []) {
    const body = document.getElementById('cdd-body')
    if (!body) return

    const cat      = _cap(c.category || '')
    const entities = c.client_entities || []
    const platforms = c.client_platforms || []
    const canComm  = _canCommercial()
    const canEdit  = _canEdit()
    const canUploadBB = _canUploadBrandBook()
    const canDeleteBB = _canDeleteBrandBook()
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
            ${c.status_changed_at ? `<div style="font-size:11px;color:var(--text-muted);margin-top:3px;">Changed by ${Utils.escapeHtml(c.status_changer?.name || '—')} · ${Utils.formatDate(c.status_changed_at)}</div>` : ''}
          </div>
          <div class="cd-info-item">
            <div class="cd-info-label">Account Manager</div>
            <div class="cd-info-value">${Utils.escapeHtml(c.account_manager?.name || '—')}</div>
          </div>
          <div class="cd-info-item">
            <div class="cd-info-label">Client Since</div>
            <div class="cd-info-value">${Utils.formatDate(c.created_at)}</div>
          </div>
          ${c.details_updated_at ? `
          <div class="cd-info-item">
            <div class="cd-info-label">Last Edited</div>
            <div class="cd-info-value" style="font-size:12px;">${Utils.formatDateTime(c.details_updated_at)}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">by ${Utils.escapeHtml(c.details_updater?.name || '—')}</div>
          </div>` : ''}
        </div>
      </div>

      <!-- Assigned Team (visible to all) -->
      <div class="divider"></div>
      <div class="cd-drawer-section">
        <div class="cd-drawer-label">Assigned Team</div>
        ${teamMembers.length ? `
        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:8px;">
          ${teamMembers.map(tm => {
            const emp = tm.employees || {}
            const avatar = emp.profile_image_url
              ? `<img src="${Utils.escapeHtml(emp.profile_image_url)}" style="width:30px;height:30px;border-radius:50%;object-fit:cover;flex-shrink:0;">`
              : `<span class="avatar-circle avatar-circle--sm" style="flex-shrink:0;">${Utils.escapeHtml(Utils.getInitials(emp.name || ''))}</span>`
            return `
            <div style="display:flex;align-items:center;gap:8px;background:var(--surface-2,#f8f9fa);border:1px solid var(--border);border-radius:8px;padding:5px 10px 5px 6px;">
              ${avatar}
              <div>
                <div style="font-size:12px;font-weight:600;line-height:1.2;">${Utils.escapeHtml(emp.name || '')}</div>
                ${emp.designation ? `<div style="font-size:11px;color:var(--text-muted);">${Utils.escapeHtml(emp.designation)}</div>` : ''}
              </div>
            </div>`
          }).join('')}
        </div>` : `<p style="font-size:13px;color:var(--text-muted);margin-top:4px;">No team members assigned yet.</p>`}
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

      <!-- Brand Books -->
      <div class="divider"></div>
      <div class="cd-drawer-section" id="cdd-bb-section">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <div class="cd-drawer-label" style="margin-bottom:0;">Brand Books</div>
          ${canUploadBB ? `<button class="btn btn--secondary btn--sm" id="cdd-bb-upload-btn">+ Upload</button>` : ''}
        </div>
        ${brandBooks.length ? `
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${brandBooks.map(bb => `
          <div style="display:flex;align-items:center;gap:8px;" data-bb-id="${bb.id}">
            <a href="${Utils.escapeHtml(bb.drive_url)}" target="_blank" rel="noopener noreferrer"
               class="cd-doc-link" style="flex:1;overflow:hidden;">
              ${ICONS.file}
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${Utils.escapeHtml(bb.name)}</span>
              ${ICONS.ext}
            </a>
            ${canDeleteBB ? `<button class="btn-icon-sm cd-bb-delete" data-id="${bb.id}" title="Delete brand book" style="color:var(--danger);flex-shrink:0;">×</button>` : ''}
          </div>`).join('')}
        </div>` : `<p style="font-size:13px;color:var(--text-muted);">No brand books uploaded yet.</p>`}
      </div>

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
      <div class="cd-drawer-section" style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn--secondary btn--sm" id="cdd-edit-btn">Edit Client</button>
        <button class="btn btn--sm ${c.status === 'inactive' ? 'btn--success' : 'btn--danger'}" id="cdd-status-btn">
          ${c.status === 'inactive' ? 'Reactivate' : 'Deactivate'}
        </button>
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

    /* Brand Book — upload button */
    document.getElementById('cdd-bb-upload-btn')?.addEventListener('click', () => {
      _openBrandBookUpload(c.id, c.client_name, c.status)
    })

    /* Brand Book — delete buttons */
    body.querySelectorAll('.cd-bb-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this brand book? This cannot be undone.')) return
        btn.disabled = true
        const { error } = await API.deleteBrandBook(btn.dataset.id)
        if (error) { Utils.showToast('Failed to delete brand book', 'error'); btn.disabled = false; return }
        // Remove row from DOM immediately
        const row = btn.closest('[data-bb-id]')
        if (row) row.remove()
        // If no books left, update empty state
        const section = document.getElementById('cdd-bb-section')
        if (section && !section.querySelectorAll('[data-bb-id]').length) {
          const list = section.querySelector('div[style*="flex-direction:column"]')
          if (list) list.outerHTML = `<p style="font-size:13px;color:var(--text-muted);">No brand books uploaded yet.</p>`
        }
        Utils.showToast('Brand book deleted', 'success')
      })
    })

    /* Edit button */
    if (canEdit) {
      document.getElementById('cdd-edit-btn')?.addEventListener('click', () => {
        Utils.closeDrawer()
        _openForm(c)
      })

      /* Deactivate / Reactivate button */
      document.getElementById('cdd-status-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('cdd-status-btn')
        const isInactive = c.status === 'inactive'
        const nextStatus = isInactive ? 'active' : 'inactive'
        const label      = isInactive ? 'Reactivating…' : 'Deactivating…'

        btn.disabled = true; btn.textContent = label
        const { error } = await API.setClientStatus(c.id, nextStatus, _user?.id)
        if (error) {
          Utils.showToast('Failed to update client status', 'error')
          btn.disabled = false; btn.textContent = isInactive ? 'Reactivate' : 'Deactivate'
          return
        }

        Utils.closeDrawer()
        Utils.showToast(
          isInactive ? `${c.client_name} reactivated` : `${c.client_name} deactivated`,
          isInactive ? 'success' : 'info'
        )
        await _loadClients()
      })
    }
  }

  /* ── Brand Book Upload Modal ────────────────────────────────── */
  function _openBrandBookUpload(clientId, clientName, clientStatus) {
    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Upload Brand Book</h3>
        <button class="modal-close" onclick="Utils.closeModal()">${ICONS.close}</button>
      </div>
      <div class="modal-body">
        <div id="bb-err" class="alert alert-danger" style="display:none;margin-bottom:12px;"></div>
        <div class="form-group">
          <label class="form-label">Brand Book Name <span style="color:var(--danger)">*</span></label>
          <input class="form-input" id="bb-name" placeholder="e.g. GDA Brand Book, STIM Brand Book">
          <span class="form-hint">Give it a clear name so the team knows which account it belongs to</span>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">PDF File <span style="color:var(--danger)">*</span></label>
          <label class="cd-file-pick-label" id="bb-file-label">
            ${ICONS.upload} Choose PDF
            <input type="file" id="bb-file" accept=".pdf" style="display:none;">
          </label>
          <div id="bb-file-name" style="font-size:12px;color:var(--text-muted);margin-top:6px;display:none;"></div>
          <span class="form-hint">PDF only · max 20 MB · uploaded to the client's Brand Books folder on Drive</span>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="bb-upload-btn" disabled>Upload to Drive</button>
      </div>`)

    document.getElementById('bb-file')?.addEventListener('change', e => {
      const f    = e.target.files?.[0]
      const nameEl = document.getElementById('bb-file-name')
      const btn    = document.getElementById('bb-upload-btn')
      const lbl    = document.getElementById('bb-file-label')
      if (!f) return
      if (f.size > 20 * 1024 * 1024) {
        Utils.showToast('File must be under 20 MB', 'error')
        return
      }
      if (nameEl) { nameEl.textContent = `✓ ${f.name}`; nameEl.style.display = 'block' }
      if (lbl)    lbl.innerHTML = `${ICONS.upload} Change File <input type="file" id="bb-file" accept=".pdf" style="display:none;">`
      if (btn)    { btn.disabled = false }
    })

    document.getElementById('bb-upload-btn')?.addEventListener('click', async () => {
      const nameVal = (document.getElementById('bb-name')?.value || '').trim()
      const file    = document.getElementById('bb-file')?.files?.[0]
      const errEl   = document.getElementById('bb-err')
      const btn     = document.getElementById('bb-upload-btn')

      errEl.style.display = 'none'
      if (!nameVal) { errEl.textContent = 'Please enter a brand book name.'; errEl.style.display = 'block'; return }
      if (!file)    { errEl.textContent = 'Please choose a PDF file.';       errEl.style.display = 'block'; return }

      btn.disabled = true; btn.textContent = 'Uploading…'

      try {
        const driveUrl = await _uploadClientDoc(clientName, clientStatus, file, 'brand_book')
        const { error } = await API.saveBrandBook(clientId, nameVal, driveUrl, file.name, _user.id)
        if (error) throw new Error(error.message)
        Utils.closeModal()
        Utils.showToast('Brand book uploaded successfully!', 'success')
        // Re-open drawer to refresh brand books list
        _openDrawer(clientId)
      } catch (err) {
        errEl.textContent = err.message || 'Upload failed. Please try again.'
        errEl.style.display = 'block'
        btn.disabled = false; btn.textContent = 'Upload to Drive'
      }
    })
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
    _clientType       = client?.client_type || 'company'
    _formEntities     = []
    _formSelPlatforms = []
    _personalLinkedin = ''
    _personalServices = []
    _personalEntityId = null
    _formTeamIds      = []
    _files            = { bg: null, sa: null }
    _existingBgUrl    = client?.brand_guidelines_url  || null
    _existingSaUrl    = client?.service_agreement_url || null

    if (client) {
      _formSelPlatforms = (client.client_platforms || []).map(p => p.platform_name || p.platform)
      if (_clientType === 'personal_profile') {
        // Exactly one entity backs a personal-profile client — its own analytics
        // row, kept in sync with this client's own fields, never shown as a
        // separate "entity" the user manages.
        const soleEntity = (client.client_entities || [])[0]
        _personalEntityId = soleEntity?.id || null
        _personalLinkedin = soleEntity?.linkedin_url || ''
        _personalServices = (soleEntity?.entity_services || []).map(s => s.service)
      } else {
        _formEntities = (client.client_entities || []).map(e => ({
          id:           e.id,
          name:         e.entity_name,
          linkedin_url: e.linkedin_url || '',
          platforms:    (e.entity_platforms || []).map(p => p.platform),
          services:     (e.entity_services  || []).map(s => s.service),
        }))
      }
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
          <div class="form-group">
            <label class="form-label">Client Type</label>
            <div style="display:flex;gap:16px;">
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:400;">
                <input type="radio" name="cdf-client-type" value="company" ${_clientType === 'company' ? 'checked' : ''}>
                Company
              </label>
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:400;">
                <input type="radio" name="cdf-client-type" value="personal_profile" ${_clientType === 'personal_profile' ? 'checked' : ''}>
                Personal Profile
              </label>
            </div>
            <span class="form-hint">A company can have multiple tracked profiles (page + spokespeople). A personal profile client IS the one person being tracked — e.g. Akhilesh Srivastava.</span>
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
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Assigned Team</label>
            <div id="cdf-team-tags" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;min-height:4px;"></div>
            <div style="position:relative;">
              <input class="form-input" id="cdf-team-search" placeholder="Type a name to add team members…" autocomplete="off">
              <div id="cdf-team-dropdown"
                   style="display:none;position:absolute;top:100%;left:0;right:0;z-index:200;background:var(--surface);border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);max-height:200px;overflow-y:auto;margin-top:4px;"></div>
            </div>
            <span class="form-hint">Select all employees working on this client</span>
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

        <!-- BRAIN INTELLIGENCE -->
        <div class="cd-form-section">
          <div class="cd-form-section-title" style="display:flex;align-items:center;gap:6px;">
            <span style="color:var(--primary);">Brain Intelligence</span>
            <span style="font-size:11px;color:var(--text-muted);font-weight:400;">— Gmail matching for this client</span>
          </div>
          <div class="form-group">
            <label class="form-label">Client Domain</label>
            <input class="form-input" id="cdf-domain" type="text"
                   placeholder="e.g. clientname.com"
                   value="${Utils.escapeHtml(client?.client_domain || '')}">
            <span class="form-hint">For clients with a custom domain — Brain matches all emails from this domain</span>
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Contact Emails</label>
            <textarea class="form-input" id="cdf-contacts" rows="2"
                      placeholder="e.g. founder@gmail.com, cmo@yahoo.com"
                      style="resize:vertical;">${Utils.escapeHtml((client?.client_contacts || []).join(', '))}</textarea>
            <span class="form-hint">For Gmail / Yahoo clients — add specific emails, comma-separated</span>
          </div>
        </div>

        <!-- ENTITIES (Company clients only) -->
        <div class="cd-form-section" id="cdf-entities-section"
             style="border-bottom:none;padding-bottom:0;display:${_clientType === 'company' ? '' : 'none'};">
          <div class="cd-form-section-title" style="display:flex;align-items:center;justify-content:space-between;">
            Entities
            <button type="button" class="btn btn-secondary btn-sm" id="cdf-add-entity">+ Add Entity</button>
          </div>
          <div id="cdf-entities-list"></div>
        </div>

        <!-- PROFILE DETAILS (Personal Profile clients only) -->
        <div class="cd-form-section" id="cdf-personal-section"
             style="border-bottom:none;padding-bottom:0;display:${_clientType === 'personal_profile' ? '' : 'none'};">
          <div class="cd-form-section-title">Profile Details</div>
          <div class="form-group">
            <label class="form-label">LinkedIn Profile URL</label>
            <input class="form-input" type="url" id="cdf-personal-linkedin"
                   placeholder="https://linkedin.com/in/theirprofile"
                   value="${Utils.escapeHtml(_personalLinkedin)}">
            <span class="form-hint">Used to fetch post engagement (likes/comments/reposts) via Apify.</span>
          </div>
          <div class="form-group">
            <label class="form-label">Services</label>
            <div class="pill-select" id="cdf-personal-services">
              ${SERVICES.map(s => `
                <button type="button" class="pill-opt${_personalServices.includes(s) ? ' pill-opt--active' : ''}"
                        data-val="${s}">${s}</button>`).join('')}
            </div>
            <span class="form-hint">Platforms come from the "Platforms" selection above.</span>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="cdf-save">${isEdit ? 'Save Changes' : 'Create Client'}</button>
      </div>`, 'modal--lg')

    /* Render file upload fields */
    _renderFileField('bg', _existingBgUrl)
    if (canComm) _renderFileField('sa', _existingSaUrl)

    /* Team picker — bind immediately, then load existing team async if editing */
    _bindTeamPicker()
    if (client?.id) {
      API.getClientTeam(client.id).then(({ data }) => {
        if (!data) return
        _formTeamIds = data.map(tm => tm.employee_id)
        _renderTeamTags()
      })
    }

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
      _formEntities.push({ id: null, name: '', linkedin_url: '', platforms: [], services: [] })
      _renderFormEntities()
    })

    /* Client Type toggle */
    document.querySelectorAll('input[name="cdf-client-type"]').forEach(radio => {
      radio.addEventListener('change', () => {
        _clientType = radio.value
        const entitiesSection = document.getElementById('cdf-entities-section')
        const personalSection = document.getElementById('cdf-personal-section')
        if (entitiesSection) entitiesSection.style.display = _clientType === 'company' ? '' : 'none'
        if (personalSection) personalSection.style.display = _clientType === 'personal_profile' ? '' : 'none'
      })
    })

    /* Personal profile: LinkedIn URL + Services */
    document.getElementById('cdf-personal-linkedin')?.addEventListener('input', e => {
      _personalLinkedin = e.target.value
    })
    document.getElementById('cdf-personal-services')?.querySelectorAll('.pill-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        const s = btn.dataset.val
        if (_personalServices.includes(s)) {
          _personalServices = _personalServices.filter(x => x !== s)
          btn.classList.remove('pill-opt--active')
        } else {
          _personalServices.push(s)
          btn.classList.add('pill-opt--active')
        }
      })
    })

    /* Save */
    document.getElementById('cdf-save')?.addEventListener('click', _saveClient)
  }

  /* ── Team Picker ────────────────────────────────────────────── */
  function _renderTeamTags() {
    const container = document.getElementById('cdf-team-tags')
    if (!container) return
    if (!_formTeamIds.length) { container.innerHTML = ''; return }
    container.innerHTML = _formTeamIds.map(id => {
      const emp = _employees.find(e => e.id === id)
      if (!emp) return ''
      return `
        <span style="display:inline-flex;align-items:center;gap:5px;background:var(--primary-light,#EEF2FF);color:var(--primary);border:1px solid var(--primary-border,#C7D2FE);border-radius:6px;padding:3px 8px;font-size:12px;font-weight:500;">
          ${Utils.escapeHtml(emp.name)}
          <button type="button" data-remove-team="${id}"
                  style="background:none;border:none;cursor:pointer;color:var(--primary);font-size:14px;line-height:1;padding:0;margin-left:2px;">×</button>
        </span>`
    }).join('')
    container.querySelectorAll('[data-remove-team]').forEach(btn => {
      btn.addEventListener('click', () => {
        _formTeamIds = _formTeamIds.filter(id => id !== btn.dataset.removeTeam)
        _renderTeamTags()
      })
    })
  }

  function _bindTeamPicker() {
    const input    = document.getElementById('cdf-team-search')
    const dropdown = document.getElementById('cdf-team-dropdown')
    if (!input || !dropdown) return

    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase()
      if (!q) { dropdown.style.display = 'none'; return }
      const matches = _employees.filter(e =>
        e.name.toLowerCase().includes(q) && !_formTeamIds.includes(e.id)
      ).slice(0, 8)
      if (!matches.length) { dropdown.style.display = 'none'; return }
      dropdown.innerHTML = matches.map(e => `
        <div class="cd-team-dd-item" data-emp-id="${e.id}" data-emp-name="${Utils.escapeHtml(e.name)}"
             style="padding:9px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border);">
          ${Utils.escapeHtml(e.name)}
          ${e.department ? `<span style="color:var(--text-muted);font-size:11px;margin-left:4px;">${Utils.escapeHtml(e.department)}</span>` : ''}
        </div>`).join('')
      dropdown.style.display = 'block'
      dropdown.querySelectorAll('.cd-team-dd-item').forEach(item => {
        item.addEventListener('mousedown', e => {
          e.preventDefault()   // prevent input blur before click registers
          const id = item.dataset.empId
          if (!_formTeamIds.includes(id)) {
            _formTeamIds.push(id)
            _renderTeamTags()
          }
          input.value = ''
          dropdown.style.display = 'none'
        })
        item.addEventListener('mouseover', () => item.style.background = 'var(--surface-2,#f3f4f6)')
        item.addEventListener('mouseout',  () => item.style.background = '')
      })
    })

    input.addEventListener('blur', () => setTimeout(() => { dropdown.style.display = 'none' }, 150))
    input.addEventListener('focus', () => { if (input.value.trim()) input.dispatchEvent(new Event('input')) })
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
          <label class="cd-entity-sub-label" style="display:block;margin-bottom:6px;">
            LinkedIn Profile URL <span style="font-weight:400;">(for personal-profile entities — used to fetch post engagement via Apify)</span>
          </label>
          <input class="form-input" type="url" placeholder="https://linkedin.com/in/theirprofile"
                 value="${Utils.escapeHtml(e.linkedin_url || '')}" data-eli="${idx}">
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

    /* LinkedIn URL inputs */
    list.querySelectorAll('[data-eli]').forEach(inp =>
      inp.addEventListener('input', () => {
        const idx = parseInt(inp.dataset.eli)
        _formEntities[idx].linkedin_url = inp.value
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

    // Brain Intelligence fields
    const domain   = (document.getElementById('cdf-domain')?.value   || '').trim().toLowerCase() || null
    const contacts = (document.getElementById('cdf-contacts')?.value || '')
      .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)

    errEl.style.display = 'none'

    if (!code || !name) {
      errEl.textContent = 'Project code and client name are required.'
      errEl.style.display = 'block'; return
    }
    if (!/^[A-Z0-9]+$/.test(code)) {
      errEl.textContent = 'Project code must be alphanumeric, all caps, no spaces.'
      errEl.style.display = 'block'; return
    }
    if (_clientType === 'company') {
      for (const e of _formEntities) {
        if (!e.name.trim()) {
          errEl.textContent = 'Every entity must have a name.'
          errEl.style.display = 'block'; return
        }
      }
    }

    saveBtn.disabled    = true
    saveBtn.textContent = 'Saving…'

    try {
      const isEdit   = !!_editingClientId
      // Pre-generate UUID for new clients so files can be uploaded before DB insert
      const clientId = isEdit ? _editingClientId : crypto.randomUUID()

      // Whether this client had zero entities before this save — if so, and
      // an entity gets created below, any historical analytics rows for this
      // client are unambiguously this new entity's (there was nothing else
      // they could belong to). Uploads made before a client had any entity
      // land with entity_id = NULL; once an entity exists, the dashboard's
      // entity filter silently excludes that old data unless it gets linked
      // here, at the moment the ambiguity is resolved — not discovered later
      // as a "why is this client's data missing" bug.
      const hadNoEntitiesBefore = !isEdit
        || ((_clients.find(c => c.id === _editingClientId)?.client_entities || []).length === 0)

      /* Upload any new files first — pass client name directly, no DB lookup */
      let bgUrl = _existingBgUrl
      let saUrl = _existingSaUrl

      if (_files.bg) {
        bgUrl = await _uploadClientDoc(name, status, _files.bg, 'brand_guidelines')
      }
      if (_files.sa && _canCommercial()) {
        saUrl = await _uploadClientDoc(name, status, _files.sa, 'service_agreement')
      }

      /* Build client record — category must match DB check constraint exactly */
      const clientData = {
        project_code:         code,
        client_name:          name,
        category:             cat,   // 'Shark' | 'Dolphin' | 'Turtle' | 'Snail'
        status,
        client_type:          _clientType,   // 'company' | 'personal_profile'
        am_id:                amId,
        overview,
        sow_notes:            sow,
        brand_guidelines_url: bgUrl,
        client_domain:        domain,
        client_contacts:      contacts,
      }

      // A personal-profile client IS the one tracked person — silently keep
      // exactly one entity in sync (never surfaced as a separate "entity"
      // the user manages) by feeding it through the same entity-sync logic
      // below that company clients already use for their (possibly several)
      // entities.
      if (_clientType === 'personal_profile') {
        _formEntities = [{
          id:           _personalEntityId,
          name:         name,
          linkedin_url: _personalLinkedin.trim(),
          platforms:    _formSelPlatforms,
          services:     _personalServices,
        }]
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

        /* Replace client-level platforms (no external FKs — safe to wipe) */
        await Config.supabase.from('client_platforms').delete().eq('client_id', clientId)

        /* Smart entity sync — never bulk-delete entities because social_metrics_daily
           references them via FK. Instead: update existing in place, only delete
           entities the user explicitly removed (and silently skip if FK blocks it). */
        const formEntityIds = new Set(_formEntities.filter(e => e.id).map(e => e.id))

        const { data: dbEnts } = await Config.supabase
          .from('client_entities').select('id').eq('client_id', clientId)

        for (const { id } of (dbEnts || [])) {
          if (!formEntityIds.has(id)) {
            // User removed this entity — clear sub-tables then try to delete
            await Config.supabase.from('entity_platforms').delete().eq('entity_id', id)
            await Config.supabase.from('entity_services').delete().eq('entity_id', id)
            await Config.supabase.from('client_entities').delete().eq('id', id)
            // Ignore any FK error (entity has analytics data) — it simply stays
          }
        }

        // Update names and reset platforms/services on entities the user kept
        for (const entity of _formEntities) {
          if (entity.id) {
            const updatePayload = { entity_name: entity.name.trim(), linkedin_url: entity.linkedin_url?.trim() || null }
            if (_clientType === 'personal_profile') updatePayload.profile_type = 'personal_profile'
            await Config.supabase.from('client_entities')
              .update(updatePayload).eq('id', entity.id)
            await Config.supabase.from('entity_platforms').delete().eq('entity_id', entity.id)
            await Config.supabase.from('entity_services').delete().eq('entity_id', entity.id)
          }
        }
      } else {
        const { error } = await Config.supabase.from('clients')
          .insert({ id: clientId, ...clientData, created_by: _user.id })
        if (error) throw error

        // Create Drive folders immediately — non-blocking, best-effort
        _createClientFolder(name, status).catch(err => console.warn('[Drive] folder pre-creation error:', err))
      }

      /* Client-level platforms */
      if (_formSelPlatforms.length) {
        await Config.supabase.from('client_platforms').insert(
          _formSelPlatforms.map(p => ({ client_id: clientId, platform_name: p }))
        )
      }

      /* Entities → entity_platforms → entity_services */
      for (const entity of _formEntities) {
        // Existing entity: already updated above, just need its ID for sub-tables
        // New entity (id = null): insert it first
        let eid = entity.id
        if (!eid) {
          const insertPayload = { client_id: clientId, entity_name: entity.name.trim(), linkedin_url: entity.linkedin_url?.trim() || null }
          if (_clientType === 'personal_profile') insertPayload.profile_type = 'personal_profile'
          const { data: entRow, error: entErr } = await Config.supabase
            .from('client_entities')
            .insert(insertPayload)
            .select('id').single()
          if (entErr) throw entErr
          eid = entRow.id

          // This is the first entity this client has ever had — link any
          // orphaned (entity_id = NULL) historical rows to it now, before
          // the entity filter has a chance to silently hide them. Routed
          // through an edge function (service role): analytics tables are
          // intentionally not directly writable by authenticated clients.
          if (hadNoEntitiesBefore) {
            const { data: { session } } = await Config.supabase.auth.getSession()
            if (session) {
              await fetch(`${Config.SUPABASE_URL}/functions/v1/backfill-entity-data`, {
                method:  'POST',
                headers: {
                  'Content-Type':  'application/json',
                  'Authorization': `Bearer ${session.access_token}`,
                  'apikey':        Config.SUPABASE_ANON_KEY,
                },
                body: JSON.stringify({ client_id: clientId, entity_id: eid }),
              }).catch(err => console.warn('[ClientDirectory] backfill-entity-data failed:', err))
            }
          }
        }

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

      /* Save Assigned Team (replace all — delete existing then insert new) */
      await API.setClientTeam(clientId, _formTeamIds, _user.id)

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

  /* ── Edit client project details (category + description + Brain) ── */
  function _openClientEditModal(client) {
    const cats = ['Shark', 'Dolphin', 'Turtle', 'Snail']
    const curCat = _cap(client.category || '')
    const curContacts = (client.client_contacts || []).join(', ')

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
        <div class="form-group">
          <label class="form-label">Description</label>
          <span class="form-hint" style="display:block;margin-bottom:6px;">Guidance for employees logging time to this project</span>
          <textarea class="form-input" id="pc-client-desc" rows="4"
            placeholder="e.g. Log hours here for any work related to this client…"
            style="resize:vertical;">${Utils.escapeHtml(client.project_description || '')}</textarea>
        </div>

        <div style="margin:20px 0 16px;padding-top:16px;border-top:1px solid var(--border-light);">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:12px;">
            <span style="font-size:13px;font-weight:700;color:var(--primary);">Brain Intelligence</span>
            <span style="font-size:11px;color:var(--text-muted);font-weight:400;">— Gmail matching for this client</span>
          </div>
          <div class="form-group">
            <label class="form-label">Client Domain</label>
            <span class="form-hint" style="display:block;margin-bottom:6px;">For clients with a custom domain (e.g. <code>clientname.com</code>). Brain will match all emails from this domain.</span>
            <input class="form-input" id="pc-client-domain" type="text"
              placeholder="e.g. clientname.com"
              value="${Utils.escapeHtml(client.client_domain || '')}">
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Contact Emails</label>
            <span class="form-hint" style="display:block;margin-bottom:6px;">For clients on Gmail / Yahoo — add specific email addresses, comma-separated.</span>
            <textarea class="form-input" id="pc-client-contacts" rows="2"
              placeholder="e.g. founder@gmail.com, marketing@yahoo.com"
              style="resize:vertical;">${Utils.escapeHtml(curContacts)}</textarea>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="pc-client-save">Save Changes</button>
      </div>
    `)

    document.getElementById('pc-client-save')?.addEventListener('click', async () => {
      const btn      = document.getElementById('pc-client-save')
      const cat      = document.getElementById('pc-client-cat').value
      const desc     = document.getElementById('pc-client-desc').value.trim()
      const domain   = document.getElementById('pc-client-domain').value.trim().toLowerCase()
      const contacts = document.getElementById('pc-client-contacts').value
        .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)

      btn.disabled = true; btn.textContent = 'Saving…'
      const { error } = await API.updateClientProjectDetails(client.id, {
        project_description: desc,
        category:            cat || null,
        client_domain:       domain,
        client_contacts:     contacts,
      }, _user?.id)
      btn.disabled = false; btn.textContent = 'Save Changes'

      if (error) { Utils.showToast('Failed to save changes', 'error'); return }

      // Update local cache
      const c = _clients.find(x => x.id === client.id)
      if (c) {
        c.project_description = desc || null
        c.category            = cat || null
        c.client_domain       = domain || null
        c.client_contacts     = contacts
      }
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

      const result = isEdit
        ? await API.updateInternalProject(project.id, { name, project_code: code, category: cat, description: desc, entities: ents })
        : await API.createInternalProject({ name, project_code: code, category: cat, description: desc, entities: ents })

      btn.disabled = false; btn.textContent = isEdit ? 'Save Changes' : 'Create Project'

      if (result.error) {
        errEl.textContent = result.error.message || 'Something went wrong. Please try again.'
        errEl.style.display = 'block'
        return
      }

      Utils.closeModal()
      Utils.showToast(
        result.reactivated ? 'Project reactivated successfully' : `Project ${isEdit ? 'updated' : 'created'} successfully`,
        'success'
      )
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
    brand_book:           'Brand Book Upload',
  },
})
