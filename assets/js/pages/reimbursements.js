/* ============================================================
   REIMBURSEMENTS — Phase 2
   3-stage flow: Pre-Approval → Claim → Mark as Paid
   ============================================================ */

const Reimbursements = (() => {

  const EXPENSE_TYPES = [
    { value: 'travel',                  label: 'Travel (Cab / Train / Flight)' },
    { value: 'food_meals',              label: 'Food & Meals' },
    { value: 'printing_stationery',     label: 'Printing & Stationery' },
    { value: 'internet_communication',  label: 'Internet & Communication' },
    { value: 'photography_videography', label: 'Photography & Videography' },
    { value: 'event_venue',             label: 'Event & Venue' },
    { value: 'software_tools',          label: 'Software & Tools' },
    { value: 'courier_delivery',        label: 'Courier & Delivery' },
    { value: 'marketing_materials',     label: 'Marketing Materials' },
    { value: 'accommodation',           label: 'Accommodation' },
    { value: 'other',                   label: 'Other' },
  ]

  const STATUS_BADGE = {
    pending:  '<span class="badge badge--warning">Pending</span>',
    approved: '<span class="badge badge--success">Approved</span>',
    rejected: '<span class="badge badge--danger">Rejected</span>',
    paid:     '<span class="badge badge--info">Paid</span>',
  }

  const CAN_APPROVE = ['super_admin', 'hr']

  let _user       = null
  let _clients    = []
  let _activeTab  = 'mine'

  /* ── render ──────────────────────────────────────────────── */
  function render(user) {
    const isFinance    = user.role === 'finance'
    const isHR         = user.role === 'hr'
    const isSuperAdmin = user.role === 'super_admin'
    const canApprove   = CAN_APPROVE.includes(user.role)

    const tabs = []
    tabs.push({ id: 'mine', label: 'My Requests' })
    if (canApprove)   tabs.push({ id: 'inbox',      label: 'Inbox' })
    if (isSuperAdmin) tabs.push({ id: 'hr-requests', label: 'HR Requests' })
    if (isFinance || isSuperAdmin) tabs.push({ id: 'payment', label: 'For Payment' })

    return `
      <div class="page-inner">
        <div class="page-toolbar">
          <div class="tabs" id="reimb-tabs">
            ${tabs.map(t => `<button class="tab-btn${t.id === 'mine' ? ' tab-btn--active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
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
    _activeTab = 'mine'

    const { data } = await API.getClients()
    _clients = data || []

    _bindTabs()
    _loadTab('mine')
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
      case 'mine':        return _loadMineTab()
      case 'inbox':       return _loadInboxTab()
      case 'hr-requests': return _loadHRRequestsTab()
      case 'payment':     return _loadPaymentTab()
    }
  }

  /* ══════════════════════════════════════════════════════════
     MY REQUESTS TAB
  ══════════════════════════════════════════════════════════ */
  async function _loadMineTab() {
    const content = document.getElementById('reimb-content')
    const toolbar = document.getElementById('reimb-toolbar-actions')
    content.innerHTML = '<p class="loading-text">Loading…</p>'

    if (toolbar) {
      toolbar.innerHTML = `
        <button class="btn btn--primary" id="btn-new-preapproval">+ Pre-Approval Request</button>
        <button class="btn btn--secondary" id="btn-new-claim">+ File a Claim</button>
      `
      document.getElementById('btn-new-preapproval').addEventListener('click', _openPreApprovalModal)
      document.getElementById('btn-new-claim').addEventListener('click', _openClaimModal)
    }

    const [paRes, clRes] = await Promise.all([
      API.getMyReimbursements(_user.id, 'pre_approval'),
      API.getMyReimbursements(_user.id, 'claim'),
    ])

    const preApprovals = paRes.data || []
    const claims       = clRes.data || []

    content.innerHTML = `
      <div class="section-card mb-4">
        <div class="section-card-header"><h3>Stage 1 — Pre-Approval Requests</h3></div>
        <div class="section-card-body">
          ${_renderPreApprovalTable(preApprovals, false)}
        </div>
      </div>
      <div class="section-card">
        <div class="section-card-header"><h3>Stage 2 — Expense Claims</h3></div>
        <div class="section-card-body">
          ${_renderClaimTable(claims, false)}
        </div>
      </div>
    `
  }

  function _renderPreApprovalTable(rows, showEmployee) {
    if (!rows.length) return '<p class="empty-state">No pre-approval requests.</p>'
    return `
      <table class="data-table">
        <thead><tr>
          ${showEmployee ? '<th>Employee</th>' : ''}
          <th>Expense Type</th>
          <th>Client</th>
          <th>Est. Amount</th>
          <th>Expected Date</th>
          <th>Status</th>
          <th>Reason</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              ${showEmployee ? `<td>${Utils.escapeHtml(r.employees?.name || '—')}</td>` : ''}
              <td>${Utils.getExpenseLabel(r.expense_type)}</td>
              <td>${Utils.escapeHtml(r.clients?.client_name || '—')}</td>
              <td>${Utils.formatCurrency(r.estimated_amount)}</td>
              <td>${Utils.formatDate(r.expected_date)}</td>
              <td>${STATUS_BADGE[r.status] || r.status}</td>
              <td>${Utils.escapeHtml(Utils.truncate(r.reason || '—', 50))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `
  }

  function _renderClaimTable(rows, showEmployee, showApproveBtn = false, showPayBtn = false) {
    if (!rows.length) return '<p class="empty-state">No claims found.</p>'
    return `
      <table class="data-table">
        <thead><tr>
          ${showEmployee ? '<th>Employee</th>' : ''}
          <th>Expense Type</th>
          <th>Client</th>
          <th>Amount</th>
          <th>Date</th>
          <th>Status</th>
          <th>Receipt</th>
          ${showApproveBtn || showPayBtn ? '<th>Action</th>' : ''}
        </tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              ${showEmployee ? `<td>${Utils.escapeHtml(r.employees?.name || '—')}</td>` : ''}
              <td>${Utils.getExpenseLabel(r.expense_type)}</td>
              <td>${Utils.escapeHtml(r.clients?.client_name || '—')}</td>
              <td>${Utils.formatCurrency(r.amount)}</td>
              <td>${Utils.formatDate(r.expense_date)}</td>
              <td>${STATUS_BADGE[r.status] || r.status}</td>
              <td>${r.drive_receipt_url
                ? `<a href="${Utils.escapeHtml(r.drive_receipt_url)}" target="_blank" class="link">View</a>`
                : '—'}</td>
              ${showApproveBtn ? `<td><button class="btn btn--xs btn--primary" data-approve="${r.id}">Review</button></td>` : ''}
              ${showPayBtn && r.status === 'approved' ? `<td><button class="btn btn--xs btn--success" data-pay="${r.id}" data-name="${Utils.escapeHtml(r.employees?.name || '')}" data-amount="${r.hr_approved_amount || r.amount}">Mark Paid</button></td>` : ''}
              ${(!showApproveBtn && !showPayBtn) ? '' : ''}
            </tr>
          `).join('')}
        </tbody>
      </table>
    `
  }

  /* ══════════════════════════════════════════════════════════
     INBOX TAB (HR / Super Admin — non-HR employees only)
  ══════════════════════════════════════════════════════════ */
  async function _loadInboxTab() {
    const content = document.getElementById('reimb-content')
    content.innerHTML = '<p class="loading-text">Loading…</p>'

    const [paRes, clRes] = await Promise.all([
      API.getReimbursementInbox('pre_approval'),
      API.getReimbursementInbox('claim'),
    ])

    // HR sees everyone's requests except other HR employees' own submissions
    const filterFn = _user.role === 'hr'
      ? r => r.employees?.role !== 'hr'
      : () => true

    const preApprovals = (paRes.data || []).filter(filterFn)
    const claims       = (clRes.data || []).filter(filterFn)

    content.innerHTML = `
      <div class="section-card mb-4">
        <div class="section-card-header"><h3>Pending Pre-Approval Requests</h3></div>
        <div class="section-card-body" id="inbox-preapprovals">
          ${_renderPreApprovalTable(preApprovals, true)}
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
      const id = btn.dataset.approve
      btn.addEventListener('click', () => {
        const record = [...preApprovals, ...claims].find(r => r.id === id)
        if (record) _openApproveModal(record)
      })
    })
  }

  /* ══════════════════════════════════════════════════════════
     HR REQUESTS TAB (Super Admin only — HR employees' requests)
  ══════════════════════════════════════════════════════════ */
  async function _loadHRRequestsTab() {
    const content = document.getElementById('reimb-content')
    content.innerHTML = '<p class="loading-text">Loading…</p>'

    const [paRes, clRes] = await Promise.all([
      API.getReimbursementInbox('pre_approval'),
      API.getReimbursementInbox('claim'),
    ])

    const hrOnly = r => r.employees?.role === 'hr'
    const preApprovals = (paRes.data || []).filter(hrOnly)
    const claims       = (clRes.data || []).filter(hrOnly)

    content.innerHTML = `
      <div class="section-card mb-4">
        <div class="section-card-header"><h3>HR Pre-Approval Requests</h3></div>
        <div class="section-card-body">
          ${_renderPreApprovalTable(preApprovals, true)}
        </div>
      </div>
      <div class="section-card">
        <div class="section-card-header"><h3>HR Expense Claims</h3></div>
        <div class="section-card-body">
          ${_renderClaimTable(claims, true, true, false)}
        </div>
      </div>
    `

    _bindInboxApproveButtons(preApprovals, claims)
  }

  /* ══════════════════════════════════════════════════════════
     FOR PAYMENT TAB (Finance / Super Admin)
  ══════════════════════════════════════════════════════════ */
  async function _loadPaymentTab() {
    const content = document.getElementById('reimb-content')
    content.innerHTML = '<p class="loading-text">Loading…</p>'

    const { data, error } = await API.getApprovedClaims()
    if (error) { content.innerHTML = '<p class="empty-state">Failed to load.</p>'; return }

    const claims = data || []
    content.innerHTML = `
      <div class="section-card">
        <div class="section-card-header"><h3>Approved Claims — Awaiting Payment</h3></div>
        <div class="section-card-body">
          ${_renderClaimTable(claims, true, false, true)}
        </div>
      </div>
    `

    document.querySelectorAll('[data-pay]').forEach(btn => {
      btn.addEventListener('click', () => {
        _openMarkPaidModal(btn.dataset.pay, btn.dataset.name, btn.dataset.amount)
      })
    })
  }

  /* ══════════════════════════════════════════════════════════
     MODALS
  ══════════════════════════════════════════════════════════ */

  /* ── Pre-Approval Modal ──────────────────────────────────── */
  function _openPreApprovalModal() {
    const clientOptions = _clients.map(c =>
      `<option value="${c.id}">${Utils.escapeHtml(c.client_name)} (${c.project_code})</option>`
    ).join('')

    const expenseOptions = EXPENSE_TYPES.map(e =>
      `<option value="${e.value}">${e.label}</option>`
    ).join('')

    Utils.openModal(`
      <div class="modal-header"><h3>Request Pre-Approval</h3></div>
      <div class="modal-body">
        <div class="form-group">
          <label>Expense Type</label>
          <select id="pa-expense-type">${expenseOptions}</select>
        </div>
        <div class="form-group">
          <label>Client / Project</label>
          <select id="pa-client"><option value="">— No specific client —</option>${clientOptions}</select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Estimated Amount (₹)</label>
            <input type="number" id="pa-amount" min="0" placeholder="0" />
          </div>
          <div class="form-group">
            <label>Expected Date</label>
            <input type="date" id="pa-date" />
          </div>
        </div>
        <div class="form-group">
          <label>Reason / Purpose</label>
          <textarea id="pa-reason" rows="3" placeholder="Briefly explain the expense…"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="pa-submit-btn">Submit Request</button>
      </div>
    `)

    document.getElementById('pa-submit-btn').addEventListener('click', _submitPreApproval)
  }

  async function _submitPreApproval() {
    const btn         = document.getElementById('pa-submit-btn')
    const expenseType = document.getElementById('pa-expense-type').value
    const clientId    = document.getElementById('pa-client').value || null
    const amount      = parseFloat(document.getElementById('pa-amount').value) || null
    const date        = document.getElementById('pa-date').value || null
    const reason      = document.getElementById('pa-reason').value.trim()

    if (!reason) { Utils.showToast('Please provide a reason.', 'error'); return }

    btn.disabled = true
    btn.textContent = 'Submitting…'

    const client = clientId ? _clients.find(c => c.id === clientId) : null

    const { error } = await API.insertReimbursement({
      employee_id:      _user.id,
      type:             'pre_approval',
      expense_type:     expenseType,
      client_id:        clientId,
      project_code:     client?.project_code || null,
      estimated_amount: amount,
      expected_date:    date,
      reason,
      status:           'pending',
    })

    if (error) {
      Utils.showToast('Failed to submit: ' + error.message, 'error')
      btn.disabled = false
      btn.textContent = 'Submit Request'
      return
    }

    Utils.closeModal()
    Utils.showToast('Pre-approval request submitted.', 'success')
    _loadMineTab()
  }

  /* ── Claim Modal ─────────────────────────────────────────── */
  async function _openClaimModal() {
    const clientOptions = _clients.map(c =>
      `<option value="${c.id}">${Utils.escapeHtml(c.client_name)} (${c.project_code})</option>`
    ).join('')

    const expenseOptions = EXPENSE_TYPES.map(e =>
      `<option value="${e.value}">${e.label}</option>`
    ).join('')

    const { data: preApprovals } = await API.getMyPreApprovals(_user.id)
    const preApprovalOptions = (preApprovals || []).map(pa =>
      `<option value="${pa.id}">${Utils.getExpenseLabel(pa.expense_type)} — Est. ${Utils.formatCurrency(pa.estimated_amount)} (${Utils.formatDate(pa.expected_date)})</option>`
    ).join('')

    Utils.openModal(`
      <div class="modal-header"><h3>File an Expense Claim</h3></div>
      <div class="modal-body">
        <div class="form-group">
          <label>Linked Pre-Approval (optional)</label>
          <select id="cl-preapproval">
            <option value="">— None —</option>
            ${preApprovalOptions}
          </select>
        </div>
        <div class="form-group">
          <label>Expense Type</label>
          <select id="cl-expense-type">${expenseOptions}</select>
        </div>
        <div class="form-group">
          <label>Client / Project</label>
          <select id="cl-client"><option value="">— No specific client —</option>${clientOptions}</select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Amount Spent (₹)</label>
            <input type="number" id="cl-amount" min="0" placeholder="0" />
          </div>
          <div class="form-group">
            <label>Expense Date</label>
            <input type="date" id="cl-date" />
          </div>
        </div>
        <div class="form-group">
          <label>Google Drive Receipt URL</label>
          <input type="url" id="cl-receipt" placeholder="https://drive.google.com/…" />
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea id="cl-reason" rows="2" placeholder="Brief description of the expense…"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="cl-submit-btn">Submit Claim</button>
      </div>
    `)

    document.getElementById('cl-submit-btn').addEventListener('click', _submitClaim)
  }

  async function _submitClaim() {
    const btn           = document.getElementById('cl-submit-btn')
    const preApprovalId = document.getElementById('cl-preapproval').value || null
    const expenseType   = document.getElementById('cl-expense-type').value
    const clientId      = document.getElementById('cl-client').value || null
    const amount        = parseFloat(document.getElementById('cl-amount').value)
    const date          = document.getElementById('cl-date').value
    const receipt       = document.getElementById('cl-receipt').value.trim() || null
    const reason        = document.getElementById('cl-reason').value.trim()

    if (!amount || amount <= 0) { Utils.showToast('Enter a valid amount.', 'error'); return }
    if (!date)                  { Utils.showToast('Select an expense date.', 'error'); return }

    btn.disabled = true
    btn.textContent = 'Submitting…'

    const client = clientId ? _clients.find(c => c.id === clientId) : null

    const { error } = await API.insertReimbursement({
      employee_id:      _user.id,
      type:             'claim',
      pre_approval_id:  preApprovalId,
      expense_type:     expenseType,
      client_id:        clientId,
      project_code:     client?.project_code || null,
      amount,
      expense_date:     date,
      drive_receipt_url: receipt,
      reason,
      status:           'pending',
    })

    if (error) {
      Utils.showToast('Failed to submit: ' + error.message, 'error')
      btn.disabled = false
      btn.textContent = 'Submit Claim'
      return
    }

    Utils.closeModal()
    Utils.showToast('Expense claim submitted.', 'success')
    _loadMineTab()
  }

  /* ── Approve / Reject Modal ──────────────────────────────── */
  function _openApproveModal(record) {
    const isClaim      = record.type === 'claim'
    const displayAmt   = isClaim ? record.amount : record.estimated_amount
    const amountLabel  = isClaim ? 'Claimed Amount (₹)' : 'Estimated Amount (₹)'

    Utils.openModal(`
      <div class="modal-header">
        <h3>Review ${isClaim ? 'Expense Claim' : 'Pre-Approval Request'}</h3>
      </div>
      <div class="modal-body">
        <div class="info-grid mb-3">
          <div><span class="label">Employee</span><span>${Utils.escapeHtml(record.employees?.name || '—')}</span></div>
          <div><span class="label">Expense Type</span><span>${Utils.getExpenseLabel(record.expense_type)}</span></div>
          <div><span class="label">Client</span><span>${Utils.escapeHtml(record.clients?.client_name || '—')}</span></div>
          <div><span class="label">Reason</span><span>${Utils.escapeHtml(record.reason || '—')}</span></div>
          ${record.drive_receipt_url ? `<div><span class="label">Receipt</span><a href="${Utils.escapeHtml(record.drive_receipt_url)}" target="_blank" class="link">View</a></div>` : ''}
        </div>
        ${isClaim ? `
          <div class="form-group">
            <label>${amountLabel}</label>
            <input type="number" id="approve-amount" value="${displayAmt || ''}" min="0" />
            <p class="form-hint">You may adjust the approved amount.</p>
          </div>
        ` : ''}
        <div class="form-group">
          <label>Remarks (required if amount is adjusted or rejected)</label>
          <textarea id="approve-remarks" rows="2" placeholder="Optional remarks…"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--danger" id="reject-btn">Reject</button>
        <button class="btn btn--success" id="approve-btn">Approve</button>
      </div>
    `)

    document.getElementById('approve-btn').addEventListener('click', () => _submitDecision(record, 'approved', isClaim))
    document.getElementById('reject-btn').addEventListener('click',  () => _submitDecision(record, 'rejected', isClaim))
  }

  async function _submitDecision(record, decision, isClaim) {
    const remarks         = document.getElementById('approve-remarks').value.trim()
    const approvedAmount  = isClaim
      ? parseFloat(document.getElementById('approve-amount')?.value)
      : null
    const originalAmount  = record.amount

    if (decision === 'rejected' && !remarks) {
      Utils.showToast('Please provide a rejection reason.', 'error')
      return
    }
    if (isClaim && decision === 'approved' && approvedAmount !== originalAmount && !remarks) {
      Utils.showToast('Please add remarks explaining the amount adjustment.', 'error')
      return
    }

    const approveBtn = document.getElementById('approve-btn')
    const rejectBtn  = document.getElementById('reject-btn')
    if (approveBtn) approveBtn.disabled = true
    if (rejectBtn)  rejectBtn.disabled  = true

    const updates = {
      status:      decision,
      approved_by: _user.id,
    }
    if (decision === 'approved' && isClaim) {
      updates.hr_approved_amount = approvedAmount || originalAmount
    }
    if (remarks) {
      if (decision === 'rejected') updates.rejection_comment = remarks
      else                         updates.hr_remarks         = remarks
    }

    const { error } = await Config.supabase
      .from('reimbursements')
      .update(updates)
      .eq('id', record.id)

    if (error) {
      Utils.showToast('Action failed: ' + error.message, 'error')
      return
    }

    Utils.closeModal()
    Utils.showToast(`${decision === 'approved' ? 'Approved' : 'Rejected'} successfully.`, 'success')
    _loadTab(_activeTab)
  }

  /* ── Mark as Paid Modal ──────────────────────────────────── */
  function _openMarkPaidModal(claimId, employeeName, amount) {
    Utils.openModal(`
      <div class="modal-header"><h3>Mark as Paid</h3></div>
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
      const btn = document.getElementById('confirm-pay-btn')
      btn.disabled = true
      btn.textContent = 'Processing…'

      const { error } = await Config.supabase
        .from('reimbursements')
        .update({ status: 'paid', paid_by: _user.id, paid_at: new Date().toISOString() })
        .eq('id', claimId)

      if (error) {
        Utils.showToast('Failed: ' + error.message, 'error')
        btn.disabled = false
        btn.textContent = 'Confirm Payment'
        return
      }

      Utils.closeModal()
      Utils.showToast('Marked as paid.', 'success')
      _loadPaymentTab()
    })
  }

  return { render, init }
})()
