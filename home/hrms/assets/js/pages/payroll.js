/* ============================================================
   HRMS — Payroll Module
   Tabs: Dashboard → Payroll Processing → Settings
   ============================================================ */

const Payroll = (() => {

  /* ── State ──────────────────────────────────────────────── */
  let _user        = null
  let _employees   = []   // all employees from DB
  let _components  = []   // all salary_components
  let _empSalaries = {}   // { employee_id: { component_id: amount } }
  let _activeTab   = 'dashboard'

  // Dashboard
  let _dashFilter  = 'active'

  // Processing
  let _procMonth   = null
  let _procYear    = null
  let _procRun     = null
  let _procRecords = []
  let _procFilter  = 'all'

  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December']

  const CLOSE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`

  /* ── Helpers ─────────────────────────────────────────────── */
  function _fmt(n) {
    if (n === null || n === undefined) return '—'
    return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  }

  function _fixedComponents() {
    return _components
      .filter(c => c.category === 'fixed' && c.is_active)
      .sort((a, b) => (a.display_order - b.display_order) || a.name.localeCompare(b.name))
  }

  function _monthlyForEmp(empId) {
    const salMap = _empSalaries[empId] || {}
    return _fixedComponents().reduce((sum, c) => sum + (salMap[c.id] || 0), 0)
  }

  function _adjLabel(type) {
    return { performance_bonus: 'Performance Bonus', incentive: 'Incentive', others: 'Others' }[type] || type
  }

  /* ── Render (shell) ─────────────────────────────────────── */
  function render(user) {
    _user = user
    return `
      <div class="page-inner">
        <div class="page-toolbar">
          <div class="tabs" id="payroll-tabs">
            <button class="tab-btn tab-btn--active" data-tab="dashboard">Dashboard</button>
            <button class="tab-btn" data-tab="processing">Payroll Processing</button>
            <button class="tab-btn" data-tab="settings">Settings</button>
          </div>
          <div id="payroll-toolbar-actions"></div>
        </div>
        <div id="payroll-content" class="mt-4">
          <div class="page-loading">Loading…</div>
        </div>
      </div>
    `
  }

  /* ── Init ────────────────────────────────────────────────── */
  async function init(user) {
    _user = user

    // Default processing view: previous month
    const now = new Date()
    if (now.getMonth() === 0) {
      _procMonth = 12
      _procYear  = now.getFullYear() - 1
    } else {
      _procMonth = now.getMonth()   // getMonth() is 0-indexed, previous month in 1-indexed
      _procYear  = now.getFullYear()
    }

    document.querySelectorAll('#payroll-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#payroll-tabs .tab-btn').forEach(b => b.classList.remove('tab-btn--active'))
        btn.classList.add('tab-btn--active')
        _activeTab = btn.dataset.tab
        _loadTab(_activeTab)
      })
    })

    await _loadCoreData()
    _loadTab('dashboard')
  }

  async function _loadCoreData() {
    const [emps, comps] = await Promise.all([_fetchEmployees(), _fetchComponents()])
    _employees  = emps
    _components = comps
    await _loadSalaries()
  }

  async function _loadSalaries() {
    const { data } = await Config.supabase
      .from('employee_salary_components')
      .select('employee_id, component_id, amount')
    _empSalaries = {}
    ;(data || []).forEach(r => {
      if (!_empSalaries[r.employee_id]) _empSalaries[r.employee_id] = {}
      _empSalaries[r.employee_id][r.component_id] = Number(r.amount) || 0
    })
  }

  function _loadTab(tab) {
    const toolbar = document.getElementById('payroll-toolbar-actions')
    if (toolbar) toolbar.innerHTML = ''
    if (tab === 'dashboard')  _loadDashboardTab()
    if (tab === 'processing') _loadProcessingTab()
    if (tab === 'settings')   _loadSettingsTab()
  }

  /* ════════════════════════════════════════════════════════════
     TAB 1 — DASHBOARD
  ════════════════════════════════════════════════════════════ */
  function _loadDashboardTab() {
    _renderDashboardTab()
  }

  function _renderDashboardTab() {
    const content = document.getElementById('payroll-content')
    if (!content) return

    const cols    = _fixedComponents()
    const emps    = _employees.filter(e => e.status === _dashFilter).sort((a, b) => a.name.localeCompare(b.name))

    const colHeaders = cols.map(c =>
      `<th style="text-align:right;white-space:nowrap;font-size:12px;">${Utils.escapeHtml(c.name)}</th>`
    ).join('')

    const rows = emps.map(e => {
      const salMap  = _empSalaries[e.id] || {}
      const monthly = cols.reduce((s, c) => s + (salMap[c.id] || 0), 0)
      const ctc     = monthly * 12
      const cells   = cols.map(c =>
        `<td style="text-align:right;font-size:12px;">${_fmt(salMap[c.id] || 0)}</td>`
      ).join('')
      return `
        <tr>
          <td>
            <div style="font-weight:500;font-size:13px;">${Utils.escapeHtml(e.name)}</div>
          </td>
          ${cells}
          <td style="text-align:right;font-size:12px;font-weight:600;">${_fmt(monthly)}</td>
          <td style="text-align:right;font-size:12px;font-weight:600;color:var(--primary);">${_fmt(ctc)}</td>
          <td>
            <button class="btn btn--xs btn--ghost" data-dash-edit="${e.id}">Edit</button>
          </td>
        </tr>
      `
    }).join('')

    content.innerHTML = `
      <div class="section-card">
        <div class="section-card-header" style="flex-wrap:wrap;gap:10px;">
          <h3 style="margin:0;">Compensation</h3>
          <div style="margin-left:auto;">
            <select class="form-input form-input--sm" id="dash-status-filter" style="width:130px;">
              <option value="active"   ${_dashFilter === 'active'   ? 'selected' : ''}>Active</option>
              <option value="inactive" ${_dashFilter === 'inactive' ? 'selected' : ''}>Inactive</option>
            </select>
          </div>
        </div>
        <div class="section-card-body" style="padding:0;overflow-x:auto;">
          ${emps.length ? `
            <table class="data-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  ${colHeaders}
                  <th style="text-align:right;">Monthly Salary</th>
                  <th style="text-align:right;">Annual CTC</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          ` : `<p class="empty-state" style="padding:24px 20px;">No ${_dashFilter} employees found.</p>`}
        </div>
      </div>
      ${cols.length === 0 ? `
        <div class="alert alert--info" style="margin-top:12px;">
          No salary components defined yet. Go to <strong>Settings</strong> to add components.
        </div>
      ` : ''}
    `

    document.getElementById('dash-status-filter')?.addEventListener('change', e => {
      _dashFilter = e.target.value
      _renderDashboardTab()
    })

    content.querySelectorAll('[data-dash-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const emp = _employees.find(e => e.id === btn.dataset.dashEdit)
        if (emp) _openDashEditModal(emp)
      })
    })
  }

  function _openDashEditModal(emp) {
    const cols   = _fixedComponents()
    const salMap = _empSalaries[emp.id] || {}

    const fields = cols.length ? cols.map(c => `
      <div class="form-group">
        <label class="form-label">${Utils.escapeHtml(c.name)}</label>
        <div class="input-wrapper">
          <span class="input-prefix">₹</span>
          <input class="form-input form-input--prefixed dash-comp-inp" type="number"
            min="0" step="1" data-comp-id="${c.id}" id="dci-${c.id}"
            value="${salMap[c.id] || 0}">
        </div>
      </div>
    `).join('') : `<p class="empty-state">No fixed components defined. Add them in Settings first.</p>`

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Edit Salary — ${Utils.escapeHtml(emp.name)}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">${CLOSE_SVG}</button>
      </div>
      <div class="modal-body" style="padding:20px 24px;">
        <div id="dash-modal-err" class="alert alert--danger" style="display:none;margin-bottom:14px;"></div>
        ${cols.length ? `
          <div class="hrms-form-grid">${fields}</div>
          <div class="hrms-salary-summary" id="dash-modal-summary" style="margin-top:18px;">
            ${_dashSummaryHtml(cols, salMap)}
          </div>
        ` : fields}
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        ${cols.length ? `<button class="btn btn--primary" id="dash-save-btn">Save</button>` : ''}
      </div>
    `, 'dash-edit-modal')

    document.querySelectorAll('.dash-comp-inp').forEach(inp => {
      inp.addEventListener('input', () => {
        const live = {}
        document.querySelectorAll('.dash-comp-inp').forEach(i => {
          live[i.dataset.compId] = parseFloat(i.value) || 0
        })
        const el = document.getElementById('dash-modal-summary')
        if (el) el.innerHTML = _dashSummaryHtml(cols, live)
      })
    })

    document.getElementById('dash-save-btn')?.addEventListener('click', () => _saveDashSalary(emp, cols))
  }

  function _dashSummaryHtml(cols, salMap) {
    const monthly = cols.reduce((s, c) => s + (Number(salMap[c.id]) || 0), 0)
    return `
      <div class="hrms-summary-row">
        <span>Monthly Salary</span>
        <strong>${_fmt(monthly)}</strong>
      </div>
      <div class="hrms-summary-row hrms-summary-row--net">
        <span>Annual CTC</span>
        <strong>${_fmt(monthly * 12)}</strong>
      </div>
    `
  }

  async function _saveDashSalary(emp, cols) {
    const errEl = document.getElementById('dash-modal-err')
    const btn   = document.getElementById('dash-save-btn')
    errEl.style.display = 'none'
    btn.disabled    = true
    btn.textContent = 'Saving…'

    const upserts = cols.map(c => ({
      employee_id:  emp.id,
      component_id: c.id,
      amount:       parseFloat(document.getElementById(`dci-${c.id}`)?.value) || 0,
      updated_by:   _user.id,
      updated_at:   new Date().toISOString(),
    }))

    const { error } = await Config.supabase
      .from('employee_salary_components')
      .upsert(upserts, { onConflict: 'employee_id,component_id' })

    btn.disabled    = false
    btn.textContent = 'Save'

    if (error) {
      errEl.textContent   = error.message || 'Failed to save.'
      errEl.style.display = 'block'
      return
    }

    Utils.closeModal()
    Utils.showToast(`Salary updated for ${emp.name}.`, 'success')
    await _loadSalaries()
    _renderDashboardTab()
  }

  /* ════════════════════════════════════════════════════════════
     TAB 2 — PAYROLL PROCESSING
  ════════════════════════════════════════════════════════════ */
  async function _loadProcessingTab() {
    const content = document.getElementById('payroll-content')
    if (content) content.innerHTML = '<div class="page-loading">Loading…</div>'
    await _fetchProcessingData()
    _renderProcessingTab()
  }

  async function _fetchProcessingData() {
    const { data: run } = await Config.supabase
      .from('payroll_runs')
      .select('*')
      .eq('month', _procMonth)
      .eq('year',  _procYear)
      .maybeSingle()

    _procRun = run

    if (!run) { _procRecords = []; return }

    const { data: records } = await Config.supabase
      .from('payroll_records')
      .select(`*, employee:employees!employee_id(id, name, designation), adj_items:payroll_adjustments(*)`)
      .eq('payroll_run_id', run.id)
      .order('employment_status')

    _procRecords = records || []
  }

  function _renderProcessingTab() {
    const content = document.getElementById('payroll-content')
    if (!content) return

    const yearOpts = []
    const thisYear = new Date().getFullYear()
    for (let y = thisYear - 2; y <= thisYear + 1; y++) {
      yearOpts.push(`<option value="${y}" ${y === _procYear ? 'selected' : ''}>${y}</option>`)
    }
    const monthOpts = MONTHS.map((m, i) =>
      `<option value="${i + 1}" ${i + 1 === _procMonth ? 'selected' : ''}>${m}</option>`
    ).join('')

    let records = _procRecords
    if (_procFilter === 'active')   records = _procRecords.filter(r => r.employment_status === 'active')
    if (_procFilter === 'inactive') records = _procRecords.filter(r => r.employment_status === 'inactive')

    const rows = records.map(r => {
      const emp      = r.employee || {}
      const adjItems = r.adj_items || []
      const adjTotal = adjItems.reduce((s, a) => s + Number(a.amount), 0)
      const statusBadge = r.employment_status === 'active'
        ? `<span class="badge badge--success" style="font-size:10px;">Active</span>`
        : `<span class="badge badge--muted"   style="font-size:10px;">Inactive</span>`
      const payColor = { pending: 'var(--warning-text,#92400E)', paid: '#1D9E75', hold: 'var(--danger)' }[r.payment_status] || ''

      return `
        <tr>
          <td>
            <div style="font-weight:500;font-size:13px;">${Utils.escapeHtml(emp.name || '—')}</div>
            <div style="font-size:11px;color:var(--text-muted);">${Utils.escapeHtml(emp.designation || '')}</div>
          </td>
          <td>${statusBadge}</td>
          <td style="text-align:right;font-size:12px;">${_fmt(r.monthly_salary)}</td>
          <td style="text-align:center;font-size:12px;">${r.days_payable}&nbsp;/&nbsp;30</td>
          <td style="text-align:right;font-size:12px;">${_fmt(r.prorated_salary)}</td>
          <td style="text-align:right;font-size:12px;color:var(--danger);">${r.deductions > 0 ? '− ' + _fmt(r.deductions) : '—'}</td>
          <td style="text-align:right;font-size:12px;">
            <span style="color:#1D9E75;">${adjTotal > 0 ? '+ ' + _fmt(adjTotal) : '—'}</span>
            <button class="btn btn--xs btn--ghost" data-open-adj="${r.id}" style="margin-left:4px;" title="Manage adjustments">+</button>
          </td>
          <td style="text-align:right;font-size:13px;font-weight:700;">${_fmt(r.net_pay)}</td>
          <td>
            <select class="form-input form-input--sm proc-status-sel" data-rec="${r.id}"
              style="font-size:11px;padding:3px 6px;min-width:90px;color:${payColor};">
              <option value="pending" ${r.payment_status==='pending'?'selected':''}>Pending</option>
              <option value="paid"    ${r.payment_status==='paid'   ?'selected':''}>Paid</option>
              <option value="hold"    ${r.payment_status==='hold'   ?'selected':''}>Hold</option>
            </select>
          </td>
          <td>
            <input type="date" class="form-input form-input--sm proc-date-inp" data-rec="${r.id}"
              value="${r.payment_date || ''}" style="font-size:11px;padding:3px 6px;min-width:120px;">
          </td>
          <td>
            <button class="btn btn--xs btn--ghost" data-proc-edit="${r.id}">Edit</button>
          </td>
        </tr>
      `
    }).join('')

    content.innerHTML = `
      <div class="section-card mb-4" style="padding:14px 18px;">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <select class="form-input form-input--sm" id="proc-month-sel" style="width:130px;">${monthOpts}</select>
          <select class="form-input form-input--sm" id="proc-year-sel"  style="width:88px;">${yearOpts.join('')}</select>
          <select class="form-input form-input--sm" id="proc-emp-filter" style="width:140px;">
            <option value="all"      ${_procFilter==='all'     ?'selected':''}>All Employees</option>
            <option value="active"   ${_procFilter==='active'  ?'selected':''}>Active Only</option>
            <option value="inactive" ${_procFilter==='inactive'?'selected':''}>Inactive Only</option>
          </select>
          <div style="margin-left:auto;display:flex;gap:8px;align-items:center;">
            ${!_procRun ? `<button class="btn btn--primary btn--sm" id="proc-gen-btn">Generate Payroll</button>` : ''}
            ${_procRun?.status === 'draft'
              ? `<span class="badge badge--muted">Draft</span>
                 <button class="btn btn--ghost btn--sm" id="proc-finalize-btn">Finalize</button>`
              : _procRun?.status === 'finalized'
              ? `<span class="badge badge--success">Finalized</span>`
              : ''}
          </div>
        </div>
      </div>

      <div class="section-card">
        <div class="section-card-body" style="padding:0;overflow-x:auto;">
          ${_procRun
            ? (records.length
              ? `<table class="data-table">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Status</th>
                      <th style="text-align:right;">Monthly Salary</th>
                      <th style="text-align:center;">Days</th>
                      <th style="text-align:right;">Prorated</th>
                      <th style="text-align:right;">Deductions</th>
                      <th style="text-align:right;">Adjustments</th>
                      <th style="text-align:right;">Net Pay</th>
                      <th>Payment Status</th>
                      <th>Payment Date</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>${rows}</tbody>
                </table>`
              : `<p class="empty-state" style="padding:24px;">No records match the selected filter.</p>`)
            : `<p class="empty-state" style="padding:24px;">
                No payroll generated for ${MONTHS[_procMonth - 1]} ${_procYear}.
                Click <strong>Generate Payroll</strong> to create it.
              </p>`
          }
        </div>
      </div>
    `

    // Month / Year / Filter changes
    document.getElementById('proc-month-sel')?.addEventListener('change', async e => {
      _procMonth = parseInt(e.target.value)
      await _loadProcessingTab()
    })
    document.getElementById('proc-year-sel')?.addEventListener('change', async e => {
      _procYear = parseInt(e.target.value)
      await _loadProcessingTab()
    })
    document.getElementById('proc-emp-filter')?.addEventListener('change', e => {
      _procFilter = e.target.value
      _renderProcessingTab()
    })

    // Generate payroll
    document.getElementById('proc-gen-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('proc-gen-btn')
      btn.disabled    = true
      btn.textContent = 'Generating…'
      const { error } = await Config.supabase.rpc('generate_monthly_payroll', {
        p_month: _procMonth,
        p_year:  _procYear,
      })
      if (error) {
        Utils.showToast('Failed: ' + error.message, 'error')
        btn.disabled    = false
        btn.textContent = 'Generate Payroll'
      } else {
        Utils.showToast('Payroll generated.', 'success')
        await _loadProcessingTab()
      }
    })

    // Finalize
    document.getElementById('proc-finalize-btn')?.addEventListener('click', async () => {
      if (!confirm(`Finalize payroll for ${MONTHS[_procMonth - 1]} ${_procYear}?\n\nThis will lock the run from further changes.`)) return
      const { error } = await Config.supabase
        .from('payroll_runs')
        .update({ status: 'finalized' })
        .eq('id', _procRun.id)
      if (error) { Utils.showToast('Failed: ' + error.message, 'error'); return }
      Utils.showToast('Payroll finalized.', 'success')
      await _loadProcessingTab()
    })

    // Payment status inline update
    content.querySelectorAll('.proc-status-sel').forEach(sel => {
      sel.addEventListener('change', async e => {
        const { error } = await Config.supabase
          .from('payroll_records')
          .update({ payment_status: e.target.value, updated_at: new Date().toISOString() })
          .eq('id', sel.dataset.rec)
        if (error) Utils.showToast('Failed to update status.', 'error')
        else {
          const rec = _procRecords.find(r => r.id === sel.dataset.rec)
          if (rec) rec.payment_status = e.target.value
        }
      })
    })

    // Payment date inline update
    content.querySelectorAll('.proc-date-inp').forEach(inp => {
      inp.addEventListener('change', async e => {
        const { error } = await Config.supabase
          .from('payroll_records')
          .update({ payment_date: e.target.value || null, updated_at: new Date().toISOString() })
          .eq('id', inp.dataset.rec)
        if (error) Utils.showToast('Failed to update date.', 'error')
      })
    })

    // Adjustments
    content.querySelectorAll('[data-open-adj]').forEach(btn => {
      btn.addEventListener('click', () => {
        const rec = _procRecords.find(r => r.id === btn.dataset.openAdj)
        if (rec) _openAdjModal(rec)
      })
    })

    // Edit record
    content.querySelectorAll('[data-proc-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const rec = _procRecords.find(r => r.id === btn.dataset.procEdit)
        if (rec) _openEditRecordModal(rec)
      })
    })
  }

  /* ── Adjustments modal ───────────────────────────────────── */
  function _openAdjModal(rec) {
    const emp      = rec.employee || {}
    const adjItems = rec.adj_items || []

    const existingRows = adjItems.map(a => `
      <div class="hrms-adj-row" id="adjrow-${a.id}">
        <span class="badge badge--muted" style="font-size:10px;white-space:nowrap;">${_adjLabel(a.type)}</span>
        <span style="font-size:13px;font-weight:600;white-space:nowrap;">${_fmt(a.amount)}</span>
        <span style="font-size:12px;color:var(--text-muted);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${Utils.escapeHtml(a.remark)}">${Utils.escapeHtml(a.remark)}</span>
        <button class="btn btn--xs btn--danger-ghost" data-del-adj="${a.id}">Remove</button>
      </div>
    `).join('')

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Adjustments — ${Utils.escapeHtml(emp.name || '')}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">${CLOSE_SVG}</button>
      </div>
      <div class="modal-body" style="padding:20px 24px;">
        <div id="adj-err" class="alert alert--danger" style="display:none;margin-bottom:14px;"></div>

        ${adjItems.length ? `
          <div style="margin-bottom:20px;">
            <div class="hrms-section-label" style="margin-bottom:10px;">Existing Adjustments</div>
            <div style="display:flex;flex-direction:column;gap:8px;">${existingRows}</div>
          </div>
        ` : ''}

        <div class="hrms-section-label" style="margin-bottom:12px;">Add Adjustment</div>
        <div class="hrms-form-grid" style="margin-bottom:14px;">
          <div class="form-group">
            <label class="form-label">Type</label>
            <select class="form-input" id="adj-type">
              <option value="performance_bonus">Performance Bonus</option>
              <option value="incentive">Incentive</option>
              <option value="others">Others</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Amount (₹)</label>
            <div class="input-wrapper">
              <span class="input-prefix">₹</span>
              <input class="form-input form-input--prefixed" type="number" id="adj-amount" min="0" placeholder="0">
            </div>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Remark <span class="required">*</span></label>
          <input class="form-input" type="text" id="adj-remark" placeholder="e.g. Q2 performance bonus">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Close</button>
        <button class="btn btn--primary" id="adj-add-btn">Add Adjustment</button>
      </div>
    `, 'adj-modal')

    // Remove existing adjustment
    document.querySelectorAll('[data-del-adj]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const adjId = btn.dataset.delAdj
        btn.disabled = true
        const { error } = await Config.supabase.from('payroll_adjustments').delete().eq('id', adjId)
        if (error) { Utils.showToast('Failed to remove.', 'error'); btn.disabled = false; return }
        rec.adj_items = (rec.adj_items || []).filter(a => a.id !== adjId)
        document.getElementById(`adjrow-${adjId}`)?.remove()
        await _recalcAndSync(rec)
        _renderProcessingTab()
      })
    })

    // Add adjustment
    document.getElementById('adj-add-btn').addEventListener('click', async () => {
      const errEl  = document.getElementById('adj-err')
      errEl.style.display = 'none'
      const type   = document.getElementById('adj-type').value
      const amount = parseFloat(document.getElementById('adj-amount').value) || 0
      const remark = document.getElementById('adj-remark').value.trim()

      if (!amount) { errEl.textContent = 'Please enter an amount.'; errEl.style.display = 'block'; return }
      if (!remark) { errEl.textContent = 'Remark is required.';     errEl.style.display = 'block'; return }

      const btn = document.getElementById('adj-add-btn')
      btn.disabled    = true
      btn.textContent = 'Adding…'

      const { data, error } = await Config.supabase
        .from('payroll_adjustments')
        .insert({ payroll_record_id: rec.id, type, amount, remark, created_by: _user.id })
        .select()
        .single()

      btn.disabled    = false
      btn.textContent = 'Add Adjustment'

      if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return }

      rec.adj_items = [...(rec.adj_items || []), data]
      await _recalcAndSync(rec)
      Utils.closeModal()
      Utils.showToast('Adjustment added.', 'success')
      _renderProcessingTab()
    })
  }

  async function _recalcAndSync(rec) {
    const adjTotal = (rec.adj_items || []).reduce((s, a) => s + Number(a.amount), 0)
    const netPay   = Number(rec.prorated_salary) - Number(rec.deductions) + adjTotal
    await Config.supabase
      .from('payroll_records')
      .update({ adjustments: adjTotal, net_pay: netPay, updated_at: new Date().toISOString() })
      .eq('id', rec.id)
    rec.adjustments = adjTotal
    rec.net_pay     = netPay
  }

  /* ── Edit record modal (manual override + audit log) ─────── */
  function _openEditRecordModal(rec) {
    const emp = rec.employee || {}

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Edit Record — ${Utils.escapeHtml(emp.name || '')}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">${CLOSE_SVG}</button>
      </div>
      <div class="modal-body" style="padding:20px 24px;">
        <div id="edit-err" class="alert alert--danger" style="display:none;margin-bottom:14px;"></div>

        <div class="section-card" style="margin-bottom:18px;padding:14px 16px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12px;">
            <div><div style="color:var(--text-muted);margin-bottom:2px;">Monthly Salary</div><strong>${_fmt(rec.monthly_salary)}</strong></div>
            <div><div style="color:var(--text-muted);margin-bottom:2px;">Days Payable</div><strong>${rec.days_payable} / 30</strong></div>
            <div><div style="color:var(--text-muted);margin-bottom:2px;">Prorated Salary</div><strong>${_fmt(rec.prorated_salary)}</strong></div>
            <div><div style="color:var(--text-muted);margin-bottom:2px;">Unpaid Leave Days</div><strong>${rec.unpaid_leave_days}</strong></div>
          </div>
        </div>

        <div class="form-group" style="margin-bottom:14px;">
          <label class="form-label">Deductions Override (₹)</label>
          <div class="input-wrapper">
            <span class="input-prefix">₹</span>
            <input class="form-input form-input--prefixed" type="number" id="edit-deductions"
              value="${rec.deductions}" min="0">
          </div>
          <div class="form-hint">Original auto-calculated value: ${_fmt(rec.deductions)}</div>
        </div>

        <div class="form-group">
          <label class="form-label">Reason for manual change <span class="required">*</span></label>
          <input class="form-input" type="text" id="edit-remark"
            placeholder="e.g. Leave record correction, attendance adjustment…">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="edit-save-btn">Save Change</button>
      </div>
    `, 'edit-rec-modal')

    document.getElementById('edit-save-btn').addEventListener('click', async () => {
      const errEl      = document.getElementById('edit-err')
      errEl.style.display = 'none'
      const remark     = document.getElementById('edit-remark').value.trim()
      const deductions = parseFloat(document.getElementById('edit-deductions').value) || 0

      if (!remark) {
        errEl.textContent   = 'A reason is required for manual edits (saved to audit log).'
        errEl.style.display = 'block'
        return
      }

      const btn = document.getElementById('edit-save-btn')
      btn.disabled    = true
      btn.textContent = 'Saving…'

      const adjTotal = (rec.adj_items || []).reduce((s, a) => s + Number(a.amount), 0)
      const newNet   = Number(rec.prorated_salary) - deductions + adjTotal

      const [upd, log] = await Promise.all([
        Config.supabase.from('payroll_records').update({
          deductions,
          net_pay:    newNet,
          updated_at: new Date().toISOString(),
        }).eq('id', rec.id),
        Config.supabase.from('payroll_audit_log').insert({
          payroll_record_id: rec.id,
          field_name:        'deductions',
          original_value:    String(rec.deductions),
          updated_value:     String(deductions),
          remark,
          changed_by:        _user.id,
        }),
      ])

      btn.disabled    = false
      btn.textContent = 'Save Change'

      if (upd.error) {
        errEl.textContent   = upd.error.message
        errEl.style.display = 'block'
        return
      }

      Utils.closeModal()
      Utils.showToast('Record updated.', 'success')
      await _loadProcessingTab()
    })
  }

  /* ════════════════════════════════════════════════════════════
     TAB 3 — SETTINGS
  ════════════════════════════════════════════════════════════ */
  function _loadSettingsTab() {
    const toolbar = document.getElementById('payroll-toolbar-actions')
    if (toolbar) {
      toolbar.innerHTML = `<button class="btn btn--primary btn--sm" id="settings-add-btn">+ Add Component</button>`
      document.getElementById('settings-add-btn').addEventListener('click', () => _openComponentModal(null))
    }
    _renderSettingsTab()
  }

  function _renderSettingsTab() {
    const content = document.getElementById('payroll-content')
    if (!content) return

    const fixed    = _components.filter(c => c.category === 'fixed')
    const variable = _components.filter(c => c.category === 'variable')

    const renderGroup = (title, list) => {
      if (!list.length) return ''
      const rows = list.map(c => `
        <tr>
          <td style="font-weight:500;font-size:13px;">${Utils.escapeHtml(c.name)}</td>
          <td>
            <span class="badge badge--${c.category === 'fixed' ? 'primary' : 'muted'}" style="font-size:10px;text-transform:capitalize;">${c.category}</span>
          </td>
          <td>
            <span class="badge badge--${c.is_active ? 'success' : 'muted'}" style="font-size:10px;">
              ${c.is_active ? 'Active' : 'Inactive'}
            </span>
          </td>
          <td style="text-align:right;white-space:nowrap;">
            <button class="btn btn--xs btn--ghost" data-comp-edit="${c.id}" style="margin-right:4px;">Edit</button>
            <button class="btn btn--xs btn--ghost" data-comp-toggle="${c.id}" data-is-active="${c.is_active}">
              ${c.is_active ? 'Disable' : 'Enable'}
            </button>
            <button class="btn btn--xs btn--danger-ghost" data-comp-delete="${c.id}" style="margin-left:4px;">Delete</button>
          </td>
        </tr>
      `).join('')
      return `
        <div class="hrms-section-label" style="margin-bottom:10px;">${title}</div>
        <div class="section-card mb-4">
          <div class="section-card-body" style="padding:0;">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Component Name</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th style="text-align:right;">Actions</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      `
    }

    content.innerHTML = _components.length
      ? renderGroup('Fixed Components', fixed) + renderGroup('Variable Components', variable)
      : `<div class="section-card">
           <div class="section-card-body">
             <p class="empty-state">No salary components yet. Click "+ Add Component" to get started.</p>
           </div>
         </div>`

    content.querySelectorAll('[data-comp-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const comp = _components.find(c => c.id === btn.dataset.compEdit)
        if (comp) _openComponentModal(comp)
      })
    })

    content.querySelectorAll('[data-comp-toggle]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const isActive = btn.dataset.isActive === 'true'
        btn.disabled   = true
        const { error } = await Config.supabase
          .from('salary_components')
          .update({ is_active: !isActive, updated_at: new Date().toISOString() })
          .eq('id', btn.dataset.compToggle)
        if (error) { Utils.showToast('Failed to update.', 'error'); btn.disabled = false; return }
        await _refreshComponents()
        _renderSettingsTab()
      })
    })

    content.querySelectorAll('[data-comp-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const comp = _components.find(c => c.id === btn.dataset.compDelete)
        if (!confirm(`Delete "${comp?.name}"?\n\nThis will also remove all salary values for this component across all employees. This cannot be undone.`)) return
        btn.disabled = true
        const { error } = await Config.supabase.from('salary_components').delete().eq('id', btn.dataset.compDelete)
        if (error) { Utils.showToast('Delete failed: ' + error.message, 'error'); btn.disabled = false; return }
        Utils.showToast('Component deleted.', 'success')
        await _refreshComponents()
        _renderSettingsTab()
      })
    })
  }

  function _openComponentModal(comp) {
    const isEdit = !!comp
    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">${isEdit ? 'Edit Component' : 'Add Salary Component'}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">${CLOSE_SVG}</button>
      </div>
      <div class="modal-body" style="padding:20px 24px;">
        <div id="comp-err" class="alert alert--danger" style="display:none;margin-bottom:14px;"></div>
        <div class="form-group" style="margin-bottom:16px;">
          <label class="form-label">Component Name <span class="required">*</span></label>
          <input class="form-input" type="text" id="comp-name"
            placeholder="e.g. Basic Pay, HRA, Travel Allowance"
            value="${Utils.escapeHtml(comp?.name || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">Category <span class="required">*</span></label>
          <select class="form-input" id="comp-category">
            <option value="fixed"    ${(!comp || comp.category === 'fixed')    ? 'selected' : ''}>Fixed</option>
            <option value="variable" ${comp?.category === 'variable' ? 'selected' : ''}>Variable</option>
          </select>
          <div class="form-hint">
            <strong>Fixed</strong> — appears as a column in the Dashboard (e.g. Basic Pay, HRA).<br>
            <strong>Variable</strong> — used as adjustment type in Payroll Processing (e.g. Performance Bonus).
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="comp-save-btn">${isEdit ? 'Save Changes' : 'Add Component'}</button>
      </div>
    `, 'comp-modal')

    document.getElementById('comp-save-btn').addEventListener('click', () => _submitComponent(comp))
  }

  async function _submitComponent(existing) {
    const errEl    = document.getElementById('comp-err')
    errEl.style.display = 'none'
    const name     = document.getElementById('comp-name').value.trim()
    const category = document.getElementById('comp-category').value
    if (!name) { errEl.textContent = 'Component name is required.'; errEl.style.display = 'block'; return }

    const btn = document.getElementById('comp-save-btn')
    btn.disabled    = true
    btn.textContent = 'Saving…'

    const payload = { name, category, updated_at: new Date().toISOString() }
    const { error } = existing
      ? await Config.supabase.from('salary_components').update(payload).eq('id', existing.id)
      : await Config.supabase.from('salary_components').insert({ ...payload, is_active: true, display_order: _components.length })

    btn.disabled    = false
    btn.textContent = existing ? 'Save Changes' : 'Add Component'

    if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return }

    Utils.closeModal()
    Utils.showToast(existing ? 'Component updated.' : 'Component added.', 'success')
    await _refreshComponents()
    _renderSettingsTab()
  }

  async function _refreshComponents() {
    _components = await _fetchComponents()
  }

  /* ── DB helpers ──────────────────────────────────────────── */
  async function _fetchEmployees() {
    const { data } = await Config.supabase
      .from('employees')
      .select('id, name, designation, status, deactivated_at')
      .order('name')
    return data || []
  }

  async function _fetchComponents() {
    const { data } = await Config.supabase
      .from('salary_components')
      .select('*')
      .order('display_order')
      .order('name')
    return data || []
  }

  return { render, init }

})()
