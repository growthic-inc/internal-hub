/* ============================================================
   POLICIES — self-service (Growthic One)
   Read-only browsing/search/view-document only. Creating, editing,
   deleting policies and managing categories now lives in /hrms —
   this page no longer shows those controls to anyone, HR included.
   ============================================================ */

const PoliciesModule = (() => {

  /* ── State ─────────────────────────────────────────────────── */
  let _user            = null
  let _categories      = []
  let _policies        = []
  let _activeCategory  = null   // null = All
  let _searchQuery     = ''

  /* ── Icons ──────────────────────────────────────────────────── */
  const ICON_FILE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`
  const ICON_EXT  = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`

  /* ── render ─────────────────────────────────────────────────── */
  function render(user) {
    _user = user

    return `
      <div class="page-inner">
        <div class="page-header">
          <h2 style="margin:0;font-size:18px;font-weight:700;color:var(--text);">Policies</h2>
        </div>
        <div id="pol-main-layout" class="page-loading">Loading policies…</div>
      </div>`
  }

  /* ── init ───────────────────────────────────────────────────── */
  async function init(user) {
    _user = user
    _activeCategory = null
    _searchQuery    = ''

    await _loadData()
  }

  /* ── Data ───────────────────────────────────────────────────── */
  async function _loadData() {
    const [catResult, polResult] = await Promise.all([
      API.getPolicyCategories(),
      API.getPolicies(),
    ])

    if (catResult.error) { Utils.showToast('Failed to load categories', 'error'); return }
    if (polResult.error) { Utils.showToast('Failed to load policies', 'error'); return }

    _categories = catResult.data || []
    _policies   = (polResult.data || []).filter(p => p.published)

    _renderLayout()
  }

  /* ── Layout ─────────────────────────────────────────────────── */
  function _renderLayout() {
    const el = document.getElementById('pol-main-layout')
    if (!el) return

    el.className = ''
    el.innerHTML = `
      <div class="policies-layout">
        <aside class="policies-sidebar" id="pol-sidebar">
          ${_sidebarHTML()}
        </aside>
        <div class="policies-main" id="pol-content">
          <div style="margin-bottom:16px;">
            <div class="search-wrap">
              <span class="search-icon">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </span>
              <input class="form-input" id="pol-search" type="search" placeholder="Search policies…" value="${Utils.escapeHtml(_searchQuery)}">
            </div>
          </div>
          <div id="pol-list">${_policiesListHTML()}</div>
        </div>
      </div>`

    _bindLayoutEvents()
  }

  function _sidebarHTML() {
    const cats = [{ id: null, name: 'All' }, ..._categories]
    return cats.map(cat => {
      const active = _activeCategory === cat.id ? ' pol-cat-item--active' : ''
      return `<div class="pol-cat-item${active}" data-cat-id="${cat.id === null ? '__all__' : cat.id}">${Utils.escapeHtml(cat.name)}</div>`
    }).join('')
  }

  function _filteredPolicies() {
    const q = _searchQuery.toLowerCase()
    return _policies.filter(p => {
      if (_activeCategory !== null && p.category_id !== _activeCategory) return false
      if (q && !p.title.toLowerCase().includes(q)) return false
      return true
    })
  }

  function _policiesListHTML() {
    const list = _filteredPolicies()
    if (!list.length) {
      return `<div class="pol-empty empty-state"><h3>No policies found</h3><p>Try a different category or search term.</p></div>`
    }
    return list.map(_cardHTML).join('')
  }

  function _cardHTML(p) {
    const isDraft    = !p.published
    const catName    = p.category?.name || '—'
    const updatedAt  = Utils.formatDate(p.updated_at || p.created_at)

    return `
      <div class="pol-card${isDraft ? ' pol-card--draft' : ''}">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
            <span class="pol-card-title">${Utils.escapeHtml(p.title)}</span>
            ${isDraft ? `<span class="pol-draft-badge">DRAFT</span>` : ''}
          </div>
          <div class="pol-card-meta">
            <span>${Utils.escapeHtml(catName)}</span>
            <span style="color:var(--text-muted);">·</span>
            <span>Updated ${updatedAt}</span>
          </div>
        </div>
        <div class="pol-card-actions">
          ${p.file_url ? `
          <a href="${Utils.escapeHtml(p.file_url)}" target="_blank" rel="noopener noreferrer"
             class="btn btn-secondary btn-sm">
            ${ICON_FILE} View Document ${ICON_EXT}
          </a>
          ` : `<span style="font-size:12px;color:var(--text-muted);">No file</span>`}
        </div>
      </div>`
  }

  /* ── Bind Layout Events ─────────────────────────────────────── */
  function _bindLayoutEvents() {
    // Category sidebar
    document.querySelectorAll('.pol-cat-item').forEach(item => {
      item.addEventListener('click', () => {
        const raw = item.dataset.catId
        _activeCategory = raw === '__all__' ? null : raw
        document.querySelectorAll('.pol-cat-item').forEach(i => i.classList.remove('pol-cat-item--active'))
        item.classList.add('pol-cat-item--active')
        _rerenderList()
      })
    })

    // Search
    const searchEl = document.getElementById('pol-search')
    if (searchEl) {
      searchEl.addEventListener('input', Utils.debounce(e => {
        _searchQuery = e.target.value
        _rerenderList()
      }, 200))
    }
  }

  function _rerenderList() {
    const listEl = document.getElementById('pol-list')
    if (!listEl) return
    listEl.innerHTML = _policiesListHTML()
  }

  return { render, init }
})()

ModuleRegistry.register({
  key:       'policies',
  routeId:   'policies',
  label:     'Policies & Documents',
  order:     11,
  icon:      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`,
  getModule: () => PoliciesModule,
  features:  {
    view_policies: 'View Policies',
  },
})
