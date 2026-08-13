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

  let _user       = null
  let _activeTab  = null
  let _p          = null

  /* ── render ──────────────────────────────────────────────── */
  function render(user) {
    const isSuperAdmin = user.role === 'super_admin'
    const isFinance    = Utils.getDeptSystemKey(user.department) === 'finance' || user.role === 'finance'

    const canApprove = HRMSApp.hasAccess('reimbursements', 'approve_requests', 'can_manage')
    const canPayment = (isFinance || isSuperAdmin) && HRMSApp.hasAccess('reimbursements', 'process_payment', 'can_manage')

    const tabs = []
    if (canApprove)   tabs.push({ id: 'inbox',        label: 'Inbox' })
    if (isSuperAdmin) tabs.push({ id: 'hr-requests',  label: 'HR Requests' })  // SA convenience view for HR-submitted requests
    if (canApprove)   tabs.push({ id: 'all-requests', label: 'All Requests' })
    if (canPayment)   tabs.push({ id: 'payment',      label: 'For Payment' })

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
              <td>${Utils.getExpenseLabel(r.expense_type)}</td>
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
                <td>${Utils.getExpenseLabel(r.expense_type)}</td>
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

    content.innerHTML = `
      <div class="section-card">
        <div class="section-card-header"><h3>Approved Claims — Awaiting Payment</h3></div>
        <div class="section-card-body">${_renderClaimTable(data || [], true, false, true)}</div>
      </div>
    `

    document.querySelectorAll('[data-pay]').forEach(btn => {
      btn.addEventListener('click', () => _openMarkPaidModal(btn.dataset.pay, btn.dataset.name, btn.dataset.amount, btn.dataset.employee))
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
          <div><span class="info-label">Expense Type</span><span class="info-value">${Utils.getExpenseLabel(record.expense_type)}</span></div>
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
  order:     10,
  icon:      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>`,
  getModule: () => Reimbursements,
  // Nav visibility: show the tab to anyone who qualifies for at least one
  // of the admin views. super_admin bypasses via HRMSApp.hasAccess.
  access:    (user) => user.role === 'super_admin'
    || HRMSApp.hasAccess('reimbursements', 'approve_requests', 'view_only')
    || HRMSApp.hasAccess('reimbursements', 'process_payment', 'view_only'),
  features:  {
    approve_requests: 'Approve Requests',
    process_payment:  'Process Payment',
  },
})
