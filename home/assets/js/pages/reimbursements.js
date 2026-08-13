/* ============================================================
   REIMBURSEMENTS — self-service (Growthic One)
   Raise a pre-approval request or file an expense claim, and
   track your own requests. Reviewing/approving/rejecting and
   marking claims as paid now lives in /hrms.
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

  /* Rich status badge for claims in the My Requests view */
  function _claimStatusBadge(row) {
    switch (row.status) {
      case 'pending':
        return '<span class="badge badge--warning">Pending</span>'

      case 'approved': {
        const approver    = row.approver?.name
        const approvedAmt = row.hr_approved_amount
        const remarks     = row.hr_remarks
        return `
          <div>
            <span class="badge badge--success">Approved by HR</span>
            ${approver    ? `<div class="text-sm text-muted" style="margin-top:3px;">by ${Utils.escapeHtml(approver)}</div>` : ''}
            ${approvedAmt ? `<div class="text-sm" style="margin-top:2px;font-weight:600;color:var(--success,#1D9E75);">${Utils.formatCurrency(approvedAmt)}</div>` : ''}
            ${remarks     ? `<div class="text-sm text-muted" style="margin-top:3px;font-style:italic;white-space:pre-wrap;word-break:break-word;">💬 "${Utils.escapeHtml(remarks)}"</div>` : ''}
          </div>`
      }

      case 'rejected': {
        const reason = row.rejection_comment
        return `
          <div>
            <span class="badge badge--danger">Rejected</span>
            ${reason ? `<div class="text-sm text-muted" style="margin-top:3px;white-space:pre-wrap;word-break:break-word;">${Utils.escapeHtml(reason)}</div>` : ''}
          </div>`
      }

      case 'paid': {
        const paidAmt = row.hr_approved_amount || row.amount
        const paidAt  = row.paid_at
        return `
          <div>
            <span class="badge badge--info">Paid ✓</span>
            ${paidAmt ? `<div class="text-sm" style="margin-top:3px;font-weight:600;color:var(--primary);">${Utils.formatCurrency(paidAmt)} paid</div>` : ''}
            ${paidAt  ? `<div class="text-sm text-muted" style="margin-top:2px;">${Utils.formatDate(paidAt)}</div>` : ''}
          </div>`
      }

      default:
        return `<span class="badge">${row.status}</span>`
    }
  }

  let _user                = null
  let _clients             = []
  let _selectedPreApproval = null   // PA object linked to current claim
  let _receiptUrl          = null   // Drive URL after receipt upload
  let _canCreate            = false

  /* ── render ──────────────────────────────────────────────── */
  function render(user) {
    return `
      <div class="page-inner">
        <div class="page-toolbar">
          <div></div>
          <div id="reimb-toolbar-actions"></div>
        </div>
        <div id="reimb-content" class="mt-4"></div>
      </div>
    `
  }

  /* ── init ────────────────────────────────────────────────── */
  async function init(user) {
    _user                = user
    _canCreate            = App.hasAccess('reimbursements', 'raise_pre_approval', 'can_upload')
    _selectedPreApproval = null
    _receiptUrl          = null

    const { data } = await API.getClients()
    _clients = data || []

    _loadMineTab()
  }

  /* ══════════════════════════════════════════════════════════
     MY REQUESTS
  ══════════════════════════════════════════════════════════ */
  async function _loadMineTab() {
    const content = document.getElementById('reimb-content')
    const toolbar = document.getElementById('reimb-toolbar-actions')
    content.innerHTML = '<p class="loading-text">Loading…</p>'

    if (toolbar) {
      toolbar.innerHTML = `
        ${_canCreate ? `<button class="btn btn--primary" id="btn-new-preapproval">+ Pre-Approval Request</button>` : ''}
        ${_canCreate ? `<button class="btn btn--secondary" id="btn-new-claim">+ File a Claim</button>` : ''}
      `
      if (_canCreate) {
        document.getElementById('btn-new-preapproval')?.addEventListener('click', _openPreApprovalModal)
        document.getElementById('btn-new-claim')?.addEventListener('click', _openClaimModal)
      }
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
        <div class="section-card-body">${_renderPreApprovalTable(preApprovals)}</div>
      </div>
      <div class="section-card">
        <div class="section-card-header"><h3>Stage 2 — Expense Claims</h3></div>
        <div class="section-card-body">${_renderClaimTable(claims)}</div>
      </div>
    `
  }

  function _renderPreApprovalTable(rows) {
    if (!rows.length) return '<p class="empty-state">No pre-approval requests yet.</p>'
    return `
      <table class="data-table">
        <thead><tr>
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
              <td>${Utils.getExpenseLabel(r.expense_type)}</td>
              <td>${Utils.escapeHtml(r.clients?.client_name || '—')}</td>
              <td>${Utils.formatCurrency(r.estimated_amount)}</td>
              <td>${Utils.formatDate(r.expected_date)}</td>
              <td>${STATUS_BADGE[r.status] || r.status}</td>
              <td class="text-muted" style="white-space:pre-wrap;word-break:break-word;max-width:220px;">${Utils.escapeHtml(r.reason || '—')}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    `
  }

  function _renderClaimTable(rows) {
    if (!rows.length) return '<p class="empty-state">No claims found.</p>'
    return `
      <table class="data-table">
        <thead><tr>
          <th>Expense Type</th>
          <th>Client</th>
          <th>Amount</th>
          <th>Date</th>
          <th>Status</th>
          <th>Receipt</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => {
            const amtCell = (r.hr_approved_amount && ['approved', 'paid'].includes(r.status))
              ? `<div style="font-weight:600;color:var(--success,#1D9E75);">${Utils.formatCurrency(r.hr_approved_amount)}</div>
                ${r.hr_approved_amount != r.amount
                  ? `<div class="text-sm text-muted" style="margin-top:2px;">Submitted: ${Utils.formatCurrency(r.amount)}</div>`
                  : ''}`
              : Utils.formatCurrency(r.amount)

            return `
              <tr>
                <td>${Utils.getExpenseLabel(r.expense_type)}</td>
                <td>${Utils.escapeHtml(r.clients?.client_name || '—')}</td>
                <td>${amtCell}</td>
                <td style="white-space:nowrap;">${Utils.formatDate(r.expense_date)}</td>
                <td>${_claimStatusBadge(r)}</td>
                <td>${r.drive_receipt_url
                  ? `<a href="${Utils.escapeHtml(r.drive_receipt_url)}" target="_blank" class="link">View</a>`
                  : '—'}</td>
              </tr>`
          }).join('')}
        </tbody>
      </table>
    `
  }

  /* ══════════════════════════════════════════════════════════
     PRE-APPROVAL MODAL
  ══════════════════════════════════════════════════════════ */
  function _openPreApprovalModal() {
    const expenseOptions = EXPENSE_TYPES.map(e =>
      `<option value="${e.value}">${e.label}</option>`
    ).join('')

    const clientOptions = _clients.map(c =>
      `<option value="${c.id}" data-code="${Utils.escapeHtml(c.project_code)}">${Utils.escapeHtml(c.client_name)}</option>`
    ).join('')

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Request Pre-Approval</h3>
        <button class="modal-close" onclick="Utils.closeModal()">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">

        <p class="modal-section-label">Expense Details</p>
        <div class="form-group">
          <label class="form-label">Expense Type <span class="required">*</span></label>
          <select class="form-select" id="pa-expense-type">${expenseOptions}</select>
        </div>

        <p class="modal-section-label">Client</p>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Client</label>
            <select class="form-select" id="pa-client">
              <option value="">— No specific client —</option>
              ${clientOptions}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Project Code</label>
            <input class="form-input" type="text" id="pa-project-code" placeholder="Auto-filled on client select" readonly />
          </div>
        </div>
        <div class="form-group" id="pa-entity-wrap" style="display:none;">
          <label class="form-label">Entity <span class="required">*</span></label>
          <select class="form-select" id="pa-entity">
            <option value="">— Select entity —</option>
          </select>
        </div>

        <p class="modal-section-label">Amount &amp; Timeline</p>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Estimated Amount (₹) <span class="required">*</span></label>
            <input class="form-input" type="number" id="pa-amount" min="0" placeholder="0" />
          </div>
          <div class="form-group">
            <label class="form-label">Expected Date <span class="required">*</span></label>
            <input class="form-input" type="date" id="pa-date" />
          </div>
        </div>

        <p class="modal-section-label">Purpose</p>
        <div class="form-group">
          <label class="form-label">Reason / Purpose <span class="required">*</span></label>
          <textarea class="form-input" id="pa-reason" rows="3"
            placeholder="Briefly explain the purpose of this expense…"
            style="resize:vertical;"></textarea>
        </div>

      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="pa-submit-btn">Submit Request</button>
      </div>
    `)

    // Client → project code + entity
    document.getElementById('pa-client').addEventListener('change', async function () {
      const clientId    = this.value
      const pcEl        = document.getElementById('pa-project-code')
      const entityWrap  = document.getElementById('pa-entity-wrap')
      const entitySel   = document.getElementById('pa-entity')

      if (!clientId) {
        pcEl.value              = ''
        entityWrap.style.display = 'none'
        return
      }

      const client = _clients.find(c => c.id === clientId)
      if (client) pcEl.value = client.project_code || ''

      const { data: full } = await API.getClient(clientId)
      // Deduplicate entities — nested joins (entity_platforms/services) can produce duplicate rows
      const seen     = new Set()
      const entities = (full?.client_entities || []).filter(e => {
        if (seen.has(e.id)) return false
        seen.add(e.id)
        return true
      })

      if (entities.length > 1) {
        entitySel.innerHTML = '<option value="">— Select entity —</option>' +
          entities.map(e => `<option value="${e.id}">${Utils.escapeHtml(e.entity_name)}</option>`).join('')
        entityWrap.style.display = 'block'
      } else {
        entityWrap.style.display = 'none'
      }
    })

    document.getElementById('pa-submit-btn').addEventListener('click', _submitPreApproval)
  }

  async function _submitPreApproval() {
    const btn         = document.getElementById('pa-submit-btn')
    const expenseType = document.getElementById('pa-expense-type').value
    const clientId    = document.getElementById('pa-client').value || null
    const entityWrap  = document.getElementById('pa-entity-wrap')
    const entityId    = (entityWrap && entityWrap.style.display !== 'none')
      ? (document.getElementById('pa-entity')?.value || null) : null
    const amount      = parseFloat(document.getElementById('pa-amount').value) || null
    const date        = document.getElementById('pa-date').value || null
    const reason      = document.getElementById('pa-reason').value.trim()

    if (!amount || amount <= 0) { Utils.showToast('Enter a valid estimated amount.', 'error'); return }
    if (!date)                  { Utils.showToast('Select an expected date.', 'error'); return }
    if (!reason)                { Utils.showToast('Please provide a reason.', 'error'); return }

    btn.disabled    = true
    btn.textContent = 'Submitting…'

    const client = clientId ? _clients.find(c => c.id === clientId) : null

    const { data: inserted, error } = await API.insertReimbursement({
      employee_id:      _user.id,
      type:             'pre_approval',
      expense_type:     expenseType,
      client_id:        clientId,
      entity_id:        entityId,
      project_code:     client?.project_code || null,
      estimated_amount: amount,
      expected_date:    date,
      reason,
      status:           'pending',
    })

    if (error) {
      Utils.showToast('Failed to submit: ' + error.message, 'error')
      btn.disabled    = false
      btn.textContent = 'Submit Request'
      return
    }

    // Notify reporting manager and HR only — Super Admin doesn't need to
    // know until HR has actually approved it (see the approval handler).
    const _notifMsg = `${_user.name} has submitted a pre-approval request (${Utils.getExpenseLabel(expenseType)}, est. ${Utils.formatCurrency(amount)}) — please review.`
    const _notifPayload = { type: 'submitted', message: _notifMsg, module: 'reimbursements', record_id: inserted?.id || null }
    const _notified = new Set([_user.id])  // never notify the submitter themselves

    if (_user.manager_id && !_notified.has(_user.manager_id)) {
      _notified.add(_user.manager_id)
      API.createNotification({ recipient_employee_id: _user.manager_id, ..._notifPayload })
    }
    const { data: hrTeam } = await API.getEmployeesByDepartment('people_culture')
    ;(hrTeam || []).forEach(emp => {
      if (!_notified.has(emp.id)) {
        _notified.add(emp.id)
        API.createNotification({ recipient_employee_id: emp.id, ..._notifPayload })
      }
    })

    Utils.closeModal()
    Utils.showToast('Pre-approval request submitted.', 'success')
    _loadMineTab()
  }

  /* ══════════════════════════════════════════════════════════
     CLAIM MODAL — Step 1: Pre-Approval cards
                   Step 2: Claim form with auto-fill + file upload
  ══════════════════════════════════════════════════════════ */
  async function _openClaimModal() {
    _selectedPreApproval = null
    _receiptUrl          = null

    // Fetch approved PAs + existing claims in parallel
    const [paRes, claimRes] = await Promise.all([
      API.getMyPreApprovals(_user.id),
      API.getMyReimbursements(_user.id, 'claim'),
    ])

    const allPAs    = paRes.data   || []
    const allClaims = claimRes.data || []

    // Filter 1: PAs with a non-rejected claim linked via pre_approval_id
    const usedByLink = new Set(
      allClaims
        .filter(c => c.pre_approval_id && c.status !== 'rejected')
        .map(c => c.pre_approval_id)
    )

    // Filter 2: Best-effort catch for old claims that predate pre_approval_id tracking.
    // If a claim with the same expense_type + client_id is approved or paid and has no
    // pre_approval_id set, treat the matching PA as consumed.
    const resolvedByMatch = new Set(
      allPAs
        .filter(pa =>
          allClaims.some(c =>
            !c.pre_approval_id &&
            ['approved', 'paid'].includes(c.status) &&
            c.expense_type === pa.expense_type &&
            c.client_id    === pa.client_id
          )
        )
        .map(pa => pa.id)
    )

    const preApprovals = allPAs.filter(pa => !usedByLink.has(pa.id) && !resolvedByMatch.has(pa.id))

    Utils.openModal(_buildClaimModalHTML(preApprovals))
    _bindClaimStep1(preApprovals)
  }

  function _buildClaimModalHTML(preApprovals) {
    const hasPA = preApprovals.length > 0

    const cardList = hasPA
      ? preApprovals.map(pa => `
          <div class="pa-card" data-pa-id="${pa.id}">
            <div class="pa-card-top">
              <span class="pa-card-type">${Utils.getExpenseLabel(pa.expense_type)}</span>
              <span class="badge badge--success">Approved</span>
            </div>
            <div class="pa-card-meta">
              <span>Est. ${Utils.formatCurrency(pa.estimated_amount)}</span>
              ${pa.clients?.client_name ? `<span>${Utils.escapeHtml(pa.clients.client_name)}</span>` : ''}
              ${pa.entity?.entity_name  ? `<span>${Utils.escapeHtml(pa.entity.entity_name)}</span>` : ''}
              ${pa.expected_date        ? `<span>By ${Utils.formatDate(pa.expected_date)}</span>` : ''}
            </div>
          </div>`).join('')
      : `<div class="empty-state-full" style="min-height:120px;padding:28px 0;">
           <p style="font-size:14px;color:var(--text-muted);margin:0;">No approved pre-approvals found.</p>
           <p class="text-sm text-muted" style="margin-top:6px;">You can still file a direct claim below.</p>
         </div>`

    return `
      <div class="modal-header">
        <h3 class="modal-title">File an Expense Claim</h3>
        <button class="modal-close" onclick="Utils.closeModal()">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <!-- ── Step 1: Pre-Approval selection ── -->
      <div id="claim-step-1">
        <div class="modal-body">
          <p class="modal-section-label">${hasPA ? 'Select a pre-approved request to link' : 'Pre-Approvals'}</p>
          <div id="pa-cards-container">${cardList}</div>
          ${hasPA ? `<button class="skip-preapproval" id="skip-pa-btn">File without a pre-approval →</button>` : ''}
        </div>
        <div class="modal-footer">
          <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
          ${!hasPA ? `<button class="btn btn--primary" id="skip-pa-btn">File a Direct Claim</button>` : ''}
        </div>
      </div>

      <!-- ── Step 2: Claim form ── -->
      <div id="claim-step-2" style="display:none;">
        <div id="claim-step-2-inner"></div>
        <div class="modal-footer">
          <button class="btn btn--ghost" id="claim-back-btn">← Back</button>
          <button class="btn btn--primary" id="cl-submit-btn">Submit Claim</button>
        </div>
      </div>
    `
  }

  function _bindClaimStep1(preApprovals) {
    document.querySelectorAll('.pa-card').forEach(card => {
      card.addEventListener('click', () => {
        _selectedPreApproval = preApprovals.find(p => p.id === card.dataset.paId) || null
        _showClaimStep2()
      })
    })

    document.getElementById('skip-pa-btn')?.addEventListener('click', () => {
      _selectedPreApproval = null
      _showClaimStep2()
    })
  }

  function _showClaimStep2() {
    document.getElementById('claim-step-1').style.display = 'none'

    const step2 = document.getElementById('claim-step-2')
    step2.style.display = 'block'

    document.getElementById('claim-step-2-inner').innerHTML = _buildClaimFormHTML(_selectedPreApproval)
    _bindClaimStep2()

    document.getElementById('claim-back-btn')?.addEventListener('click', () => {
      _receiptUrl = null
      step2.style.display = 'none'
      document.getElementById('claim-step-1').style.display = 'block'
    })

    document.getElementById('cl-submit-btn')?.addEventListener('click', _submitClaim)
  }

  function _buildClaimFormHTML(pa) {
    const isFromPA         = !!pa
    const expenseOptions   = EXPENSE_TYPES.map(e =>
      `<option value="${e.value}"${isFromPA && pa.expense_type === e.value ? ' selected' : ''}>${e.label}</option>`
    ).join('')
    const prefilledClientId   = pa?.client_id || ''
    const prefilledProjectCode = pa?.clients?.project_code || ''

    const clientOptions = _clients.map(c =>
      `<option value="${c.id}" data-code="${Utils.escapeHtml(c.project_code)}"${c.id === prefilledClientId ? ' selected' : ''}>${Utils.escapeHtml(c.client_name)}</option>`
    ).join('')

    return `
      <div class="modal-body">

        ${isFromPA ? `
          <div class="pa-selected-chip">
            <span>🔗</span>
            <span>Linked: <strong>${Utils.getExpenseLabel(pa.expense_type)}</strong>
              — Est. ${Utils.formatCurrency(pa.estimated_amount)}
              ${pa.clients?.client_name ? `· ${Utils.escapeHtml(pa.clients.client_name)}` : ''}
            </span>
          </div>
        ` : ''}

        <p class="modal-section-label">Expense Details</p>
        <div class="form-group">
          <label class="form-label">Expense Type <span class="required">*</span></label>
          <select class="form-select" id="cl-expense-type" ${isFromPA ? 'disabled' : ''}>${expenseOptions}</select>
        </div>

        <p class="modal-section-label">Client</p>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Client</label>
            <select class="form-select" id="cl-client" ${isFromPA && prefilledClientId ? 'disabled' : ''}>
              <option value="">— No specific client —</option>
              ${clientOptions}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Project Code</label>
            <input class="form-input" type="text" id="cl-project-code"
              value="${Utils.escapeHtml(prefilledProjectCode)}"
              placeholder="Auto-filled on client select" readonly />
          </div>
        </div>
        <div class="form-group" id="cl-entity-wrap" style="display:none;">
          <label class="form-label">Entity</label>
          <select class="form-select" id="cl-entity">
            <option value="">— Select entity —</option>
          </select>
        </div>

        <p class="modal-section-label">Amount &amp; Date</p>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Actual Amount (₹) <span class="required">*</span></label>
            <input class="form-input" type="number" id="cl-amount" min="0" placeholder="0"
              value="${isFromPA && pa.estimated_amount ? pa.estimated_amount : ''}" />
            ${isFromPA && pa.estimated_amount
              ? `<p class="form-hint">Pre-approved est: ${Utils.formatCurrency(pa.estimated_amount)}</p>`
              : ''}
          </div>
          <div class="form-group">
            <label class="form-label">Expense Date <span class="required">*</span></label>
            <input class="form-input" type="date" id="cl-date" />
          </div>
        </div>

        <p class="modal-section-label">Receipt</p>
        <div class="form-group">
          <div class="drag-drop-zone" id="receipt-drop-zone"
            style="padding:20px;cursor:pointer;text-align:center;">
            <input type="file" id="receipt-file-input"
              accept=".pdf,.jpg,.jpeg,.png,.webp" style="display:none;" />
            <div style="font-size:28px;margin-bottom:8px;">🧾</div>
            <div class="drag-drop-label" style="font-size:13px;">
              Drop receipt here or <span style="color:var(--primary);">browse</span>
            </div>
            <div class="drag-drop-hint">PDF, JPG, PNG · Max 10 MB</div>
            <div id="receipt-chosen-name"
              style="display:none;margin-top:8px;font-size:13px;font-weight:500;color:var(--primary);"></div>
          </div>
          <div id="receipt-upload-row" style="display:none;margin-top:10px;">
            <button class="btn btn--secondary btn--sm" id="receipt-upload-btn">Upload to Drive</button>
            <span id="receipt-upload-status" class="text-sm text-muted"></span>
          </div>
          <div id="receipt-done" style="display:none;margin-top:10px;">
            <div class="receipt-preview">
              <span>📎</span>
              <a id="receipt-done-link" href="#" target="_blank" class="receipt-preview-name link">
                Receipt uploaded
              </a>
              <button class="btn btn--xs btn--ghost" id="receipt-remove-btn">Remove</button>
            </div>
          </div>
        </div>

        <p class="modal-section-label">Description</p>
        <div class="form-group">
          <label class="form-label">Description</label>
          <textarea class="form-input" id="cl-description" rows="2"
            placeholder="Brief description of the expense…" style="resize:vertical;"></textarea>
        </div>

      </div>
    `
  }

  function _bindClaimStep2() {
    // If pre-approval had a client, prefetch entities for that client
    if (_selectedPreApproval?.client_id) {
      _fetchEntitiesForModal(
        'cl-client', 'cl-entity-wrap', 'cl-entity', 'cl-project-code',
        _selectedPreApproval.client_id, _selectedPreApproval.entity_id,
      )
    }

    // Client change handler (only when not locked from PA)
    const clientEl = document.getElementById('cl-client')
    if (clientEl && !clientEl.disabled) {
      clientEl.addEventListener('change', () => {
        _fetchEntitiesForModal('cl-client', 'cl-entity-wrap', 'cl-entity', 'cl-project-code')
      })
    }

    // Receipt drop zone
    const dropZone  = document.getElementById('receipt-drop-zone')
    const fileInput = document.getElementById('receipt-file-input')

    dropZone?.addEventListener('click', () => fileInput?.click())

    fileInput?.addEventListener('change', e => {
      const file = e.target?.files?.[0]
      if (!file) return

      const chosenEl = document.getElementById('receipt-chosen-name')
      if (chosenEl) { chosenEl.textContent = file.name; chosenEl.style.display = 'block' }

      const uploadRow = document.getElementById('receipt-upload-row')
      if (uploadRow) {
        uploadRow.style.display    = 'flex'
        uploadRow.style.alignItems = 'center'
        uploadRow.style.gap        = '10px'
      }
    })

    document.getElementById('receipt-upload-btn')?.addEventListener('click', async () => {
      const file = document.getElementById('receipt-file-input')?.files?.[0]
      if (!file) { Utils.showToast('No file selected.', 'error'); return }

      const uploadBtn   = document.getElementById('receipt-upload-btn')
      const statusEl    = document.getElementById('receipt-upload-status')
      uploadBtn.disabled    = true
      uploadBtn.textContent = 'Uploading…'
      if (statusEl) statusEl.textContent = 'Sending to Google Drive…'

      // Gather context at upload time for Drive folder structure
      const clientEl     = document.getElementById('cl-client')
      const clientId     = clientEl?.value || _selectedPreApproval?.client_id || null
      const client       = clientId ? _clients.find(c => c.id === clientId) : null
      const clientName   = client?.client_name || _selectedPreApproval?.clients?.client_name || null
      const entityEl     = document.getElementById('cl-entity')
      const entityWrap   = document.getElementById('cl-entity-wrap')
      const entityName   = (entityWrap && entityWrap.style.display !== 'none' && entityEl?.value)
        ? entityEl.options[entityEl.selectedIndex]?.text
        : (_selectedPreApproval?.entity?.entity_name || null)
      const expenseDate  = document.getElementById('cl-date')?.value || null

      try {
        const url   = await _uploadReceipt(file, clientName, entityName, expenseDate)
        _receiptUrl = url

        document.getElementById('receipt-drop-zone').style.display  = 'none'
        document.getElementById('receipt-upload-row').style.display  = 'none'

        const doneEl   = document.getElementById('receipt-done')
        const doneLink = document.getElementById('receipt-done-link')
        if (doneEl)   doneEl.style.display   = 'block'
        if (doneLink) { doneLink.href = url; doneLink.textContent = file.name }

        document.getElementById('receipt-remove-btn')?.addEventListener('click', () => {
          _receiptUrl = null
          if (doneEl)   doneEl.style.display = 'none'
          const dropZ = document.getElementById('receipt-drop-zone')
          if (dropZ)   dropZ.style.display = 'block'
          const chosenEl = document.getElementById('receipt-chosen-name')
          if (chosenEl) { chosenEl.style.display = 'none'; chosenEl.textContent = '' }
          if (fileInput) fileInput.value = ''
        })
      } catch (err) {
        Utils.showToast('Receipt upload failed: ' + err.message, 'error')
        uploadBtn.disabled    = false
        uploadBtn.textContent = 'Upload to Drive'
        if (statusEl) statusEl.textContent = ''
      }
    })
  }

  /* Shared helper: fetches entities for a client and populates the entity dropdown */
  async function _fetchEntitiesForModal(clientElId, entityWrapId, entityElId, projectCodeElId, forceClientId = null, preselectedEntityId = null) {
    const clientEl     = document.getElementById(clientElId)
    const clientId     = forceClientId || clientEl?.value || ''
    const pcEl         = document.getElementById(projectCodeElId)
    const entityWrap   = document.getElementById(entityWrapId)
    const entityEl     = document.getElementById(entityElId)

    if (!clientId) {
      if (pcEl)       pcEl.value              = ''
      if (entityWrap) entityWrap.style.display = 'none'
      return
    }

    const client = _clients.find(c => c.id === clientId)
    if (pcEl && client) pcEl.value = client.project_code || ''

    const { data: full } = await API.getClient(clientId)
    // Deduplicate entities — nested joins (entity_platforms/services) can produce duplicate rows
    const _seen    = new Set()
    const entities = (full?.client_entities || []).filter(e => {
      if (_seen.has(e.id)) return false
      _seen.add(e.id)
      return true
    })

    if (entityWrap && entityEl) {
      if (entities.length > 1) {
        entityEl.innerHTML = '<option value="">— Select entity —</option>' +
          entities.map(e =>
            `<option value="${e.id}"${e.id === preselectedEntityId ? ' selected' : ''}>${Utils.escapeHtml(e.entity_name)}</option>`
          ).join('')
        entityWrap.style.display = 'block'
      } else {
        entityWrap.style.display = 'none'
      }
    }
  }

  /* Uploads receipt to Google Drive under Reimbursements/Client/Entity/Month/Day/ */
  async function _uploadReceipt(file, clientName = null, entityName = null, expenseDate = null) {
    const { data: { session } } = await Config.supabase.auth.getSession()
    if (!session?.access_token) throw new Error('Not authenticated')

    const formData = new FormData()
    formData.append('file', file)
    if (clientName)  formData.append('client_name',  clientName)
    if (entityName)  formData.append('entity_name',  entityName)
    if (expenseDate) formData.append('expense_date', expenseDate)

    const res    = await fetch(`${Config.SUPABASE_URL}/functions/v1/upload-receipt`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
      body:    formData,
    })
    const result = await res.json()
    if (!res.ok || result.error) throw new Error(result.error || result.msg || `HTTP ${res.status}`)
    return result.driveUrl
  }

  async function _submitClaim() {
    const btn         = document.getElementById('cl-submit-btn')
    const expenseType = document.getElementById('cl-expense-type').value
    const clientEl    = document.getElementById('cl-client')
    const clientId    = clientEl?.value || _selectedPreApproval?.client_id || null
    const entityWrap  = document.getElementById('cl-entity-wrap')
    const entityEl    = document.getElementById('cl-entity')
    const entityId    = (entityWrap && entityWrap.style.display !== 'none' && entityEl?.value)
      ? entityEl.value : (_selectedPreApproval?.entity_id || null)
    const amount      = parseFloat(document.getElementById('cl-amount').value)
    const date        = document.getElementById('cl-date').value
    const description = document.getElementById('cl-description').value.trim()

    if (!amount || amount <= 0) { Utils.showToast('Enter a valid amount.', 'error'); return }
    if (!date)                  { Utils.showToast('Select an expense date.', 'error'); return }

    // Warn if a file was selected but not uploaded yet
    const fileInput   = document.getElementById('receipt-file-input')
    const uploadRow   = document.getElementById('receipt-upload-row')
    const receiptDone = document.getElementById('receipt-done')
    const fileChosen  = fileInput?.files?.length > 0
    const uploaded    = receiptDone?.style.display !== 'none'
    if (fileChosen && !uploaded && !_receiptUrl) {
      Utils.showToast('Please click "Upload to Drive" to upload the receipt before submitting.', 'error')
      return
    }

    btn.disabled    = true
    btn.textContent = 'Submitting…'

    const client = clientId ? _clients.find(c => c.id === clientId) : null

    const { data: inserted, error } = await API.insertReimbursement({
      employee_id:       _user.id,
      type:              'claim',
      pre_approval_id:   _selectedPreApproval?.id || null,
      expense_type:      expenseType,
      client_id:         clientId,
      entity_id:         entityId,
      project_code:      client?.project_code || _selectedPreApproval?.clients?.project_code || null,
      amount,
      expense_date:      date,
      drive_receipt_url: _receiptUrl || null,
      reason:            description,
      status:            'pending',
    })

    if (error) {
      Utils.showToast('Failed to submit: ' + error.message, 'error')
      btn.disabled    = false
      btn.textContent = 'Submit Claim'
      return
    }

    // Notify reporting manager and HR only — Super Admin doesn't need to
    // know until HR has actually approved it (see the approval handler).
    const _notifMsg = `${_user.name} has filed an expense claim (${Utils.getExpenseLabel(expenseType)}, ${Utils.formatCurrency(amount)}) — please review.`
    const _notifPayload = { type: 'submitted', message: _notifMsg, module: 'reimbursements', record_id: inserted?.id || null }
    const _notified = new Set([_user.id])

    if (_user.manager_id && !_notified.has(_user.manager_id)) {
      _notified.add(_user.manager_id)
      API.createNotification({ recipient_employee_id: _user.manager_id, ..._notifPayload })
    }
    const { data: hrTeam } = await API.getEmployeesByDepartment('people_culture')
    ;(hrTeam || []).forEach(emp => {
      if (!_notified.has(emp.id)) {
        _notified.add(emp.id)
        API.createNotification({ recipient_employee_id: emp.id, ..._notifPayload })
      }
    })

    Utils.closeModal()
    Utils.showToast('Expense claim submitted.', 'success')
    _selectedPreApproval = null
    _receiptUrl          = null
    _loadMineTab()
  }

  return { render, init }
})()

ModuleRegistry.register({
  key:       'reimbursements',
  routeId:   'reimbursements',
  label:     'Reimbursements',
  order:     5,
  icon:      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>`,
  getModule: () => Reimbursements,
  features:  {
    raise_pre_approval:  'Raise Pre-Approval Request',
    raise_expense_claim: 'Raise Expense Claim',
  },
})
