/* ============================================================
   KNOWLEDGE LABS — browse (department directory + resource list)
   Single query does all the access-control work: getKnowledgeResources()
   is filtered by RLS to exactly what this person can see (own department,
   published only, plus any explicit resource-level grants). This page
   just groups whatever comes back by department and renders it —
   there is no separate "which departments can I see" lookup.
   ============================================================ */

const KnowledgeLabsBrowse = (() => {

  let _user            = null
  let _resources        = []
  let _allDepartments   = []
  let _grouped          = []   // [{ department_id, department, resources }]
  let _activeDeptId     = null
  let _activeCategory   = null // null = All
  let _searchQuery      = ''

  /* ── Department icons (matches convention used for module icons elsewhere) ── */
  const DEPT_ICONS = {
    business_development: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
    finance:              `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
    people_culture:       `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    creative:              `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.6-.7 1.6-1.6 0-.4-.2-.8-.4-1.1-.2-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6h1.9c3 0 5.5-2.5 5.5-5.5C22 6 17.5 2 12 2z"/></svg>`,
    creators:              `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`,
    content_strategy:      `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
    operations_growth:     `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
    management:            `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`,
  }
  const DEPT_ICON_DEFAULT = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`
  const ICON_DOC = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`
  const ICON_SEARCH = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`

  function _deptIcon(systemKey) { return DEPT_ICONS[systemKey] || DEPT_ICON_DEFAULT }

  /* ── render ────────────────────────────────────────────────── */
  function render(user) {
    _user = user
    return `<div class="page-inner" id="kl-browse-root"><div class="page-loading">Loading…</div></div>`
  }

  /* ── init ──────────────────────────────────────────────────── */
  async function init(user) {
    _user = user

    const [resResult, deptResult] = await Promise.all([
      API.getKnowledgeResources(),
      API.getDepartments(),
    ])
    if (resResult.error)  { Utils.showToast('Failed to load Knowledge Labs', 'error'); return }
    _resources      = resResult.data || []
    _allDepartments = deptResult.data || []
    _buildGroups()

    window.addEventListener('hashchange', _routeFromHash)
    _routeFromHash()
  }

  function _buildGroups() {
    const byDept = {}
    _resources.forEach(r => {
      if (!byDept[r.department_id]) {
        byDept[r.department_id] = { department_id: r.department_id, department: r.department, resources: [] }
      }
      byDept[r.department_id].resources.push(r)
    })

    // Own department always shows, even with zero resources yet — so it
    // reads as "not filled in yet" rather than the app looking broken.
    if (_user?.department_id && !byDept[_user.department_id]) {
      const dept = _allDepartments.find(d => d.id === _user.department_id)
      byDept[_user.department_id] = {
        department_id: _user.department_id,
        department:    dept ? { name: dept.name, system_key: dept.system_key } : null,
        resources:     [],
      }
    }

    _grouped = Object.values(byDept).sort((a, b) =>
      (a.department?.name || '').localeCompare(b.department?.name || '')
    )

    if (_user?.department_id) {
      _grouped.sort((a, b) => {
        if (a.department_id === _user.department_id) return -1
        if (b.department_id === _user.department_id) return 1
        return 0
      })
    }
  }

  /* ── Hash routing: '' = directory, '/dept/<id>' = detail ─────── */
  function _routeFromHash() {
    const hash  = window.location.hash.slice(1)
    const match = hash.match(/^\/dept\/(.+)$/)
    if (match) {
      _activeDeptId   = match[1]
      _activeCategory = null
      _renderDetail()
    } else {
      _activeDeptId = null
      _renderDirectory()
    }
  }

  /* ── Directory ─────────────────────────────────────────────── */
  function _renderDirectory() {
    const root = document.getElementById('kl-browse-root')
    if (!root) return

    const totalResources = _resources.length

    root.innerHTML = `
      <div style="margin-bottom:22px;">
        <h2 style="margin:0 0 4px;font-size:20px;font-weight:700;">Knowledge Labs</h2>
        <p style="font-size:13px;color:var(--text-muted);margin:0;">
          ${_grouped.length} department${_grouped.length !== 1 ? 's' : ''} · ${totalResources} resource${totalResources !== 1 ? 's' : ''} available to you
        </p>
      </div>

      <div class="search-wrap" style="max-width:420px;margin-bottom:22px;">
        <span class="search-icon">${ICON_SEARCH}</span>
        <input class="form-input" id="kl-search" type="search" placeholder="Search everything you have access to…" value="${Utils.escapeHtml(_searchQuery)}">
      </div>

      <div id="kl-search-results"></div>
      <div id="kl-dept-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;"></div>`

    document.getElementById('kl-search')?.addEventListener('input', Utils.debounce(e => {
      _searchQuery = e.target.value
      _renderSearchOrGrid()
    }, 200))

    _renderSearchOrGrid()
  }

  function _renderSearchOrGrid() {
    const resultsEl = document.getElementById('kl-search-results')
    const gridEl    = document.getElementById('kl-dept-grid')
    if (!resultsEl || !gridEl) return

    const q = _searchQuery.trim().toLowerCase()
    if (!q) {
      resultsEl.innerHTML = ''
      gridEl.style.display = 'grid'
      gridEl.innerHTML = _grouped.length
        ? _grouped.map(_deptCardHTML).join('')
        : `<div class="empty-state-full" style="grid-column:1/-1;"><p>No resources are available to you yet.</p></div>`
      gridEl.querySelectorAll('.kl-dept-card').forEach(card => {
        card.addEventListener('click', () => { window.location.hash = `/dept/${card.dataset.id}` })
      })
      return
    }

    gridEl.style.display = 'none'
    const matches = _resources.filter(r =>
      r.title.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q)
    )

    resultsEl.innerHTML = !matches.length
      ? `<div class="empty-state"><h3>No matches</h3><p>Try a different search term.</p></div>`
      : `<div class="card" style="padding:0;">${matches.map((r, i) => _resourceRowHTML(r, i, matches.length, true)).join('')}</div>`
  }

  function _deptCardHTML(g) {
    const isOwn = g.department_id === _user?.department_id
    const empty = g.resources.length === 0
    return `
      <div class="card kl-dept-card" data-id="${g.department_id}"
           style="cursor:pointer;border:${isOwn ? '2px solid var(--primary)' : '1px solid var(--border)'};">
        <div style="color:var(--primary);margin-bottom:10px;">${_deptIcon(g.department?.system_key)}</div>
        <p style="font-weight:600;font-size:14px;margin:0 0 4px;">${Utils.escapeHtml(g.department?.name || 'Unknown')}</p>
        <p style="font-size:12px;color:var(--text-muted);margin:0;">
          ${empty ? 'Nothing published yet' : `${g.resources.length} resource${g.resources.length !== 1 ? 's' : ''}`}${isOwn ? ' · your department' : ''}
        </p>
      </div>`
  }

  /* ── Department detail ────────────────────────────────────── */
  function _renderDetail() {
    const root  = document.getElementById('kl-browse-root')
    if (!root) return
    const group = _grouped.find(g => g.department_id === _activeDeptId)

    if (!group) {
      root.innerHTML = `<div class="empty-state-full"><p>That department isn't available to you.</p></div>`
      return
    }

    root.innerHTML = `
      <a href="#" style="font-size:13px;color:var(--primary);text-decoration:none;display:inline-block;margin-bottom:14px;">&larr; All departments</a>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
        <div style="color:var(--primary);">${_deptIcon(group.department?.system_key)}</div>
        <h2 style="margin:0;font-size:18px;font-weight:700;">${Utils.escapeHtml(group.department?.name || '')}</h2>
      </div>
      <div class="tabs" id="kl-cat-tabs" style="margin-bottom:16px;">
        <button class="tab-btn tab-btn--active" data-cat="">All</button>
        <button class="tab-btn" data-cat="SOP">SOPs</button>
        <button class="tab-btn" data-cat="Template">Templates</button>
      </div>
      <div id="kl-detail-list"></div>`

    document.querySelectorAll('#kl-cat-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#kl-cat-tabs .tab-btn').forEach(b => b.classList.remove('tab-btn--active'))
        btn.classList.add('tab-btn--active')
        _activeCategory = btn.dataset.cat || null
        _renderDetailList(group)
      })
    })

    _renderDetailList(group)
  }

  function _renderDetailList(group) {
    const el = document.getElementById('kl-detail-list')
    if (!el) return
    const list = group.resources.filter(r => !_activeCategory || r.category === _activeCategory)

    if (!list.length) {
      el.innerHTML = group.resources.length === 0
        ? `<div class="empty-state"><h3>Nothing published yet</h3><p>Check back once this department's SOPs and templates are added.</p></div>`
        : `<div class="empty-state"><h3>Nothing here</h3><p>Try a different category.</p></div>`
      return
    }

    el.innerHTML = `<div class="card" style="padding:0;">${list.map((r, i) => _resourceRowHTML(r, i, list.length, false)).join('')}</div>`
  }

  function _resourceRowHTML(r, i, total, showDept) {
    return `
      <a href="${Utils.escapeHtml(r.doc_url)}" target="_blank" rel="noopener noreferrer"
         style="display:flex;align-items:center;gap:12px;padding:14px 16px;text-decoration:none;color:inherit;${i < total - 1 ? 'border-bottom:0.5px solid var(--border);' : ''}">
        <span style="color:var(--text-muted);flex-shrink:0;">${ICON_DOC}</span>
        <div style="flex:1;min-width:0;">
          <p style="font-weight:500;font-size:14px;margin:0 0 3px;">${Utils.escapeHtml(r.title)}</p>
          ${r.description ? `<p style="font-size:12px;color:var(--text-muted);margin:0;">${Utils.escapeHtml(r.description)}</p>` : ''}
          <p style="font-size:11px;color:var(--text-muted);margin:4px 0 0;">
            ${showDept ? `${Utils.escapeHtml(r.department?.name || '')} · ` : ''}${r.owner?.name ? `Owner: ${Utils.escapeHtml(r.owner.name)}` : ''}
          </p>
        </div>
        <span class="badge ${r.category === 'SOP' ? 'badge--blue' : 'badge--success'}" style="flex-shrink:0;">${Utils.escapeHtml(r.category)}</span>
      </a>`
  }

  return { render, init }
})()
