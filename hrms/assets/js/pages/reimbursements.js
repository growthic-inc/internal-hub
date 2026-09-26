/* ============================================================
   REIMBURSEMENTS — HRMS admin console
   Relocated from /home — HR review/approve/reject, Super Admin's
   HR-requests view, the full org-wide request log, and Finance/
   Super Admin's "mark as paid" step. Self-service (raising a
   pre-approval or claim) stays in Growthic One.
   ============================================================ */

const Reimbursements = (() => {

  const STATUS_BADGE = {
    pending:  '<span class="badge badge--warning">Pending</span>',
    approved: '<span class="badge badge--success">Approved</span>',
    rejected: '<span class="badge badge--danger">Rejected</span>',
    paid:     '<span class="badge badge--info">Paid</span>',
  }

  let _user         = null
  let _activeTab    = null
  let _p            = null
  let _expenseTypes = []   // all types (active + inactive) — settings + label lookups need both

  // Resolves a stored expense_type value to its current label, falling back
  // to the legacy static map for a type that's since been deleted.
  function _expenseLabel(value) {
    return _expenseTypes.find(e => e.value === value)?.name || Utils.getExpenseLabel(value)
  }

  /* ── render ──────────────────────────────────────────────── */
  function render(user) {
    const isSuperAdmin = user.role === 'super_admin'
    const isFinance    = Utils.getDeptSystemKey(user.department) === 'finance' || user.role === 'finance'

    const canApprove     = HRMSApp.hasAccess('reimbursements', 'approve_requests', 'can_manage')
    const canPayment     = (isFinance || isSuperAdmin) && HRMSApp.hasAccess('reimbursements', 'process_payment', 'can_manage')
    const canManageTypes = HRMSApp.hasAccess('reimbursements', 'manage_expense_types', 'can_manage')

    const tabs = []
    if (canApprove)     tabs.push({ id: 'inbox',        label: 'Inbox' })
    if (isSuperAdmin)   tabs.push({ id: 'hr-requests',  label: 'HR Requests' })  // SA convenience view for HR-submitted requests
    if (canApprove)     tabs.push({ id: 'all-requests', label: 'All Requests' })
    if (canPayment)     tabs.push({ id: 'payment',      label: 'For Payment' })
    if (canManageTypes) tabs.push({ id: 'settings',     label: 'Settings' })

    _activeTab = tabs[0]?.id || null

    if (!tabs.length) {
      return `<div class="page-inner"><p class="empty-state">You don't have access to any reimbursement admin views.</p></div>`
    }

    return `
      <div class="page-inner">
        <div class="page-toolbar">
          <div class="tabs" id="reimb-tabs">
            ${tabs.map(t => `
              <button class="tab-btn${t.id === _activeTab ? ' tab-btn--active' : ''}" data-tab="${t.id}">
                ${t.label}
              </button>`).join('')}
          </div>
          <div id="reimb-toolbar-actions"></div>
        </div>
        <div id="reimb-content" class="mt-4"></div>
      </div>
    `
  }

  /* ── init ────────────────────────────────────────────────── */
  async function init(user) {
    _user = user
    const { data } = await API.getExpenseTypes()
    _expenseTypes = data || []
    _bindTabs()
    if (_activeTab) _loadTab(_activeTab)
  }

  function _bindTabs() {
    document.querySelectorAll('#reimb-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#reimb-tabs .tab-btn').forEach(b => b.classList.remove('tab-btn--active'))
        btn.classList.add('tab-btn--active')
        _activeTab = btn.dataset.tab
        _loadTab(_activeTab)
      })
    })
  }

  function _loadTab(tab) {
    const toolbar = document.getElementById('reimb-toolbar-actions')
    if (toolbar) toolbar.innerHTML = ''
    switch (tab) {
      case 'inbox':        return _loadInboxTab()
      case 'hr-requests':  return _loadHRRequestsTab()
      case 'all-requests': return _loadAllRequestsTab()
      case 'payment':      return _loadPaymentTab()
      case 'settings':     return _loadSettingsTab()
    }
  }

  /* ── Shared table renderers ──────────────────────────────── */
  function _renderPreApprovalTable(rows, showEmployee, showActions = false, canApproveRow = null) {
    if (!rows.length) return '<p class="empty-state">No pre-approval requests yet.</p>'
    return `
      <table class="data-table">
        <thead><tr>
          ${showEmployee  ? '<th>Employee</th>' : ''}
          <th>Expense Type</th>
          <th>Client</th>
          <th>Est. Amount</th>
          <th>Expected Date</th>
          <th>Status</th>
          <th>Reason</th>
          ${showActions ? '<th>Action</th>' : ''}
        </tr></thead>
        <tbody>
          ${rows.map(r => {
            const canAct = showActions && (canApproveRow === null || canApproveRow(r))
            return `
            <tr>
              ${showEmployee  ? `<td>${Utils.escapeHtml(r.submitter?.name || '—')}</td>` : ''}
              <td>${Utils.escapeHtml(_expenseLabel(r.expense_type))}</td>
              <td>${Utils.escapeHtml(r.clients?.client_name || '—')}</td>
              <td>${Utils.formatCurrency(r.estimated_amount)}</td>
              <td>${Utils.formatDate(r.expected_date)}</td>
              <td>${STATUS_BADGE[r.status] || r.status}</td>
              <td class="text-muted" style="white-space:pre-wrap;word-break:break-word;max-width:220px;">${Utils.escapeHtml(r.reason || '—')}</td>
              ${showActions
                ? canAct
                  ? `<td><button class="btn btn--xs btn--primary" data-approve="${r.id}">Review</button></td>`
                  : `<td><span class="badge badge--muted" style="font-size:11px;">Pending SA</span></td>`
                : ''}
            </tr>`
          }).join('')}
        </tbody>
      </table>
    `
  }

  function _renderClaimTable(rows, showEmployee, showApproveBtn = false, showPayBtn = false, canApproveRow = null) {
    if (!rows.length) return '<p class="empty-state">No claims found.</p>'

    return `
      <table class="data-table">
        <thead><tr>
          ${showEmployee    ? '<th>Employee</th>' : ''}
          <th>Expense Type</th>
          <th>Client</th>
          <th>Amount</th>
          <th>Date</th>
          ${showApproveBtn  ? '<th>Pre-Approval</th>' : ''}
          <th>Status</th>
          <th>Receipt</th>
          ${showApproveBtn || showPayBtn ? '<th>Action</th>' : ''}
        </tr></thead>
        <tbody>
          ${rows.map(r => {
            const employeeName = r.submitter?.name || '—'

            let amtCell
            if (showPayBtn && r.hr_approved_amount) {
              amtCell = `<div style="font-weight:600;">${Utils.formatCurrency(r.hr_approved_amount)}</div>
                ${r.hr_approved_amount != r.amount
                  ? `<div class="text-sm text-muted" style="margin-top:2px;">Submitted: ${Utils.formatCurrency(r.amount)}</div>`
                  : ''}
                ${r.hr_remarks
                  ? `<div class="text-sm text-muted" style="margin-top:3px;font-style:italic;white-space:pre-wrap;word-break:break-word;">💬 "${Utils.escapeHtml(r.hr_remarks)}"</div>`
                  : ''}`
            } else {
              amtCell = Utils.formatCurrency(r.amount)
            }

            return `
              <tr>
                ${showEmployee ? `<td>${Utils.escapeHtml(employeeName)}</td>` : ''}
                <td>${Utils.escapeHtml(_expenseLabel(r.expense_type))}</td>
                <td>${Utils.escapeHtml(r.clients?.client_name || '—')}</td>
                <td>${amtCell}</td>
                <td style="white-space:nowrap;">${Utils.formatDate(r.expense_date)}</td>
                ${showApproveBtn ? `
                  <td>
                    ${r.pre_approval_id
                      ? '<span class="badge badge--info" title="Filed against a pre-approval">Linked</span>'
                      : '<span class="text-muted text-sm">Direct</span>'}
                  </td>` : ''}
                <td>${STATUS_BADGE[r.status] || r.status}</td>
                <td>${r.drive_receipt_url
                  ? `<a href="${Utils.escapeHtml(r.drive_receipt_url)}" target="_blank" class="link">View</a>`
                  : '—'}</td>
                ${showApproveBtn
                  ? (canApproveRow === null || canApproveRow(r))
                    ? `<td><button class="btn btn--xs btn--primary" data-approve="${r.id}">Review</button></td>`
                    : `<td><span class="badge badge--muted" style="font-size:11px;">Pending SA</span></td>`
                  : ''}
                ${showPayBtn
                  ? `<td>${r.status === 'approved'
                      ? `<button class="btn btn--xs btn--success" data-pay="${r.id}"
                            data-name="${Utils.escapeHtml(employeeName)}"
                            data-amount="${r.hr_approved_amount || r.amount}"
                            data-employee="${r.employee_id}">Mark Paid</button>`
                      : '<span class="text-muted text-sm">—</span>'
                    }</td>`
                  : ''}
              </tr>`
          }).join('')}
        </tbody>
      </table>
    `
  }

  /* ══════════════════════════════════════════════════════════
     INBOX TAB (HR / Super Admin — non-HR employees)
  ══════════════════════════════════════════════════════════ */
  async function _loadInboxTab() {
    const content = document.getElementById('reimb-content')
    content.innerHTML = '<p class="loading-text">Loading…</p>'

    const [paRes, clRes] = await Promise.all([
      API.getReimbursementInbox('pre_approval'),
      API.getReimbursementInbox('claim'),
    ])

    // All pending requests — no department filter.
    // HR has full approval authority same as Super Admin (except payment processing).
    const preApprovals = paRes.data || []
    const claims       = clRes.data || []

    content.innerHTML = `
      <div class="section-card mb-4">
        <div class="section-card-header"><h3>Pending Pre-Approval Requests</h3></div>
        <div class="section-card-body" id="inbox-preapprovals">
          ${_renderPreApprovalTable(preApprovals, true, true)}
        </div>
      </div>
      <div class="section-card">
        <div class="section-card-header"><h3>Pending Expense Claims</h3></div>
        <div class="section-card-body" id="inbox-claims">
          ${_renderClaimTable(claims, true, true, false)}
        </div>
      </div>
    `

    _bindInboxApproveButtons(preApprovals, claims)
  }

  function _bindInboxApproveButtons(preApprovals, claims) {
    document.querySelectorAll('[data-approve]').forEach(btn => {
      const id     = btn.dataset.approve
      const record = [...preApprovals, ...claims].find(r => r.id === id)
      if (record) btn.addEventListener('click', () => _openApproveModal(record))
    })
  }

  /* ══════════════════════════════════════════════════════════
     HR REQUESTS TAB (Super Admin only)
  ══════════════════════════════════════════════════════════ */
  async function _loadHRRequestsTab() {
    const content = document.getElementById('reimb-content')
    content.innerHTML = '<p class="loading-text">Loading…</p>'

    const [paRes, clRes] = await Promise.all([
      API.getReimbursementInbox('pre_approval'),
      API.getReimbursementInbox('claim'),
    ])

    const hrOnly       = r => Utils.getDeptSystemKey(r.submitter?.department) === 'people_culture'
    const preApprovals = (paRes.data || []).filter(hrOnly)
    const claims       = (clRes.data || []).filter(hrOnly)

    content.innerHTML = `
      <div class="section-card mb-4">
        <div class="section-card-header"><h3>HR Pre-Approval Requests</h3></div>
        <div class="section-card-body">${_renderPreApprovalTable(preApprovals, true, true)}</div>
      </div>
      <div class="section-card">
        <div class="section-card-header"><h3>HR Expense Claims</h3></div>
        <div class="section-card-body">${_renderClaimTable(claims, true, true, false)}</div>
      </div>
    `

    _bindInboxApproveButtons(preApprovals, claims)
  }

  /* ══════════════════════════════════════════════════════════
     ALL REQUESTS TAB (HR / Super Admin — full org view)
  ══════════════════════════════════════════════════════════ */
  async function _loadAllRequestsTab() {
    const content = document.getElementById('reimb-content')
    content.innerHTML = '<p class="loading-text">Loading…</p>'

    const { data, error } = await API.getAllReimbursementsAdmin()
    if (error) { content.innerHTML = '<p class="empty-state">Failed to load requests.</p>'; return }

    const all = data || []
    let _statusFilter = 'all'

    const STATUS_FILTERS = [
      { key: 'all',      label: 'All' },
      { key: 'pending',  label: 'Pending' },
      { key: 'approved', label: 'Approved' },
      { key: 'rejected', label: 'Rejected' },
      { key: 'paid',     label: 'Paid' },
    ]

    function _render() {
      const filtered     = _statusFilter === 'all' ? all : all.filter(r => r.status === _statusFilter)
      const preApprovals = filtered.filter(r => r.type === 'pre_approval')
      const claims       = filtered.filter(r => r.type === 'claim')

      const totalPending  = all.filter(r => r.status === 'pending').length
      const totalApproved = all.filter(r => r.status === 'approved').length
      const totalPaid     = all.filter(r => r.status === 'paid').length
      const totalAmount   = all.filter(r => ['approved','paid'].includes(r.status))
                               .reduce((s, r) => s + parseFloat(r.hr_approved_amount || r.amount || 0), 0)

      content.innerHTML = `
        <div class="grid-4 mb-4">
          <div class="stat-card">
            <div class="stat-label">Total Requests</div>
            <div class="stat-value">${all.length}</div>
            <div class="stat-delta">${preApprovals.length + claims.length === all.length ? `${all.filter(r=>r.type==='pre_approval').length} pre-approvals · ${all.filter(r=>r.type==='claim').length} claims` : ''}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Pending Review</div>
            <div class="stat-value stat-value--warning">${totalPending}</div>
            <div class="stat-delta">awaiting action</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Approved</div>
            <div class="stat-value stat-value--success">${totalApproved}</div>
            <div class="stat-delta">${totalPaid} paid</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Total Approved Amount</div>
            <div class="stat-value">${Utils.formatCurrency(totalAmount)}</div>
            <div class="stat-delta">approved + paid</div>
          </div>
        </div>

        <div class="section-card">
          <div class="section-card-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
            <h3>All Reimbursement Requests</h3>
            <div style="display:flex;gap:6px;flex-wrap:wrap;" id="ar-filter-btns">
              ${STATUS_FILTERS.map(f => `
                <button class="btn btn--xs ${_statusFilter === f.key ? 'btn--primary' : 'btn--ghost'}" data-filter="${f.key}">
                  ${f.label}${f.key !== 'all' ? ` <span style="opacity:.7;">(${all.filter(r => r.status === f.key).length})</span>` : ` <span style="opacity:.7;">(${all.length})</span>`}
                </button>
              `).join('')}
            </div>
          </div>
          <div class="section-card-body">
            ${preApprovals.length ? `
              <p style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Stage 1 — Pre-Approval Requests</p>
              ${_renderPreApprovalTable(preApprovals, true, false)}
              <div style="margin-top:20px;"></div>
            ` : ''}
            <p style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Stage 2 — Expense Claims</p>
            ${_renderClaimTable(claims, true, false, false)}
          </div>
        </div>
      `

      content.querySelectorAll('[data-filter]').forEach(btn => {
        btn.addEventListener('click', () => {
          _statusFilter = btn.dataset.filter
          _render()
        })
      })
    }

    _render()
  }

  /* ══════════════════════════════════════════════════════════
     FOR PAYMENT TAB (Finance / Super Admin)
  ══════════════════════════════════════════════════════════ */
  async function _loadPaymentTab() {
    const content = document.getElementById('reimb-content')
    content.innerHTML = '<p class="loading-text">Loading…</p>'

    const { data, error } = await API.getApprovedClaims()
    if (error) { content.innerHTML = '<p class="empty-state">Failed to load.</p>'; return }

    const all = data || []

    const expenseTypeOptions = [['', 'All Types']].concat(
      _expenseTypes.map(e => [e.value, e.name])
    )

    content.innerHTML = `
      <div class="section-card">
        <div class="section-card-header"><h3>Approved Claims — Awaiting Payment</h3></div>
        <div class="section-card-body" style="padding-top:0;">
          <div class="db-filter-bar" style="margin:14px 0 8px;">
            <div class="db-filter-group" style="min-width:150px;">
              <span class="db-filter-label">Paid Between</span>
              <select class="db-filter-select" id="pay-range-select">
                <option value="7">Last Week</option>
                <option value="30" selected>Last 1 Month</option>
                <option value="90">Last 3 Months</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>
            <div id="pay-custom-dates" style="display:none;flex-direction:column;gap:4px;">
              <span class="db-filter-label">From → To</span>
              <div style="display:flex;gap:6px;align-items:center;">
                <input type="date" id="pay-export-from" class="db-filter-select" style="min-width:130px;">
                <input type="date" id="pay-export-to"   class="db-filter-select" style="min-width:130px;">
              </div>
            </div>
            <div class="db-filter-actions">
              <button class="btn btn--sm btn--ghost" id="pay-export-btn">Export</button>
            </div>
          </div>
          <div class="db-filter-bar" style="margin:0 0 14px;flex-wrap:wrap;">
            <div class="db-filter-group">
              <span class="db-filter-label">Employee</span>
              <input type="text" id="pay-f-employee" class="db-filter-select" placeholder="Search…" style="min-width:140px;">
            </div>
            <div class="db-filter-group">
              <span class="db-filter-label">Expense Type</span>
              <select id="pay-f-type" class="db-filter-select" style="min-width:160px;">
                ${expenseTypeOptions.map(([v, l]) => `<option value="${v}">${Utils.escapeHtml(l)}</option>`).join('')}
              </select>
            </div>
            <div class="db-filter-group">
              <span class="db-filter-label">Client</span>
              <input type="text" id="pay-f-client" class="db-filter-select" placeholder="Search…" style="min-width:130px;">
            </div>
            <div class="db-filter-group">
              <span class="db-filter-label">Status</span>
              <select id="pay-f-status" class="db-filter-select">
                <option value="">All</option>
                <option value="approved">Approved</option>
                <option value="paid">Paid</option>
              </select>
            </div>
          </div>
          <div id="pay-table-wrap">${_renderClaimTable(all, true, false, true)}</div>
        </div>
      </div>
    `

    function _bindPayButtons() {
      document.querySelectorAll('[data-pay]').forEach(btn => {
        btn.addEventListener('click', () => _openMarkPaidModal(btn.dataset.pay, btn.dataset.name, btn.dataset.amount, btn.dataset.employee))
      })
    }
    _bindPayButtons()

    const fEmployee = document.getElementById('pay-f-employee')
    const fType     = document.getElementById('pay-f-type')
    const fClient   = document.getElementById('pay-f-client')
    const fStatus   = document.getElementById('pay-f-status')
    const tableWrap = document.getElementById('pay-table-wrap')

    function _applyColFilters() {
      const emp    = fEmployee.value.trim().toLowerCase()
      const type   = fType.value
      const client = fClient.value.trim().toLowerCase()
      const status = fStatus.value

      const filtered = all.filter(r => {
        if (emp    && !(r.submitter?.name || '').toLowerCase().includes(emp))          return false
        if (type   && r.expense_type !== type)                                         return false
        if (client && !(r.clients?.client_name || '').toLowerCase().includes(client)) return false
        if (status && r.status !== status)                                             return false
        return true
      })

      tableWrap.innerHTML = _renderClaimTable(filtered, true, false, true)
      _bindPayButtons()
    }

    fEmployee.addEventListener('input',  _applyColFilters)
    fType.addEventListener('change',     _applyColFilters)
    fClient.addEventListener('input',    _applyColFilters)
    fStatus.addEventListener('change',   _applyColFilters)

    // Export is a pure client-side filter over the claims already loaded
    // above — no extra query. This is a reconciliation export (does what
    // left the account match our records?), so it's scoped to 'paid'
    // only, filtered by paid_at (when the money actually moved) — not
    // expense_date, which would miss a claim paid in a later period than
    // the expense itself was incurred in.
    const rangeSelect = document.getElementById('pay-range-select')
    const customDates = document.getElementById('pay-custom-dates')
    const fromInput    = document.getElementById('pay-export-from')
    const toInput      = document.getElementById('pay-export-to')
    const exportBtn    = document.getElementById('pay-export-btn')

    const _updateExportBtn = () => {
      exportBtn.disabled = rangeSelect.value === 'custom' && !(fromInput.value && toInput.value)
    }
    rangeSelect.addEventListener('change', () => {
      customDates.style.display = rangeSelect.value === 'custom' ? 'flex' : 'none'
      _updateExportBtn()
    })
    fromInput.addEventListener('change', _updateExportBtn)
    toInput.addEventListener('change', _updateExportBtn)

    function _resolveRange() {
      if (rangeSelect.value === 'custom') return { from: fromInput.value, to: toInput.value }
      const to = new Date(), from = new Date()
      from.setDate(to.getDate() - parseInt(rangeSelect.value, 10))
      const fmt = d => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
      return { from: fmt(from), to: fmt(to) }
    }

    exportBtn.addEventListener('click', () => {
      const { from, to } = _resolveRange()
      if (!from || !to) return

      const rows = all.filter(r => {
        if (r.status !== 'paid' || !r.paid_at) return false
        const paidDate = r.paid_at.slice(0, 10) // paid_at is a timestamp; compare just the date part
        return paidDate >= from && paidDate <= to
      })
      if (!rows.length) { Utils.showToast('No paid claims in that date range.', 'info'); return }

      const headers = ['Employee', 'Department', 'Client', 'Project Code', 'Expense Type', 'Amount', 'Expense Date', 'Approved By', 'Paid Date', 'Paid By']
      const csvRows = rows.map(r => [
        r.submitter?.name || '',
        Utils.getDeptLabel(r.submitter?.department) || '',
        r.clients?.client_name || '',
        r.clients?.project_code || '',
        _expenseLabel(r.expense_type),
        r.hr_approved_amount || r.amount || 0,
        r.expense_date || '',
        r.approver?.name || '',
        r.paid_at ? r.paid_at.slice(0, 10) : '',
        r.payer?.name || '',
      ])
      Utils.downloadCSV(`reimbursement-paid-claims-${from}-to-${to}.csv`, headers, csvRows)
    })
  }

  /* ══════════════════════════════════════════════════════════
     SETTINGS — Expense Types
  ══════════════════════════════════════════════════════════ */
  async function _loadSettingsTab() {
    const content = document.getElementById('reimb-content')
    content.innerHTML = '<p class="loading-text">Loading…</p>'

    const { data } = await API.getExpenseTypes()
    _expenseTypes = data || []

    content.innerHTML = `
      <div class="section-card mb-4">
        <div class="section-card-header">
          <h3>Expense Types</h3>
          <button class="btn btn--primary btn--sm" id="et-add-btn">+ Add Type</button>
        </div>
        <div class="section-card-body" style="padding:0;" id="et-body">
          ${_renderExpenseTypesTable(_expenseTypes)}
        </div>
        <div id="et-add-form" style="display:none;padding:14px 16px;border-top:1px solid var(--border);">
          <div style="display:flex;gap:10px;align-items:flex-end;">
            <div class="form-group" style="flex:1;margin-bottom:0;">
              <label class="form-label">Name</label>
              <input class="form-input" type="text" id="et-new-name" placeholder="e.g. Team Lunch" />
            </div>
            <button class="btn btn--primary btn--sm" id="et-save-btn">Save</button>
            <button class="btn btn--ghost btn--sm" id="et-cancel-btn">Cancel</button>
          </div>
        </div>
      </div>
    `
    _bindSettingsActions()
  }

  function _renderExpenseTypesTable(types) {
    if (!types.length) return '<p class="empty-state">No expense types configured.</p>'
    return `
      <table class="data-table">
        <thead><tr><th>Name</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${types.map(t => {
            const locked = t.value === 'other'
            return `
            <tr class="et-row" data-type-id="${t.id}">
              <td id="et-name-${t.id}">${Utils.escapeHtml(t.name)}</td>
              <td>
                <span class="badge ${t.is_active ? 'badge--success' : 'badge--muted'}">
                  ${t.is_active ? 'Active' : 'Inactive'}
                </span>
              </td>
              <td style="white-space:nowrap;">
                ${locked
                  ? '<span class="text-sm text-muted">Required — can\'t be edited</span>'
                  : `
                    <button class="btn btn--xs btn--ghost" data-edit-type="${t.id}" data-name="${Utils.escapeHtml(t.name)}">Edit</button>
                    <button class="btn btn--xs btn--ghost" data-toggle-type="${t.id}" data-active="${t.is_active}"
                      style="margin-left:4px;">${t.is_active ? 'Deactivate' : 'Activate'}</button>
                    <button class="btn btn--xs btn--ghost" data-delete-type="${t.id}"
                      style="margin-left:4px;color:var(--danger);">Delete</button>
                  `}
              </td>
            </tr>
          `}).join('')}
        </tbody>
      </table>
    `
  }

  // "Team Lunch" → "team_lunch" — the stable slug stored on reimbursements.expense_type
  function _slugifyExpenseType(name) {
    return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  }

  function _bindSettingsActions() {
    document.getElementById('et-add-btn')?.addEventListener('click', () => {
      document.getElementById('et-add-form').style.display = 'block'
      document.getElementById('et-new-name').focus()
    })
    document.getElementById('et-cancel-btn')?.addEventListener('click', () => {
      document.getElementById('et-add-form').style.display = 'none'
      document.getElementById('et-new-name').value = ''
    })
    document.getElementById('et-save-btn')?.addEventListener('click', async () => {
      const name = document.getElementById('et-new-name').value.trim()
      if (!name) { Utils.showToast('Please enter a name.', 'error'); return }
      const value = _slugifyExpenseType(name)
      if (!value || value === 'other') { Utils.showToast('Please choose a different name.', 'error'); return }

      const btn = document.getElementById('et-save-btn')
      btn.disabled = true
      const { error } = await API.createExpenseType({ name, value, is_active: true, created_by: _user.id })
      btn.disabled = false
      if (error) {
        Utils.showToast(error.code === '23505' ? 'An expense type with a similar name already exists.' : 'Failed: ' + error.message, 'error')
        return
      }
      Utils.showToast('Expense type added.', 'success')
      _loadSettingsTab()
    })

    document.querySelectorAll('[data-edit-type]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id      = btn.dataset.editType
        const current = btn.dataset.name
        const nameEl  = document.getElementById(`et-name-${id}`)
        if (!nameEl) return
        nameEl.innerHTML = `
          <input class="form-input" type="text" id="et-inline-name-${id}"
            value="${Utils.escapeHtml(current)}" style="max-width:200px;padding:4px 8px;font-size:13px;" />
          <button class="btn btn--xs btn--primary" style="margin-left:6px;" data-save-type-inline="${id}">Save</button>
          <button class="btn btn--xs btn--ghost" style="margin-left:4px;" data-cancel-type-inline="${id}">Cancel</button>
        `
        document.querySelector(`[data-save-type-inline="${id}"]`)?.addEventListener('click', async () => {
          const newName = document.getElementById(`et-inline-name-${id}`)?.value.trim()
          if (!newName) { Utils.showToast('Name cannot be empty.', 'error'); return }
          const { error } = await API.updateExpenseType(id, { name: newName })
          if (error) { Utils.showToast('Failed: ' + error.message, 'error'); return }
          Utils.showToast('Updated.', 'success')
          _loadSettingsTab()
        })
        document.querySelector(`[data-cancel-type-inline="${id}"]`)?.addEventListener('click', () => {
          _loadSettingsTab()
        })
      })
    })

    document.querySelectorAll('[data-toggle-type]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id       = btn.dataset.toggleType
        const isActive = btn.dataset.active === 'true'
        const { error } = await API.updateExpenseType(id, { is_active: !isActive })
        if (error) { Utils.showToast('Failed: ' + error.message, 'error'); return }
        Utils.showToast(`Expense type ${!isActive ? 'activated' : 'deactivated'}.`, 'success')
        _loadSettingsTab()
      })
    })

    document.querySelectorAll('[data-delete-type]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this expense type? This cannot be undone.')) return
        const { error } = await API.deleteExpenseType(btn.dataset.deleteType)
        if (error) {
          Utils.showToast(
            error.code === '23503'
              ? "This expense type is in use by existing claims and can't be deleted — deactivate it instead."
              : 'Failed: ' + error.message,
            'error'
          )
          return
        }
        Utils.showToast('Expense type deleted.', 'success')
        _loadSettingsTab()
      })
    })
  }

  /* ══════════════════════════════════════════════════════════
     APPROVE / REJECT MODAL
  ══════════════════════════════════════════════════════════ */
  function _openApproveModal(record) {
    const isClaim     = record.type === 'claim'
    const displayAmt  = isClaim ? record.amount : record.estimated_amount

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Review ${isClaim ? 'Expense Claim' : 'Pre-Approval Request'}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="info-grid mb-3">
          <div><span class="info-label">Employee</span><span class="info-value">${Utils.escapeHtml(record.submitter?.name || '—')}</span></div>
          <div><span class="info-label">Expense Type</span><span class="info-value">${Utils.escapeHtml(_expenseLabel(record.expense_type))}</span></div>
          <div><span class="info-label">Client</span><span class="info-value">${Utils.escapeHtml(record.clients?.client_name || '—')}</span></div>
          <div><span class="info-label">Reason</span><span class="info-value">${Utils.escapeHtml(record.reason || '—')}</span></div>
          ${record.drive_receipt_url ? `<div><span class="info-label">Receipt</span><a href="${Utils.escapeHtml(record.drive_receipt_url)}" target="_blank" class="link info-value">View Receipt</a></div>` : ''}
        </div>
        ${isClaim ? `
          <div class="form-group">
            <label class="form-label">Approved Amount (₹)</label>
            <input class="form-input" type="number" id="approve-amount" value="${displayAmt || ''}" min="0" />
            <p class="form-hint">You may adjust the approved amount.</p>
          </div>
        ` : ''}
        <div class="form-group">
          <label class="form-label">Remarks <span class="text-muted text-sm">(required if rejecting or adjusting amount)</span></label>
          <textarea class="form-input" id="approve-remarks" rows="2" placeholder="Optional remarks…" style="resize:vertical;"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--danger"  id="reject-btn">Reject</button>
        <button class="btn btn--success" id="approve-btn">Approve</button>
      </div>
    `)

    document.getElementById('approve-btn').addEventListener('click', () => _submitDecision(record, 'approved', isClaim))
    document.getElementById('reject-btn').addEventListener('click',  () => _submitDecision(record, 'rejected', isClaim))
  }

  async function _submitDecision(record, decision, isClaim) {
    const remarks        = document.getElementById('approve-remarks').value.trim()
    const approvedAmount = isClaim ? parseFloat(document.getElementById('approve-amount')?.value) : null
    const originalAmount = record.amount

    if (decision === 'rejected' && !remarks) {
      Utils.showToast('Please provide a rejection reason.', 'error'); return
    }
    if (isClaim && decision === 'approved' && approvedAmount !== originalAmount && !remarks) {
      Utils.showToast('Please add remarks explaining the amount adjustment.', 'error'); return
    }

    document.getElementById('approve-btn').disabled = true
    document.getElementById('reject-btn').disabled  = true

    const updates = { status: decision, approved_by: _user.id }
    if (decision === 'approved' && isClaim) {
      updates.hr_approved_amount = approvedAmount || originalAmount
    }
    if (remarks) {
      if (decision === 'rejected') updates.rejection_comment = remarks
      else                         updates.hr_remarks         = remarks
    }

    const { error } = await Config.supabase
      .from('reimbursements').update(updates).eq('id', record.id)

    if (error) { Utils.showToast('Action failed: ' + error.message, 'error'); return }

    if (record.employee_id) {
      const label = isClaim ? 'reimbursement claim' : 'pre-approval request'
      API.createNotification({
        recipient_employee_id: record.employee_id,
        type: decision === 'approved' ? 'approval' : 'rejection',
        message: decision === 'approved'
          ? `Your ${label} has been approved.`
          : `Your ${label} was rejected${remarks ? ': ' + remarks : '.'}`,
        module: 'reimbursements',
        record_id: record.id,
        notify_email: true,
      })
    }

    // After a claim is approved, notify whoever can actually mark it paid —
    // role = 'finance' or 'super_admin' (matches the reimb_update /
    // people_culture_can_update_reimbursements RLS restriction). The
    // 'finance' role is currently unheld by anyone, so in practice this
    // reaches Super Admin — but querying by role (not the empty 'finance'
    // department) means it'll reach a real finance hire automatically too.
    if (decision === 'approved' && isClaim) {
      const [{ data: financeRole }, { data: superAdmins }] = await Promise.all([
        API.getEmployeesByRole('finance'),
        API.getEmployeesByRole('super_admin'),
      ])
      const _payerNotified = new Set()
      ;[...(financeRole || []), ...(superAdmins || [])].forEach(emp => {
        if (_payerNotified.has(emp.id)) return
        _payerNotified.add(emp.id)
        API.createNotification({
          recipient_employee_id: emp.id,
          type:    'approval',
          message: `A reimbursement claim by ${record.submitter?.name || 'an employee'} has been approved (${Utils.formatCurrency(updates.hr_approved_amount || record.amount)}) and is ready for payment processing.`,
          module:  'reimbursements',
          record_id: record.id,
          notify_email: true,
        })
      })
    }

    Utils.closeModal()
    Utils.showToast(`${decision === 'approved' ? 'Approved' : 'Rejected'} successfully.`, 'success')
    _loadTab(_activeTab)
  }

  /* ══════════════════════════════════════════════════════════
     MARK AS PAID MODAL
  ══════════════════════════════════════════════════════════ */
  function _openMarkPaidModal(claimId, employeeName, amount, employeeId) {
    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Mark as Paid</h3>
        <button class="modal-close" onclick="Utils.closeModal()">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <p>Confirm payment of <strong>${Utils.formatCurrency(amount)}</strong> to <strong>${Utils.escapeHtml(employeeName)}</strong>?</p>
        <p class="form-hint mt-2">This action cannot be undone.</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--success" id="confirm-pay-btn">Confirm Payment</button>
      </div>
    `)

    document.getElementById('confirm-pay-btn').addEventListener('click', async () => {
      const btn     = document.getElementById('confirm-pay-btn')
      btn.disabled  = true
      btn.textContent = 'Processing…'

      const { error } = await Config.supabase
        .from('reimbursements')
        .update({ status: 'paid', paid_by: _user.id, paid_at: new Date().toISOString() })
        .eq('id', claimId)

      if (error) {
        Utils.showToast('Failed: ' + error.message, 'error')
        btn.disabled    = false
        btn.textContent = 'Confirm Payment'
        return
      }

      if (employeeId) {
        API.createNotification({
          recipient_employee_id: employeeId,
          type: 'approval',
          message: `Your reimbursement of ${Utils.formatCurrency(amount)} has been paid.`,
          module: 'reimbursements',
          record_id: claimId,
          notify_email: true,
        })
      }
      Utils.closeModal()
      Utils.showToast('Marked as paid.', 'success')
      _loadPaymentTab()
    })
  }

  return { render, init }
})()

ModuleRegistry.register({
  key:       'reimbursements',
  routeId:   'reimbursements',
  label:     'Reimbursements',
  order:     4,
  icon:      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>`,
  getModule: () => Reimbursements,
  // Nav visibility: show the tab to anyone who qualifies for at least one
  // of the admin views. super_admin bypasses via HRMSApp.hasAccess.
  access:    (user) => user.role === 'super_admin'
    || HRMSApp.hasAccess('reimbursements', 'approve_requests', 'view_only')
    || HRMSApp.hasAccess('reimbursements', 'process_payment', 'view_only')
    || HRMSApp.hasAccess('reimbursements', 'manage_expense_types', 'view_only'),
  features:  {
    approve_requests:     'Approve Requests',
    process_payment:      'Process Payment',
    manage_expense_types: 'Manage Expense Types',
  },
})
