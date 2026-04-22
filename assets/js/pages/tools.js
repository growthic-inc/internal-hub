/* ============================================================
   TOOLS & SUBSCRIPTIONS — Phase 2
   Registry view + access requests + new tool requests
   ============================================================ */

const Tools = (() => {

  const ACCESS_TYPE_BADGE = {
    shared:   '<span class="badge badge--info">Shared</span>',
    individual: '<span class="badge badge--muted">Individual</span>',
  }

  const STATUS_BADGE = {
    pending:  '<span class="badge badge--warning">Pending</span>',
    approved: '<span class="badge badge--success">Approved</span>',
    rejected: '<span class="badge badge--danger">Rejected</span>',
  }

  const CATEGORIES = ['Design', 'Content', 'Analytics', 'Communication', 'Project Management', 'Development', 'Finance', 'Other']

  let _user      = null
  let _allTools  = []
  let _activeTab = 'registry'

  /* ── render ──────────────────────────────────────────────── */
  function render(user) {
    const isSuperAdmin = user.role === 'super_admin'
    const isHR         = user.role === 'hr'
    const canManage    = isSuperAdmin || isHR

    const tabs = [
      { id: 'registry',   label: 'Tool Registry' },
      { id: 'my-access',  label: 'My Access' },
      { id: 'my-requests', label: 'My Requests' },
    ]
    if (canManage) tabs.push({ id: 'requests', label: 'Requests Inbox' })

    return `
      <div class="page-inner">
        <div class="page-toolbar">
          <div class="tabs" id="tools-tabs">
            ${tabs.map(t => `<button class="tab-btn${t.id === 'registry' ? ' tab-btn--active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
          </div>
          <div id="tools-toolbar-actions"></div>
        </div>
        <div id="tools-content" class="mt-4"></div>
      </div>
    `
  }

  /* ── init ────────────────────────────────────────────────── */
  async function init(user) {
    _user      = user
    _activeTab = 'registry'

    const { data } = await API.getTools()
    _allTools = data || []

    _bindTabs()
    _loadTab('registry')
  }

  function _bindTabs() {
    document.querySelectorAll('#tools-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#tools-tabs .tab-btn').forEach(b => b.classList.remove('tab-btn--active'))
        btn.classList.add('tab-btn--active')
        _activeTab = btn.dataset.tab
        _loadTab(_activeTab)
      })
    })
  }

  function _loadTab(tab) {
    const toolbar = document.getElementById('tools-toolbar-actions')
    if (toolbar) toolbar.innerHTML = ''
    switch (tab) {
      case 'registry':    return _loadRegistry()
      case 'my-access':   return _loadMyAccess()
      case 'my-requests': return _loadMyRequests()
      case 'requests':    return _loadRequestsInbox()
    }
  }

  /* ══════════════════════════════════════════════════════════
     TOOL REGISTRY TAB
  ══════════════════════════════════════════════════════════ */
  async function _loadRegistry() {
    const content = document.getElementById('tools-content')
    const toolbar = document.getElementById('tools-toolbar-actions')
    content.innerHTML = '<p class="loading-text">Loading…</p>'

    const isSuperAdmin = _user.role === 'super_admin'
    const isHR         = _user.role === 'hr'

    if (toolbar) {
      toolbar.innerHTML = `
        <input type="text" id="tools-search" class="search-input" placeholder="Search tools…" />
        ${(isSuperAdmin || isHR) ? '<button class="btn btn--primary" id="btn-add-tool">+ Add Tool</button>' : ''}
        <button class="btn btn--secondary" id="btn-request-tool">Request New Tool</button>
      `
      document.getElementById('tools-search').addEventListener('input', e => _renderRegistry(e.target.value))
      document.getElementById('btn-request-tool').addEventListener('click', _openNewToolRequestModal)
      if (isSuperAdmin || isHR) {
        document.getElementById('btn-add-tool').addEventListener('click', _openAddToolModal)
      }
    }

    const { data, error } = await API.getTools()
    _allTools = data || []

    if (error) { content.innerHTML = '<p class="empty-state">Failed to load tools.</p>'; return }
    _renderRegistry('')
  }

  function _renderRegistry(search) {
    const content = document.getElementById('tools-content')
    const filtered = _allTools.filter(t =>
      !search || t.name.toLowerCase().includes(search.toLowerCase()) || (t.category || '').toLowerCase().includes(search.toLowerCase())
    )

    if (!filtered.length) {
      content.innerHTML = '<p class="empty-state">No tools found.</p>'
      return
    }

    const grouped = {}
    filtered.forEach(t => {
      const cat = t.category || 'Other'
      if (!grouped[cat]) grouped[cat] = []
      grouped[cat].push(t)
    })

    content.innerHTML = Object.entries(grouped).map(([cat, tools]) => `
      <div class="section-card mb-4">
        <div class="section-card-header"><h3>${Utils.escapeHtml(cat)}</h3></div>
        <div class="section-card-body">
          <table class="data-table">
            <thead><tr>
              <th>Tool</th>
              <th>Access Type</th>
              <th>Owner</th>
              <th>Renewal</th>
              <th>Cost / mo</th>
              <th>Action</th>
            </tr></thead>
            <tbody>
              ${tools.map(t => `
                <tr>
                  <td>
                    <strong>${Utils.escapeHtml(t.name)}</strong>
                    ${t.description ? `<div class="text-muted text-sm">${Utils.escapeHtml(Utils.truncate(t.description, 60))}</div>` : ''}
                  </td>
                  <td>${ACCESS_TYPE_BADGE[t.access_type] || t.access_type}</td>
                  <td>${Utils.escapeHtml(t.employees?.name || '—')}</td>
                  <td>${t.renewal_date ? Utils.formatDate(t.renewal_date) : '—'}</td>
                  <td>${t.monthly_cost != null ? Utils.formatCurrency(t.monthly_cost) : '—'}</td>
                  <td>
                    <button class="btn btn--xs btn--secondary" data-request-access="${t.id}" data-tool-name="${Utils.escapeHtml(t.name)}">
                      Request Access
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `).join('')

    document.querySelectorAll('[data-request-access]').forEach(btn => {
      btn.addEventListener('click', () => _openAccessRequestModal(btn.dataset.requestAccess, btn.dataset.toolName))
    })
  }

  /* ══════════════════════════════════════════════════════════
     MY ACCESS TAB
  ══════════════════════════════════════════════════════════ */
  async function _loadMyAccess() {
    const content = document.getElementById('tools-content')
    content.innerHTML = '<p class="loading-text">Loading…</p>'

    const { data, error } = await API.getMyToolAccess(_user.id)
    if (error) { content.innerHTML = '<p class="empty-state">Failed to load.</p>'; return }

    const access = data || []
    if (!access.length) {
      content.innerHTML = '<p class="empty-state">You don\'t have access to any tools yet.</p>'
      return
    }

    content.innerHTML = `
      <div class="section-card">
        <div class="section-card-body">
          <table class="data-table">
            <thead><tr>
              <th>Tool</th>
              <th>Category</th>
              <th>Access Type</th>
              <th>Status</th>
              <th>Granted</th>
            </tr></thead>
            <tbody>
              ${access.map(a => `
                <tr>
                  <td><strong>${Utils.escapeHtml(a.tools?.name || '—')}</strong></td>
                  <td>${Utils.escapeHtml(a.tools?.category || '—')}</td>
                  <td>${ACCESS_TYPE_BADGE[a.tools?.access_type] || '—'}</td>
                  <td><span class="badge badge--success">Active</span></td>
                  <td>${Utils.formatDate(a.granted_at)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `
  }

  /* ══════════════════════════════════════════════════════════
     MY REQUESTS TAB
  ══════════════════════════════════════════════════════════ */
  async function _loadMyRequests() {
    const content = document.getElementById('tools-content')
    content.innerHTML = '<p class="loading-text">Loading…</p>'

    const { data, error } = await API.getMyToolRequests(_user.id)
    if (error) { content.innerHTML = '<p class="empty-state">Failed to load.</p>'; return }

    const requests = data || []
    if (!requests.length) {
      content.innerHTML = '<p class="empty-state">You haven\'t made any tool requests.</p>'
      return
    }

    content.innerHTML = `
      <div class="section-card">
        <div class="section-card-body">
          <table class="data-table">
            <thead><tr>
              <th>Tool</th>
              <th>Request Type</th>
              <th>Reason</th>
              <th>Status</th>
              <th>Submitted</th>
            </tr></thead>
            <tbody>
              ${requests.map(r => `
                <tr>
                  <td>${Utils.escapeHtml(r.tools?.name || r.tool_name_requested || '—')}</td>
                  <td>${r.request_type === 'access' ? 'Access Request' : 'New Tool Request'}</td>
                  <td>${Utils.escapeHtml(Utils.truncate(r.reason || '—', 60))}</td>
                  <td>${STATUS_BADGE[r.status] || r.status}</td>
                  <td>${Utils.formatDate(r.created_at)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `
  }

  /* ══════════════════════════════════════════════════════════
     REQUESTS INBOX (HR / Super Admin)
  ══════════════════════════════════════════════════════════ */
  async function _loadRequestsInbox() {
    const content = document.getElementById('tools-content')
    content.innerHTML = '<p class="loading-text">Loading…</p>'

    const { data, error } = await API.getToolRequests('pending')
    if (error) { content.innerHTML = '<p class="empty-state">Failed to load.</p>'; return }

    const requests = data || []
    if (!requests.length) {
      content.innerHTML = '<p class="empty-state">No pending tool requests.</p>'
      return
    }

    content.innerHTML = `
      <div class="section-card">
        <div class="section-card-header"><h3>Pending Tool Requests</h3></div>
        <div class="section-card-body">
          <table class="data-table">
            <thead><tr>
              <th>Employee</th>
              <th>Tool</th>
              <th>Type</th>
              <th>Reason</th>
              <th>Requested</th>
              <th>Action</th>
            </tr></thead>
            <tbody>
              ${requests.map(r => `
                <tr>
                  <td>
                    <strong>${Utils.escapeHtml(r.employees?.name || '—')}</strong>
                    <div class="text-muted text-sm">${Utils.escapeHtml(r.employees?.department || '')}</div>
                  </td>
                  <td>${Utils.escapeHtml(r.tools?.name || r.tool_name_requested || '—')}</td>
                  <td>${r.request_type === 'access' ? 'Access' : '<span class="badge badge--warning">New Purchase</span>'}</td>
                  <td>${Utils.escapeHtml(Utils.truncate(r.reason || '—', 60))}</td>
                  <td>${Utils.formatDate(r.created_at)}</td>
                  <td>
                    <button class="btn btn--xs btn--success" data-approve-req="${r.id}">Approve</button>
                    <button class="btn btn--xs btn--danger ml-1" data-reject-req="${r.id}">Reject</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `

    document.querySelectorAll('[data-approve-req]').forEach(btn => {
      const req = requests.find(r => r.id === btn.dataset.approveReq)
      btn.addEventListener('click', () => _resolveRequest(req, 'approved'))
    })
    document.querySelectorAll('[data-reject-req]').forEach(btn => {
      const req = requests.find(r => r.id === btn.dataset.rejectReq)
      btn.addEventListener('click', () => _openRejectRequestModal(req))
    })
  }

  async function _resolveRequest(req, decision, comment = null) {
    const updates = { status: decision, reviewed_by: _user.id, reviewed_at: new Date().toISOString() }
    if (comment) updates.rejection_comment = comment

    const { error } = await Config.supabase
      .from('tool_requests')
      .update(updates)
      .eq('id', req.id)

    if (error) { Utils.showToast('Failed: ' + error.message, 'error'); return }

    // If approving an access request, also insert into tool_access
    if (decision === 'approved' && req.request_type === 'access' && req.tool_id) {
      await Config.supabase.from('tool_access').insert({
        tool_id:     req.tool_id,
        employee_id: req.employee_id,
        granted_by:  _user.id,
        granted_at:  new Date().toISOString(),
      })
    }

    Utils.closeModal()
    Utils.showToast(decision === 'approved' ? 'Request approved.' : 'Request rejected.', 'success')
    _loadRequestsInbox()
  }

  function _openRejectRequestModal(req) {
    Utils.openModal(`
      <div class="modal-header"><h3>Reject Request</h3></div>
      <div class="modal-body">
        <p>Rejecting request from <strong>${Utils.escapeHtml(req.employees?.name || '—')}</strong> for <strong>${Utils.escapeHtml(req.tools?.name || req.tool_name_requested || '—')}</strong>.</p>
        <div class="form-group mt-3">
          <label>Reason for rejection</label>
          <textarea id="reject-reason" rows="3" placeholder="Explain why…"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--danger" id="confirm-reject-btn">Reject</button>
      </div>
    `)

    document.getElementById('confirm-reject-btn').addEventListener('click', () => {
      const reason = document.getElementById('reject-reason').value.trim()
      if (!reason) { Utils.showToast('Please provide a reason.', 'error'); return }
      _resolveRequest(req, 'rejected', reason)
    })
  }

  /* ══════════════════════════════════════════════════════════
     MODALS
  ══════════════════════════════════════════════════════════ */

  /* ── Request Access to Existing Tool ────────────────────── */
  function _openAccessRequestModal(toolId, toolName) {
    Utils.openModal(`
      <div class="modal-header"><h3>Request Access — ${Utils.escapeHtml(toolName)}</h3></div>
      <div class="modal-body">
        <div class="form-group">
          <label>Why do you need access?</label>
          <textarea id="access-reason" rows="3" placeholder="Briefly explain your use case…"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="access-submit-btn">Submit Request</button>
      </div>
    `)

    document.getElementById('access-submit-btn').addEventListener('click', async () => {
      const btn    = document.getElementById('access-submit-btn')
      const reason = document.getElementById('access-reason').value.trim()
      if (!reason) { Utils.showToast('Please explain why you need access.', 'error'); return }

      btn.disabled = true
      btn.textContent = 'Submitting…'

      const { error } = await Config.supabase.from('tool_requests').insert({
        employee_id:  _user.id,
        tool_id:      toolId,
        request_type: 'access',
        reason,
        status:       'pending',
      })

      if (error) {
        Utils.showToast('Failed: ' + error.message, 'error')
        btn.disabled = false
        btn.textContent = 'Submit Request'
        return
      }

      Utils.closeModal()
      Utils.showToast('Access request submitted.', 'success')
    })
  }

  /* ── Request New Tool ────────────────────────────────────── */
  function _openNewToolRequestModal() {
    const categoryOptions = CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')

    Utils.openModal(`
      <div class="modal-header"><h3>Request a New Tool</h3></div>
      <div class="modal-body">
        <div class="form-group">
          <label>Tool Name</label>
          <input type="text" id="nt-name" placeholder="e.g. Notion, Loom, Figma…" />
        </div>
        <div class="form-group">
          <label>Category</label>
          <select id="nt-category">${categoryOptions}</select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Estimated Monthly Cost (₹)</label>
            <input type="number" id="nt-cost" min="0" placeholder="0" />
          </div>
        </div>
        <div class="form-group">
          <label>Why does the team need this?</label>
          <textarea id="nt-reason" rows="3" placeholder="Justify the purchase — use case, who'll use it, expected benefit…"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="nt-submit-btn">Submit Request</button>
      </div>
    `)

    document.getElementById('nt-submit-btn').addEventListener('click', async () => {
      const btn      = document.getElementById('nt-submit-btn')
      const name     = document.getElementById('nt-name').value.trim()
      const category = document.getElementById('nt-category').value
      const cost     = parseFloat(document.getElementById('nt-cost').value) || null
      const reason   = document.getElementById('nt-reason').value.trim()

      if (!name)   { Utils.showToast('Enter the tool name.', 'error'); return }
      if (!reason) { Utils.showToast('Explain why the team needs this.', 'error'); return }

      btn.disabled = true
      btn.textContent = 'Submitting…'

      const { error } = await Config.supabase.from('tool_requests').insert({
        employee_id:          _user.id,
        tool_id:              null,
        request_type:         'new_tool',
        tool_name_requested:  name,
        tool_category:        category,
        estimated_cost:       cost,
        reason,
        status:               'pending',
      })

      if (error) {
        Utils.showToast('Failed: ' + error.message, 'error')
        btn.disabled = false
        btn.textContent = 'Submit Request'
        return
      }

      Utils.closeModal()
      Utils.showToast('New tool request submitted for Super Admin review.', 'success')
    })
  }

  /* ── Add Tool to Registry (HR / Super Admin) ─────────────── */
  function _openAddToolModal() {
    const categoryOptions = CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')

    Utils.openModal(`
      <div class="modal-header"><h3>Add Tool to Registry</h3></div>
      <div class="modal-body">
        <div class="form-row">
          <div class="form-group">
            <label>Tool Name</label>
            <input type="text" id="at-name" placeholder="e.g. Canva" />
          </div>
          <div class="form-group">
            <label>Category</label>
            <select id="at-category">${categoryOptions}</select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Access Type</label>
            <select id="at-access-type">
              <option value="shared">Shared (team login)</option>
              <option value="individual">Individual (per-seat)</option>
            </select>
          </div>
          <div class="form-group">
            <label>Monthly Cost (₹)</label>
            <input type="number" id="at-cost" min="0" placeholder="0" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Renewal Date</label>
            <input type="date" id="at-renewal" />
          </div>
        </div>
        <div class="form-group">
          <label>Description (optional)</label>
          <textarea id="at-description" rows="2" placeholder="Brief description of the tool…"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="at-submit-btn">Add Tool</button>
      </div>
    `)

    document.getElementById('at-submit-btn').addEventListener('click', async () => {
      const btn         = document.getElementById('at-submit-btn')
      const name        = document.getElementById('at-name').value.trim()
      const category    = document.getElementById('at-category').value
      const accessType  = document.getElementById('at-access-type').value
      const cost        = parseFloat(document.getElementById('at-cost').value) || null
      const renewal     = document.getElementById('at-renewal').value || null
      const description = document.getElementById('at-description').value.trim() || null

      if (!name) { Utils.showToast('Enter a tool name.', 'error'); return }

      btn.disabled = true
      btn.textContent = 'Adding…'

      const { error } = await Config.supabase.from('tools').insert({
        name,
        category,
        access_type:  accessType,
        monthly_cost: cost,
        renewal_date: renewal,
        description,
        owner_id:     _user.id,
        status:       'active',
      })

      if (error) {
        Utils.showToast('Failed: ' + error.message, 'error')
        btn.disabled = false
        btn.textContent = 'Add Tool'
        return
      }

      Utils.closeModal()
      Utils.showToast('Tool added to registry.', 'success')
      _loadRegistry()
    })
  }

  return { render, init }
})()
