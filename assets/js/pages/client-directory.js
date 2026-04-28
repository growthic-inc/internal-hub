/* ============================================================
   CLIENT DIRECTORY — Phase 1
   ============================================================ */

const ClientDirectory = (() => {

  let _user    = null
  let _clients = []
  let _filter  = { category: 'all', status: 'active', search: '' }
  let _p       = null  // department permissions

  const CAT_BADGE = {
    Shark:   'badge--primary',
    Dolphin: 'badge--success',
    Turtle:  'badge--warning',
    Snail:   'badge--muted',
  }

  const STATUS_BADGE = {
    active:   'badge--success',
    paused:   'badge--warning',
    inactive: 'badge--danger',
    archived: 'badge--muted',
  }

  function render(user) {
    _user = user
    const canWrite = ['super_admin', 'founders_office', 'bde'].includes(user.role) && App.hasAccess('client_directory', 'create_client', 'can_upload')

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
              <span class="search-icon">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </span>
              <input class="form-input" id="cd-search" type="search" placeholder="Search clients…">
            </div>
            <select class="form-select" id="cd-status" style="width:auto;height:38px;">
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="inactive">Inactive</option>
              <option value="all">All statuses</option>
            </select>
            ${canWrite ? `<button class="btn btn-primary btn-sm" id="cd-add-btn">+ Add Client</button>` : ''}
          </div>
        </div>

        <div id="cd-content" class="page-loading">Loading clients…</div>

      </div>

      <!-- Client Detail Drawer -->
      <div class="drawer-overlay" id="cd-drawer-bg" style="display:none;"></div>
      <div class="drawer" id="cd-drawer" style="display:none;flex-direction:column;">
        <div class="drawer-header">
          <div>
            <div class="drawer-title" id="cd-drawer-name">—</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px;" id="cd-drawer-code">—</div>
          </div>
          <button class="btn-icon-sm" id="cd-drawer-close">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="drawer-body" id="cd-drawer-body"></div>
      </div>

      <!-- Add Client Modal -->
      <div class="modal-overlay" id="cd-modal-bg" style="display:none;">
        <div class="modal">
          <div class="modal-header">
            <h3 class="modal-title">Add New Client</h3>
            <button class="modal-close" id="cd-modal-x">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="modal-body">
            <div id="cd-modal-err" class="alert alert-danger" style="display:none;"></div>
            <div class="form-group">
              <label class="form-label">Project Code <span style="color:var(--danger)">*</span></label>
              <input class="form-input" id="cd-f-code" placeholder="e.g. CRYSTA" maxlength="10">
              <span class="form-hint">Unique short code — all caps, no spaces.</span>
            </div>
            <div class="form-group">
              <label class="form-label">Client Name <span style="color:var(--danger)">*</span></label>
              <input class="form-input" id="cd-f-name" placeholder="Full client or brand name">
            </div>
            <div class="grid-2">
              <div class="form-group">
                <label class="form-label">Category</label>
                <select class="form-select" id="cd-f-cat">
                  <option value="Shark">Shark</option>
                  <option value="Dolphin" selected>Dolphin</option>
                  <option value="Turtle">Turtle</option>
                  <option value="Snail">Snail</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Status</label>
                <select class="form-select" id="cd-f-status">
                  <option value="active" selected>Active</option>
                  <option value="paused">Paused</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" id="cd-modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="cd-modal-save">Add Client</button>
          </div>
        </div>
      </div>
    `
  }

  async function init(user) {
    _user   = user
    _p      = {
      can_create: App.hasAccess('client_directory', 'create_client', 'can_upload'),
      can_edit:   App.hasAccess('client_directory', 'edit_client',   'can_edit'),
    }
    _filter = { category: 'all', status: 'active', search: '' }
    await _loadClients()
    _bindCategoryTabs()
    _bindSearch()
    _bindStatusFilter()
    _bindDrawer()

    const canWriteRole = ['super_admin', 'founders_office', 'bde'].includes(user.role)
    if (canWriteRole && _p.can_create) {  // _p.can_create already includes hasAccess check
      _bindAddModal()
    } else {
      // Remove the button if it was rendered but perms don't allow
      document.getElementById('cd-add-btn')?.remove()
    }
  }

  async function _loadClients() {
    const { data, error } = await API.getClients(true)
    if (error) { Utils.showToast('Failed to load clients', 'error'); return }
    _clients = data || []
    _renderList()
  }

  function _renderList() {
    const q = _filter.search.toLowerCase()
    const list = _clients.filter(c => {
      if (_filter.category !== 'all' && c.category !== _filter.category) return false
      if (_filter.status  !== 'all' && c.status   !== _filter.status)   return false
      if (q && !c.client_name.toLowerCase().includes(q) && !c.project_code.toLowerCase().includes(q)) return false
      return true
    })

    const el = document.getElementById('cd-content')
    if (!el) return

    if (!list.length) {
      el.className = ''
      el.innerHTML = `
        <div class="empty-state">
          <h3>No clients found</h3>
          <p>Try adjusting your filters or search query.</p>
        </div>`
      return
    }

    el.className = 'table-wrap'
    el.innerHTML = `
      <table class="table table--clickable">
        <thead>
          <tr>
            <th>Project Code</th>
            <th>Client Name</th>
            <th>Category</th>
            <th>Platforms</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${list.map(c => `
            <tr data-id="${c.id}">
              <td>
                <code style="font-family:monospace;font-size:12px;background:var(--surface);padding:2px 6px;border-radius:4px;color:var(--primary);font-weight:600;">${c.project_code}</code>
              </td>
              <td><strong>${Utils.escapeHtml(c.client_name)}</strong></td>
              <td><span class="badge ${CAT_BADGE[c.category] || 'badge--muted'}">${c.category || '—'}</span></td>
              <td>
                ${(c.client_platforms || []).map(p =>
                  `<span class="badge badge--outline" style="margin-right:4px;">${p.platform_name}</span>`
                ).join('') || '<span style="color:var(--text-muted)">—</span>'}
              </td>
              <td><span class="badge ${STATUS_BADGE[c.status] || 'badge--muted'}">${c.status}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>`

    el.querySelectorAll('tr[data-id]').forEach(row =>
      row.addEventListener('click', () => _openDrawer(row.dataset.id))
    )
  }

  function _bindCategoryTabs() {
    document.querySelectorAll('[data-cat]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-cat]').forEach(b => b.classList.remove('tab-btn--active'))
        btn.classList.add('tab-btn--active')
        _filter.category = btn.dataset.cat
        _renderList()
      })
    })
  }

  function _bindSearch() {
    const el = document.getElementById('cd-search')
    if (el) el.addEventListener('input', Utils.debounce(e => {
      _filter.search = e.target.value
      _renderList()
    }, 200))
  }

  function _bindStatusFilter() {
    const el = document.getElementById('cd-status')
    if (el) el.addEventListener('change', e => {
      _filter.status = e.target.value
      _renderList()
    })
  }

  async function _openDrawer(clientId) {
    const bg    = document.getElementById('cd-drawer-bg')
    const panel = document.getElementById('cd-drawer')
    const body  = document.getElementById('cd-drawer-body')

    bg.style.display    = 'block'
    panel.style.display = 'flex'
    body.innerHTML      = '<div class="page-loading">Loading…</div>'

    const { data, error } = await API.getClient(clientId)
    if (error || !data) {
      body.innerHTML = '<div class="empty-state"><p>Failed to load client details.</p></div>'
      return
    }

    document.getElementById('cd-drawer-name').textContent = data.client_name
    document.getElementById('cd-drawer-code').textContent = data.project_code

    const entities  = data.client_entities  || []
    const platforms = data.client_platforms || []
    const sow       = data.scope_of_work    || []

    body.innerHTML = `
      <div style="margin-bottom:20px;">
        <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);margin-bottom:10px;">Details</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">Category</div>
            <span class="badge ${CAT_BADGE[data.category] || 'badge--muted'}">${data.category || '—'}</span>
          </div>
          <div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">Status</div>
            <span class="badge ${STATUS_BADGE[data.status] || 'badge--muted'}">${data.status}</span>
          </div>
          <div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">Added</div>
            <div style="font-size:13px;">${Utils.formatDate(data.created_at)}</div>
          </div>
        </div>
      </div>

      <div class="divider"></div>

      <div style="margin-bottom:20px;">
        <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);margin-bottom:10px;">Entities (${entities.length})</p>
        ${entities.length
          ? `<div style="display:flex;flex-wrap:wrap;gap:6px;">${entities.map(e => `<span class="badge badge--outline">${Utils.escapeHtml(e.entity_name)}</span>`).join('')}</div>`
          : `<p style="font-size:13px;color:var(--text-muted);">No entities added.</p>`
        }
      </div>

      <div class="divider"></div>

      <div style="margin-bottom:20px;">
        <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);margin-bottom:10px;">Platforms</p>
        ${platforms.length
          ? `<div style="display:flex;gap:6px;">${platforms.map(p => `<span class="badge badge--blue">${p.platform_name}</span>`).join('')}</div>`
          : `<p style="font-size:13px;color:var(--text-muted);">No platforms added.</p>`
        }
      </div>

      <div class="divider"></div>

      <div>
        <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);margin-bottom:10px;">Scope of Work (${sow.length})</p>
        ${sow.length ? `
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr><th>Platform</th><th>Deliverable</th><th style="text-align:right">Qty/mo</th></tr>
              </thead>
              <tbody>
                ${sow.map(s => `
                  <tr>
                    <td>${s.platform}</td>
                    <td>${Utils.escapeHtml(s.deliverable_type)}</td>
                    <td style="text-align:right;font-weight:600;">${s.agreed_monthly_quantity}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : `<p style="font-size:13px;color:var(--text-muted);">No scope of work defined yet.</p>`}
      </div>
    `
  }

  function _bindDrawer() {
    const _close = () => {
      document.getElementById('cd-drawer-bg').style.display = 'none'
      document.getElementById('cd-drawer').style.display    = 'none'
    }
    document.getElementById('cd-drawer-bg').addEventListener('click', _close)
    document.getElementById('cd-drawer-close').addEventListener('click', _close)
  }

  function _bindAddModal() {
    const bg      = document.getElementById('cd-modal-bg')
    const saveBtn = document.getElementById('cd-modal-save')
    if (!bg) return

    const _open  = () => {
      document.getElementById('cd-modal-err').style.display = 'none'
      bg.style.display = 'flex'
    }
    const _close = () => {
      bg.style.display = 'none'
      document.getElementById('cd-f-code').value = ''
      document.getElementById('cd-f-name').value = ''
    }

    document.getElementById('cd-add-btn').addEventListener('click', _open)
    document.getElementById('cd-modal-x').addEventListener('click', _close)
    document.getElementById('cd-modal-cancel').addEventListener('click', _close)
    bg.addEventListener('click', e => { if (e.target === bg) _close() })

    saveBtn.addEventListener('click', async () => {
      const errEl = document.getElementById('cd-modal-err')
      const code  = document.getElementById('cd-f-code').value.trim().toUpperCase()
      const name  = document.getElementById('cd-f-name').value.trim()
      const cat   = document.getElementById('cd-f-cat').value
      const stat  = document.getElementById('cd-f-status').value

      errEl.style.display = 'none'
      if (!code || !name) {
        errEl.textContent   = 'Project code and client name are required.'
        errEl.style.display = 'block'
        return
      }
      if (!/^[A-Z0-9]+$/.test(code)) {
        errEl.textContent   = 'Project code must be alphanumeric, all caps, no spaces.'
        errEl.style.display = 'block'
        return
      }

      saveBtn.disabled    = true
      saveBtn.textContent = 'Saving…'

      const { error } = await Config.supabase.from('clients').insert({
        project_code: code,
        client_name:  name,
        category:     cat,
        status:       stat,
        created_by:   _user.id,
      })

      saveBtn.disabled    = false
      saveBtn.textContent = 'Add Client'

      if (error) {
        errEl.textContent   = error.message.includes('unique')
          ? `Project code "${code}" is already in use.`
          : error.message
        errEl.style.display = 'block'
      } else {
        _close()
        Utils.showToast('Client added successfully', 'success')
        await _loadClients()
      }
    })
  }

  return { render, init }
})()
