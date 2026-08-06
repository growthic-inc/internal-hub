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

  // Appraisal workflow (Management department only)
  let _appraisals         = []      // employee_compensation rows with reason='appraisal'
  let _isHR                = false  // can give the first (HR) approval
  let _isManagement        = false  // can give the final (Management) approval
  let _eligibleEmployees   = []     // active employees eligible for the appraisal workflow

  // Dashboard
  let _dashFilter  = 'active'
  let _dashView    = 'detailed'   // 'detailed' | 'summary'

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
    return '₹' + Math.round(Number(n)).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  }

  function _fixedComponents() {
    return _components
      .filter(c => c.category === 'fixed' && c.is_active)
      .sort((a, b) => (a.display_order - b.display_order) || a.name.localeCompare(b.name))
  }

  function _variableComponents() {
    return _components
      .filter(c => c.category === 'variable' && c.is_active)
      .sort((a, b) => (a.display_order - b.display_order) || a.name.localeCompare(b.name))
  }

  function _monthlyForEmp(empId) {
    const salMap     = _empSalaries[empId] || {}
    const annualFixed = _fixedComponents().reduce((sum, c) => sum + (salMap[c.id] || 0), 0)
    return Math.round(annualFixed / 12)
  }

  // Yearly CTC = Fixed + Variable components combined, annual (not divided
  // by 12 — unlike Fixed Monthly, this is meant to read as a yearly figure).
  function _annualCtcFromMap(componentMap) {
    const map = componentMap || {}
    return [..._fixedComponents(), ..._variableComponents()]
      .reduce((sum, c) => sum + (Number(map[c.id]) || 0), 0)
  }
  function _annualCtcForEmp(empId) {
    return _annualCtcFromMap(_empSalaries[empId])
  }

  function _adjLabel(type) {
    return { performance_bonus: 'Performance Bonus', incentive: 'Incentive', others: 'Others', arrears: 'Arrears' }[type] || type
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
            <button class="tab-btn" data-tab="appraisals">Appraisals</button>
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
    const [emps, comps, depts] = await Promise.all([_fetchEmployees(), _fetchComponents(), _fetchDepartments()])
    _employees  = emps
    _components = comps
    await _loadSalaries()

    const mgmtDept = depts.find(d => d.system_key === 'management')
    const hrDept   = depts.find(d => d.system_key === 'people_culture')

    _eligibleEmployees = _employees.filter(e => e.status === 'active')
    _isManagement = !!(mgmtDept && _user && _user.department_id === mgmtDept.id)
    _isHR         = !!(_user && (_user.role === 'super_admin' || (hrDept && _user.department_id === hrDept.id)))
  }

  async function _fetchDepartments() {
    const { data } = await Config.supabase.from('departments').select('id, system_key')
    return data || []
  }

  async function _loadSalaries() {
    // Only the currently-open, approved entry per employee — the table
    // can also hold closed history plus pending/rejected appraisal rows.
    const { data } = await Config.supabase
      .from('employee_compensation')
      .select('employee_id, components')
      .eq('status', 'approved')
      .is('effective_to', null)
    _empSalaries = {}
    ;(data || []).forEach(r => {
      const comps = r.components || {}
      _empSalaries[r.employee_id] = {}
      Object.keys(comps).forEach(componentId => {
        _empSalaries[r.employee_id][componentId] = Number(comps[componentId]) || 0
      })
    })
  }

  function _loadTab(tab) {
    const toolbar = document.getElementById('payroll-toolbar-actions')
    if (toolbar) toolbar.innerHTML = ''
    if (tab === 'dashboard')   _loadDashboardTab()
    if (tab === 'processing')  _loadProcessingTab()
    if (tab === 'appraisals')  _loadAppraisalsTab()
    if (tab === 'settings')    _loadSettingsTab()
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

    const fixedCols   = _fixedComponents()
    const varCols     = _variableComponents()
    const emps        = _employees.filter(e => e.status === _dashFilter).sort((a, b) => a.name.localeCompare(b.name))
    const isDetailed  = _dashView === 'detailed'

    const colHeaders = isDetailed ? (
      fixedCols.map(c =>
        `<th style="text-align:right;white-space:nowrap;font-size:12px;">${Utils.escapeHtml(c.name)}</th>`
      ).join('') +
      varCols.map((c, i) =>
        `<th style="text-align:right;white-space:nowrap;font-size:12px;${i === 0 ? 'border-left:2px solid var(--border);padding-left:12px;' : ''}">${Utils.escapeHtml(c.name)}</th>`
      ).join('')
    ) : ''

    const rows = emps.map(e => {
      const salMap      = _empSalaries[e.id] || {}
      const annualFixed = fixedCols.reduce((s, c) => s + (salMap[c.id] || 0), 0)
      const annualVar   = varCols.reduce((s, c) => s + (salMap[c.id] || 0), 0)
      const monthly     = Math.round(annualFixed / 12)
      const ctc         = annualFixed + annualVar

      const compCells = isDetailed ? (
        fixedCols.map(c =>
          `<td style="text-align:right;font-size:12px;">${_fmt(salMap[c.id] ?? 0)}</td>`
        ).join('') +
        varCols.map((c, i) =>
          `<td style="text-align:right;font-size:12px;${i === 0 ? 'border-left:2px solid var(--border);padding-left:12px;' : ''}">${_fmt(salMap[c.id] ?? 0)}</td>`
        ).join('')
      ) : ''

      return `
        <tr>
          <td><div style="font-weight:500;font-size:13px;">${Utils.escapeHtml(e.name)}</div></td>
          ${compCells}
          <td style="text-align:right;font-size:12px;font-weight:600;">${_fmt(monthly)}</td>
          <td style="text-align:right;font-size:12px;font-weight:600;color:var(--primary);">${_fmt(ctc)}</td>
          <td><button class="btn btn--xs btn--ghost" data-dash-edit="${e.id}">Edit</button></td>
        </tr>
      `
    }).join('')

    const viewToggle = `
      <div style="display:flex;gap:4px;">
        <button class="btn btn--sm ${isDetailed ? 'btn--primary' : 'btn--ghost'}" id="dash-view-detailed" title="Show all components">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:4px;"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>Detailed
        </button>
        <button class="btn btn--sm ${!isDetailed ? 'btn--primary' : 'btn--ghost'}" id="dash-view-summary" title="Show totals only">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:4px;"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>Summary
        </button>
      </div>
    `

    content.innerHTML = `
      <div class="section-card">
        <div class="section-card-header" style="flex-wrap:wrap;gap:10px;">
          <h3 style="margin:0;">Compensation</h3>
          <div style="margin-left:auto;display:flex;align-items:center;gap:8px;">
            ${viewToggle}
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
      ${fixedCols.length === 0 ? `
        <div class="alert alert--info" style="margin-top:12px;">
          No salary components defined yet. Go to <strong>Settings</strong> to add components.
        </div>
      ` : ''}
    `

    document.getElementById('dash-status-filter')?.addEventListener('change', e => {
      _dashFilter = e.target.value
      _renderDashboardTab()
    })

    document.getElementById('dash-view-detailed')?.addEventListener('click', () => {
      _dashView = 'detailed'
      _renderDashboardTab()
    })

    document.getElementById('dash-view-summary')?.addEventListener('click', () => {
      _dashView = 'summary'
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
    const fixedCols = _fixedComponents()
    const varCols   = _variableComponents()
    const salMap    = _empSalaries[emp.id] || {}

    const _inputField = c => `
      <div class="form-group">
        <label class="form-label">${Utils.escapeHtml(c.name)}</label>
        <div class="input-wrapper">
          <span class="input-prefix">₹</span>
          <input class="form-input form-input--prefixed dash-comp-inp" type="number"
            min="0" step="0.01" data-comp-id="${c.id}" data-comp-cat="${c.category}" id="dci-${c.id}"
            placeholder="0" value="${salMap[c.id] || ''}">
        </div>
      </div>
    `

    const fixedFields = fixedCols.length
      ? fixedCols.map(_inputField).join('')
      : `<p class="empty-state">No fixed components defined. Add them in Settings first.</p>`

    const varSection = varCols.length ? `
      <hr style="margin:20px 0;border:none;border-top:1px solid var(--border);">
      <p style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin:0 0 14px;">Variable Components <span style="font-weight:400;text-transform:none;letter-spacing:0;">(not included in Monthly Salary / CTC)</span></p>
      <div class="hrms-form-grid">${varCols.map(_inputField).join('')}</div>
    ` : ''

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Edit Salary — ${Utils.escapeHtml(emp.name)}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">${CLOSE_SVG}</button>
      </div>
      <div class="modal-body" style="padding:20px 24px;">
        <div id="dash-modal-err" class="alert alert--danger" style="display:none;margin-bottom:14px;"></div>
        ${fixedCols.length ? `
          <div class="hrms-form-grid">${fixedFields}</div>
          ${varSection}
          <div class="hrms-salary-summary" id="dash-modal-summary" style="margin-top:18px;">
            ${_dashSummaryHtml(fixedCols, salMap, varCols)}
          </div>
        ` : fixedFields}
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        ${fixedCols.length ? `<button class="btn btn--primary" id="dash-save-btn">Save</button>` : ''}
      </div>
    `, 'dash-edit-modal')

    document.querySelectorAll('.dash-comp-inp').forEach(inp => {
      inp.addEventListener('input', () => {
        const live = {}
        document.querySelectorAll('.dash-comp-inp').forEach(i => {
          live[i.dataset.compId] = parseFloat(i.value) || 0
        })
        const el = document.getElementById('dash-modal-summary')
        if (el) el.innerHTML = _dashSummaryHtml(fixedCols, live, varCols)
      })
    })

    document.getElementById('dash-save-btn')?.addEventListener('click', () => _saveDashSalary(emp, [...fixedCols, ...varCols]))
  }

  function _dashSummaryHtml(fixedCols, salMap, varCols = []) {
    const annualFixed = fixedCols.reduce((s, c) => s + (Number(salMap[c.id]) || 0), 0)
    const annualVar   = varCols.reduce((s, c) => s + (Number(salMap[c.id]) || 0), 0)
    const monthly     = Math.round(annualFixed / 12)
    const ctc         = annualFixed + annualVar
    return `
      <div class="hrms-summary-row">
        <span>Monthly Salary</span>
        <strong>${_fmt(monthly)}</strong>
      </div>
      <div class="hrms-summary-row hrms-summary-row--net">
        <span>Annual CTC</span>
        <strong>${_fmt(ctc)}</strong>
      </div>
    `
  }

  async function _saveDashSalary(emp, cols) {
    const errEl = document.getElementById('dash-modal-err')
    const btn   = document.getElementById('dash-save-btn')
    errEl.style.display = 'none'
    btn.disabled    = true
    btn.textContent = 'Saving…'

    const components = { ...(_empSalaries[emp.id] || {}) }
    cols.forEach(c => {
      components[c.id] = Math.round((parseFloat(document.getElementById(`dci-${c.id}`)?.value) || 0) * 100) / 100
    })

    // employee_compensation now holds a timeline (multiple rows per
    // employee over time), so this edits the currently-open row rather
    // than upserting on employee_id alone.
    const { data: updated, error: updateError } = await Config.supabase
      .from('employee_compensation')
      .update({
        components,
        updated_by: _user.id,
        updated_at: new Date().toISOString(),
      })
      .eq('employee_id', emp.id)
      .eq('status', 'approved')
      .is('effective_to', null)
      .select()

    let error = updateError
    if (!error && (!updated || updated.length === 0)) {
      const insertRes = await Config.supabase
        .from('employee_compensation')
        .insert({
          employee_id:    emp.id,
          components,
          effective_from: new Date().toISOString().slice(0, 10),
          reason:         'initial',
          status:         'approved',
          updated_by:     _user.id,
          updated_at:     new Date().toISOString(),
        })
      error = insertRes.error
    }

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
     TAB — APPRAISALS (Management department only)
  ════════════════════════════════════════════════════════════ */
  const APPRAISAL_STATUS_STYLE = {
    pending_hr:         'background:#FEF3C7;color:#92400E;border:1px solid #FCD34D;',
    pending_management: 'background:#DBEAFE;color:#1E40AF;border:1px solid #93C5FD;',
    approved:           'background:#ECFDF5;color:#065F46;border:1px solid #6EE7B7;',
    rejected:           'background:#FEE2E2;color:#B91C1C;border:1px solid #FCA5A5;',
  }
  const APPRAISAL_STATUS_LABEL = {
    pending_hr: 'Pending HR', pending_management: 'Pending Management', approved: 'Approved', rejected: 'Rejected',
  }

  async function _loadAppraisalsTab() {
    const content = document.getElementById('payroll-content')
    if (content) content.innerHTML = '<div class="page-loading">Loading…</div>'
    _appraisals = await _fetchAppraisals()
    _renderAppraisalsTab()
  }

  async function _fetchAppraisals() {
    const { data } = await Config.supabase
      .from('employee_compensation')
      .select('*, employee:employees!employee_id(id, name, designation)')
      .eq('reason', 'appraisal')
      .order('updated_at', { ascending: false })
    const appraisals = data || []

    // "Last" (pre-appraisal) figures must come from whichever entry was
    // actually active immediately before this appraisal's effective_from —
    // NOT from "whatever's currently open," which is wrong the moment the
    // appraisal itself gets approved and becomes the open entry (old vs.
    // new would then read the same row, always showing 0% change).
    const empIds = [...new Set(appraisals.map(a => a.employee_id))]
    let priorByEmp = {}
    if (empIds.length) {
      const { data: allEntries } = await Config.supabase
        .from('employee_compensation')
        .select('employee_id, effective_from, status, components')
        .in('employee_id', empIds)
        .eq('status', 'approved')
        .order('effective_from', { ascending: true })
      ;(allEntries || []).forEach(e => {
        priorByEmp[e.employee_id] = priorByEmp[e.employee_id] || []
        priorByEmp[e.employee_id].push(e)
      })
    }
    appraisals.forEach(a => {
      const timeline = priorByEmp[a.employee_id] || []
      // Last approved entry strictly before this appraisal took effect.
      const prior = timeline.filter(e => e.effective_from < a.effective_from).pop()
      a._priorComponents = prior ? prior.components : null
    })

    return appraisals
  }

  function _fixedMonthlyFromComponents(components) {
    const annualFixed = _fixedComponents().reduce((s, c) => s + (Number((components || {})[c.id]) || 0), 0)
    return Math.round(annualFixed / 12)
  }

  function _renderAppraisalsTab() {
    const content = document.getElementById('payroll-content')
    if (!content) return

    const toolbar = document.getElementById('payroll-toolbar-actions')
    if (toolbar) {
      toolbar.innerHTML = _eligibleEmployees.length
        ? `<button class="btn btn--primary btn--sm" id="appraisal-new-btn">New Appraisal</button>`
        : ''
    }

    const rows = _appraisals.map(a => {
      const emp         = a.employee || {}
      // Prior entry as of right before THIS appraisal took effect — not
      // "whatever's currently active," which becomes wrong the moment this
      // same appraisal is approved and becomes the active entry itself.
      const oldMonthly  = a._priorComponents ? _fixedMonthlyFromComponents(a._priorComponents) : null
      const newMonthly  = _fixedMonthlyFromComponents(a.components)
      const pctChange   = (oldMonthly !== null && oldMonthly > 0) ? (((newMonthly - oldMonthly) / oldMonthly) * 100).toFixed(1) : '—'
      const oldCtc      = a._priorComponents ? _annualCtcFromMap(a._priorComponents) : null
      const newCtc      = _annualCtcFromMap(a.components)
      const ctcPctChange = (oldCtc !== null && oldCtc > 0) ? (((newCtc - oldCtc) / oldCtc) * 100).toFixed(1) : '—'
      const canApproveHr   = _isHR && a.status === 'pending_hr'
      const canApproveMgmt = _isManagement && a.status === 'pending_management'

      return `
        <tr>
          <td>
            <button data-appr-history="${a.employee_id}" style="font-weight:500;font-size:13px;background:none;border:none;padding:0;cursor:pointer;color:var(--text);text-decoration:underline;text-underline-offset:2px;">${Utils.escapeHtml(emp.name || '—')}</button>
            <div style="font-size:11px;color:var(--text-muted);">${Utils.escapeHtml(emp.designation || '')}</div>
          </td>
          <td style="font-size:12px;">${a.effective_from || '—'}</td>
          <td style="text-align:right;font-size:12px;">${_fmt(oldMonthly)}</td>
          <td style="text-align:right;font-size:12px;font-weight:600;">${_fmt(newMonthly)}</td>
          <td style="text-align:right;font-size:12px;color:${newMonthly >= oldMonthly ? '#1D9E75' : '#B91C1C'};">
            ${pctChange === '—' ? '—' : (newMonthly >= oldMonthly ? '+' : '') + pctChange + '%'}
          </td>
          <td style="text-align:right;font-size:12px;">${_fmt(oldCtc)}</td>
          <td style="text-align:right;font-size:12px;font-weight:600;">${_fmt(newCtc)}</td>
          <td style="text-align:right;font-size:12px;color:${newCtc >= oldCtc ? '#1D9E75' : '#B91C1C'};">
            ${ctcPctChange === '—' ? '—' : (newCtc >= oldCtc ? '+' : '') + ctcPctChange + '%'}
          </td>
          <td>
            <span style="font-size:11px;padding:3px 10px;border-radius:20px;font-weight:600;${APPRAISAL_STATUS_STYLE[a.status] || ''}">
              ${APPRAISAL_STATUS_LABEL[a.status] || a.status}
            </span>
          </td>
          <td>
            ${canApproveHr || canApproveMgmt ? `
              <button class="btn btn--xs btn--primary" data-appr-approve="${a.id}" data-appr-stage="${a.status}">Approve</button>
              <button class="btn btn--xs btn--danger-ghost" data-appr-reject="${a.id}">Reject</button>
            ` : (a.status === 'rejected' && a.rejected_reason ? `<span style="font-size:11px;color:var(--text-muted);" title="${Utils.escapeHtml(a.rejected_reason)}">Reason ⓘ</span>` : '—')}
          </td>
        </tr>
      `
    }).join('')

    content.innerHTML = `
      <div class="section-card">
        <div class="section-card-body" style="padding:0;overflow-x:auto;">
          ${_appraisals.length ? `
            <table class="data-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Effective Date</th>
                  <th style="text-align:right;">Current Monthly</th>
                  <th style="text-align:right;">New Monthly</th>
                  <th style="text-align:right;">Change</th>
                  <th style="text-align:right;">Last CTC (Yearly)</th>
                  <th style="text-align:right;">Updated CTC (Yearly)</th>
                  <th style="text-align:right;">CTC Change</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          ` : `<p class="empty-state" style="padding:24px;">
                 No appraisals yet. ${_eligibleEmployees.length ? 'Use "New Appraisal" to start one.' : ''}
               </p>`}
        </div>
      </div>
    `

    document.getElementById('appraisal-new-btn')?.addEventListener('click', _openNewAppraisalModal)

    content.querySelectorAll('[data-appr-approve]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id    = btn.dataset.apprApprove
        const stage = btn.dataset.apprStage
        if (stage === 'pending_hr')         _approveAppraisal(id, 'hr')
        if (stage === 'pending_management') _approveAppraisal(id, 'management')
      })
    })

    content.querySelectorAll('[data-appr-reject]').forEach(btn => {
      btn.addEventListener('click', () => _openRejectAppraisalModal(btn.dataset.apprReject))
    })

    content.querySelectorAll('[data-appr-history]').forEach(btn => {
      btn.addEventListener('click', () => _openCompensationHistoryModal(btn.dataset.apprHistory))
    })
  }

  async function _approveAppraisal(entryId, stage) {
    const fn = stage === 'hr' ? 'approve_appraisal_hr' : 'approve_appraisal_management'
    const { error } = await Config.supabase.rpc(fn, { p_entry_id: entryId })
    if (error) { Utils.showToast(error.message || 'Failed to approve.', 'error'); return }
    Utils.showToast(stage === 'hr' ? 'Approved — sent to Management for final approval.' : 'Appraisal approved and now active.', 'success')
    await _loadAppraisalsTab()
    await _loadSalaries()
  }

  function _openRejectAppraisalModal(entryId) {
    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Reject Appraisal</h3>
        <button class="modal-close" onclick="Utils.closeModal()">${CLOSE_SVG}</button>
      </div>
      <div class="modal-body" style="padding:20px 24px;">
        <div id="appr-reject-err" class="alert alert--danger" style="display:none;margin-bottom:14px;"></div>
        <div class="form-group">
          <label class="form-label">Reason <span class="required">*</span></label>
          <input class="form-input" type="text" id="appr-reject-reason" placeholder="Why is this being rejected?">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--danger-ghost" id="appr-reject-confirm-btn">Reject</button>
      </div>
    `, 'appr-reject-modal')

    document.getElementById('appr-reject-confirm-btn').addEventListener('click', async () => {
      const errEl  = document.getElementById('appr-reject-err')
      const reason = document.getElementById('appr-reject-reason').value.trim()
      if (!reason) { errEl.textContent = 'Please enter a reason.'; errEl.style.display = 'block'; return }

      const { error } = await Config.supabase.rpc('reject_appraisal', { p_entry_id: entryId, p_reason: reason })
      if (error) { errEl.textContent = error.message || 'Failed to reject.'; errEl.style.display = 'block'; return }

      Utils.closeModal()
      Utils.showToast('Appraisal rejected.', 'success')
      await _loadAppraisalsTab()
    })
  }

  function _openNewAppraisalModal() {
    if (!_eligibleEmployees.length) return

    const fixedCols = _fixedComponents()
    const varCols   = _variableComponents()

    const _inputField = c => `
      <div class="form-group">
        <label class="form-label">${Utils.escapeHtml(c.name)}</label>
        <div class="input-wrapper">
          <span class="input-prefix">₹</span>
          <input class="form-input form-input--prefixed appr-comp-inp" type="number"
            min="0" step="0.01" data-comp-id="${c.id}" id="aci-${c.id}" placeholder="0">
        </div>
      </div>
    `

    const empOptions = _eligibleEmployees.map(e => `<option value="${e.id}">${Utils.escapeHtml(e.name)}</option>`).join('')

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">New Appraisal</h3>
        <button class="modal-close" onclick="Utils.closeModal()">${CLOSE_SVG}</button>
      </div>
      <div class="modal-body" style="padding:20px 24px;">
        <div id="appr-new-err" class="alert alert--danger" style="display:none;margin-bottom:14px;"></div>
        <div class="hrms-form-grid" style="margin-bottom:14px;">
          <div class="form-group">
            <label class="form-label">Employee</label>
            <select class="form-input" id="appr-emp-sel">${empOptions}</select>
          </div>
          <div class="form-group">
            <label class="form-label">Effective Date</label>
            <input class="form-input" type="date" id="appr-eff-date">
          </div>
        </div>
        <div class="hrms-form-grid" id="appr-fixed-fields">${fixedCols.map(_inputField).join('')}</div>
        ${varCols.length ? `
          <hr style="margin:20px 0;border:none;border-top:1px solid var(--border);">
          <p style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin:0 0 14px;">Variable Components</p>
          <div class="hrms-form-grid" id="appr-var-fields">${varCols.map(_inputField).join('')}</div>
        ` : ''}
        <p style="font-size:11px;color:var(--text-muted);margin-top:14px;">
          This goes to HR for approval first, then Management for final sign-off. Nothing changes for the employee until both approve.
        </p>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="appr-new-submit-btn">Submit for Approval</button>
      </div>
    `, 'appr-new-modal')

    const _prefill = () => {
      const empId  = document.getElementById('appr-emp-sel').value
      const salMap = _empSalaries[empId] || {}
      document.querySelectorAll('.appr-comp-inp').forEach(inp => {
        inp.value = salMap[inp.dataset.compId] || ''
      })
    }
    _prefill()
    document.getElementById('appr-emp-sel').addEventListener('change', _prefill)

    document.getElementById('appr-new-submit-btn').addEventListener('click', async () => {
      const errEl  = document.getElementById('appr-new-err')
      errEl.style.display = 'none'
      const empId   = document.getElementById('appr-emp-sel').value
      const effDate = document.getElementById('appr-eff-date').value
      if (!effDate) { errEl.textContent = 'Please choose an effective date.'; errEl.style.display = 'block'; return }

      const components = {}
      document.querySelectorAll('.appr-comp-inp').forEach(inp => {
        components[inp.dataset.compId] = Math.round((parseFloat(inp.value) || 0) * 100) / 100
      })

      const btn = document.getElementById('appr-new-submit-btn')
      btn.disabled    = true
      btn.textContent = 'Submitting…'

      const { error } = await Config.supabase.rpc('submit_appraisal', {
        p_employee_id:    empId,
        p_components:     components,
        p_effective_from: effDate,
      })

      btn.disabled    = false
      btn.textContent = 'Submit for Approval'

      if (error) { errEl.textContent = error.message || 'Failed to submit.'; errEl.style.display = 'block'; return }

      Utils.closeModal()
      Utils.showToast('Appraisal submitted for HR approval.', 'success')
      await _loadAppraisalsTab()
    })
  }

  const HISTORY_REASON_LABEL = { initial: 'Joining', appraisal: 'Appraisal' }

  async function _openCompensationHistoryModal(employeeId) {
    const emp = _employees.find(e => e.id === employeeId) || {}

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Compensation History — ${Utils.escapeHtml(emp.name || '')}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">${CLOSE_SVG}</button>
      </div>
      <div class="modal-body" style="padding:20px 24px;">
        <div id="hist-body"><div class="page-loading">Loading…</div></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Close</button>
      </div>
    `, 'hist-modal')

    const { data } = await Config.supabase
      .from('employee_compensation')
      .select(`*,
        hr_approver:employees!hr_approved_by(name),
        mgmt_approver:employees!management_approved_by(name),
        submitter:employees!submitted_by(name)`)
      .eq('employee_id', employeeId)
      .order('effective_from', { ascending: true })

    const entries = data || []
    const body = document.getElementById('hist-body')
    if (!body) return

    if (!entries.length) {
      body.innerHTML = `<p class="empty-state" style="padding:24px;">No compensation history recorded yet.</p>`
      return
    }

    let prevApprovedMonthly = null
    let prevApprovedCtc     = null
    const rows = entries.map(e => {
      const monthly = _fixedMonthlyFromComponents(e.components)
      const ctc     = _annualCtcFromMap(e.components)
      let pctHtml    = '<span style="color:var(--text-muted);">—</span>'
      let ctcPctHtml = '<span style="color:var(--text-muted);">—</span>'
      if (e.status === 'approved') {
        if (prevApprovedMonthly !== null && prevApprovedMonthly > 0) {
          const pct = (((monthly - prevApprovedMonthly) / prevApprovedMonthly) * 100).toFixed(1)
          pctHtml = `<span style="color:${monthly >= prevApprovedMonthly ? '#1D9E75' : '#B91C1C'};">${monthly >= prevApprovedMonthly ? '+' : ''}${pct}%</span>`
        }
        if (prevApprovedCtc !== null && prevApprovedCtc > 0) {
          const ctcPct = (((ctc - prevApprovedCtc) / prevApprovedCtc) * 100).toFixed(1)
          ctcPctHtml = `<span style="color:${ctc >= prevApprovedCtc ? '#1D9E75' : '#B91C1C'};">${ctc >= prevApprovedCtc ? '+' : ''}${ctcPct}%</span>`
        }
        prevApprovedMonthly = monthly
        prevApprovedCtc     = ctc
      }

      const approvers = []
      if (e.hr_approver?.name)   approvers.push(`HR: ${Utils.escapeHtml(e.hr_approver.name)}`)
      if (e.mgmt_approver?.name) approvers.push(`Management: ${Utils.escapeHtml(e.mgmt_approver.name)}`)
      if (!approvers.length && e.reason !== 'initial') approvers.push('—')

      return `
        <tr>
          <td style="font-size:12px;">${e.effective_from}${e.effective_to ? ` → ${e.effective_to}` : ' → Present'}</td>
          <td style="font-size:12px;">${HISTORY_REASON_LABEL[e.reason] || e.reason}</td>
          <td style="text-align:right;font-size:12px;font-weight:600;">${_fmt(monthly)}</td>
          <td style="text-align:right;font-size:12px;">${pctHtml}</td>
          <td style="text-align:right;font-size:12px;font-weight:600;">${_fmt(ctc)}</td>
          <td style="text-align:right;font-size:12px;">${ctcPctHtml}</td>
          <td>
            <span style="font-size:11px;padding:3px 10px;border-radius:20px;font-weight:600;${APPRAISAL_STATUS_STYLE[e.status] || ''}">
              ${APPRAISAL_STATUS_LABEL[e.status] || e.status}
            </span>
          </td>
          <td style="font-size:11px;color:var(--text-muted);">${approvers.join(' · ') || '—'}</td>
        </tr>
      `
    }).join('')

    body.innerHTML = `
      <p style="font-size:11px;color:var(--text-muted);margin:0 0 14px;">
        Every joining and appraisal event for this employee, in order — the same record used to calculate payroll each month.
      </p>
      <div style="overflow-x:auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Effective Period</th>
              <th>Reason</th>
              <th style="text-align:right;">Fixed Monthly</th>
              <th style="text-align:right;">Change</th>
              <th style="text-align:right;">Yearly CTC</th>
              <th style="text-align:right;">Change</th>
              <th>Status</th>
              <th>Approved By</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `
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
      .select(`*, employee:employees!employee_id(id, name, designation), adj_items:payroll_adjustments(*, creator:employees!created_by(name))`)
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

    const pillStyle = {
      pending: 'background:#FEF3C7;color:#92400E;border:1px solid #FCD34D;',
      paid:    'background:#ECFDF5;color:#065F46;border:1px solid #6EE7B7;',
      hold:    'background:#FEE2E2;color:#B91C1C;border:1px solid #FCA5A5;',
    }

    const rows = records.map(r => {
      const emp      = r.employee || {}
      const adjItems = r.adj_items || []
      const adjTotal = adjItems.reduce((s, a) => s + Number(a.amount), 0)
      const st       = r.payment_status || 'pending'

      return `
        <tr>
          <td>
            <div style="font-weight:500;font-size:13px;">${Utils.escapeHtml(emp.name || '—')}</div>
            <div style="font-size:11px;color:var(--text-muted);">${Utils.escapeHtml(emp.designation || '')}</div>
          </td>
          <td style="text-align:right;font-size:12px;">
            <button data-open-ded="${r.id}" style="background:none;border:none;padding:0;cursor:pointer;color:inherit;font-size:12px;text-decoration:underline;text-underline-offset:2px;text-decoration-color:var(--border);" title="See how this was calculated">${_fmt(r.monthly_salary)}</button>
          </td>
          <td style="text-align:right;font-size:12px;">
            ${r.deductions > 0
              ? `<button class="btn--link-danger" data-open-ded="${r.id}">− ${_fmt(r.deductions)}</button>`
              : `<span style="color:var(--text-muted);">—</span>`}
          </td>
          <td style="text-align:right;font-size:12px;">
            <span style="color:#1D9E75;">${adjTotal > 0 ? '+ ' + _fmt(adjTotal) : '—'}</span>
            <button class="btn btn--xs btn--ghost" data-open-adj="${r.id}" style="margin-left:4px;">+</button>
          </td>
          <td style="text-align:right;font-size:13px;font-weight:700;">${_fmt(r.net_pay)}</td>
          <td>
            <select class="proc-status-sel" data-rec="${r.id}"
              style="font-size:11px;padding:3px 10px;border-radius:20px;font-weight:600;cursor:pointer;${pillStyle[st]}">
              <option value="pending" ${st==='pending'?'selected':''}>Pending</option>
              <option value="paid"    ${st==='paid'   ?'selected':''}>Paid</option>
              <option value="hold"    ${st==='hold'   ?'selected':''}>Hold</option>
            </select>
          </td>
          <td>
            <input type="date" class="form-input form-input--sm proc-date-inp" data-rec="${r.id}"
              value="${r.payment_date || ''}" style="font-size:11px;padding:3px 6px;min-width:110px;">
          </td>
        </tr>
      `
    }).join('')

    const runBanner = _procRun
      ? _procRun.status === 'finalized'
        ? `<div style="display:flex;align-items:center;gap:10px;padding:11px 16px;background:#ECFDF5;border:1px solid #6EE7B7;border-radius:8px;margin-bottom:14px;">
             <span style="font-size:13px;font-weight:700;color:#065F46;">✓ Finalized</span>
             <span style="font-size:12px;color:#065F46;">${MONTHS[_procMonth - 1]} ${_procYear} payroll is locked.</span>
             <div style="margin-left:auto;">
               <button class="btn btn--xs btn--ghost" id="proc-reopen-btn">Re-open</button>
             </div>
           </div>`
        : `<div style="display:flex;align-items:center;gap:10px;padding:11px 16px;background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px;margin-bottom:14px;">
             <span style="font-size:13px;font-weight:700;color:#92400E;">Draft</span>
             <span style="font-size:12px;color:#92400E;">${MONTHS[_procMonth - 1]} ${_procYear} · Review and finalize when ready.</span>
             <div style="margin-left:auto;display:flex;gap:8px;">
               <button class="btn btn--xs btn--danger-ghost" id="proc-delete-btn">Delete Run</button>
               <button class="btn btn--ghost btn--sm" id="proc-finalize-btn">Finalize</button>
             </div>
           </div>`
      : ''

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
          <div style="margin-left:auto;">
            ${!_procRun ? `<button class="btn btn--primary btn--sm" id="proc-gen-btn">Generate Payroll</button>` : ''}
          </div>
        </div>
      </div>

      ${runBanner}

      <div class="section-card">
        <div class="section-card-body" style="padding:0;overflow-x:auto;">
          ${_procRun
            ? (records.length
              ? `<table class="data-table">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th style="text-align:right;">Monthly Salary</th>
                      <th style="text-align:right;">Deductions</th>
                      <th style="text-align:right;">Adjustments</th>
                      <th style="text-align:right;">Net Pay</th>
                      <th>Payment Status</th>
                      <th>Payment Date</th>
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

    // Month / Year / Filter
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

    // Generate
    document.getElementById('proc-gen-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('proc-gen-btn')
      btn.disabled = true; btn.textContent = 'Generating…'
      const { error } = await Config.supabase.rpc('generate_monthly_payroll', { p_month: _procMonth, p_year: _procYear })
      if (error) {
        Utils.showToast('Failed: ' + error.message, 'error')
        btn.disabled = false; btn.textContent = 'Generate Payroll'
      } else {
        Utils.showToast('Payroll generated.', 'success')
        await _loadProcessingTab()
      }
    })

    // Finalize
    document.getElementById('proc-finalize-btn')?.addEventListener('click', async () => {
      if (!confirm(`Finalize payroll for ${MONTHS[_procMonth - 1]} ${_procYear}?\n\nThis will lock the run from further changes.`)) return
      const { error } = await Config.supabase.from('payroll_runs').update({ status: 'finalized' }).eq('id', _procRun.id)
      if (error) { Utils.showToast('Failed: ' + error.message, 'error'); return }
      Utils.showToast('Payroll finalized.', 'success')
      await _loadProcessingTab()
    })

    // Re-open finalized run
    document.getElementById('proc-reopen-btn')?.addEventListener('click', async () => {
      const hasPaid = _procRecords.some(r => r.payment_status === 'paid')
      if (hasPaid) {
        Utils.showToast('Cannot re-open — one or more employees are already marked as Paid.', 'error')
        return
      }
      if (!confirm(`Re-open payroll for ${MONTHS[_procMonth - 1]} ${_procYear}?\n\nThis will unlock the run so you can make corrections.`)) return
      const btn = document.getElementById('proc-reopen-btn')
      btn.disabled = true; btn.textContent = 'Re-opening…'
      const { data: { user } } = await Config.supabase.auth.getUser()
      const [runRes, logRes] = await Promise.all([
        Config.supabase.from('payroll_runs').update({ status: 'draft' }).eq('id', _procRun.id),
        Config.supabase.from('payroll_audit_log').insert({
          payroll_record_id: _procRun.id,
          field_name:  'run_status',
          old_value:   'finalized',
          new_value:   'draft',
          changed_by:  user?.id,
          changed_at:  new Date().toISOString(),
          note:        'Run re-opened for corrections',
        }),
      ])
      if (runRes.error) {
        Utils.showToast('Failed: ' + runRes.error.message, 'error')
        btn.disabled = false; btn.textContent = 'Re-open'
        return
      }
      Utils.showToast('Payroll re-opened. Make your corrections and finalize again.', 'success')
      await _loadProcessingTab()
    })

    // Delete run
    document.getElementById('proc-delete-btn')?.addEventListener('click', async () => {
      if (!confirm(`Delete payroll run for ${MONTHS[_procMonth - 1]} ${_procYear}?\n\nAll generated records will be removed.`)) return
      const btn = document.getElementById('proc-delete-btn')
      btn.disabled = true; btn.textContent = 'Deleting…'
      const { error } = await Config.supabase.from('payroll_runs').delete().eq('id', _procRun.id)
      if (error) {
        Utils.showToast('Delete failed: ' + error.message, 'error')
        btn.disabled = false; btn.textContent = 'Delete Run'
        return
      }
      Utils.showToast('Payroll run deleted.', 'success')
      _procRun = null; _procRecords = []
      await _loadProcessingTab()
    })

    // Payment status pill — click cycles Pending → Paid → Hold
    content.querySelectorAll('.proc-status-sel').forEach(sel => {
      sel.addEventListener('change', async () => {
        const newSt = sel.value
        sel.disabled = true
        const { error } = await Config.supabase
          .from('payroll_records')
          .update({ payment_status: newSt, updated_at: new Date().toISOString() })
          .eq('id', sel.dataset.rec)
        sel.disabled = false
        if (error) { Utils.showToast('Failed to update status.', 'error'); return }
        const rec = _procRecords.find(r => r.id === sel.dataset.rec)
        if (rec) rec.payment_status = newSt
        sel.style.cssText = `font-size:11px;padding:3px 10px;border-radius:20px;font-weight:600;cursor:pointer;${pillStyle[newSt]}`
      })
    })

    // Payment date
    content.querySelectorAll('.proc-date-inp').forEach(inp => {
      inp.addEventListener('change', async () => {
        const { error } = await Config.supabase
          .from('payroll_records')
          .update({ payment_date: inp.value || null, updated_at: new Date().toISOString() })
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

    // Deductions
    content.querySelectorAll('[data-open-ded]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const rec = _procRecords.find(r => r.id === btn.dataset.openDed)
        if (rec) await _openDeductionModal(rec)
      })
    })
  }

  /* ── Adjustments modal ───────────────────────────────────── */
  function _openAdjModal(rec) {
    const emp      = rec.employee || {}
    const adjItems = rec.adj_items || []

    const historyRows = adjItems.map(a => {
      const who  = a.creator?.name || 'HR'
      const when = a.created_at
        ? new Date(a.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '—'
      return `
        <div class="hrms-adj-row" id="adjrow-${a.id}" style="display:grid;grid-template-columns:1fr 0.7fr 1.5fr 1fr auto;gap:10px;align-items:start;padding:10px 0;border-bottom:1px solid var(--border);">
          <div>
            <span class="badge badge--muted" style="font-size:10px;">${_adjLabel(a.type)}</span>
          </div>
          <div style="font-size:13px;font-weight:600;color:#1D9E75;">+${_fmt(a.amount)}</div>
          <div style="font-size:12px;color:var(--text-muted);" title="${Utils.escapeHtml(a.remark)}">${Utils.escapeHtml(a.remark)}</div>
          <div>
            <div style="font-size:12px;font-weight:500;">${Utils.escapeHtml(who)}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${when}</div>
          </div>
          <button class="btn btn--xs btn--danger-ghost" data-del-adj="${a.id}">Remove</button>
        </div>`
    }).join('')

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Adjustments — ${Utils.escapeHtml(emp.name || '')}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">${CLOSE_SVG}</button>
      </div>
      <div class="modal-body" style="padding:20px 24px;">
        <div id="adj-err" class="alert alert--danger" style="display:none;margin-bottom:14px;"></div>

        ${adjItems.length ? `
          <div style="margin-bottom:20px;">
            <div class="hrms-section-label" style="margin-bottom:10px;">Adjustment History</div>
            <div style="display:grid;grid-template-columns:1fr 0.7fr 1.5fr 1fr auto;gap:10px;padding:0 0 8px;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--border);">
              <div>Type</div><div>Amount</div><div>Remark</div><div>Added By</div><div></div>
            </div>
            ${historyRows}
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

  /* ── Deduction breakdown + history + override modal ─────── */
  async function _openDeductionModal(rec) {
    const emp        = rec.employee || {}
    const monthly    = Number(rec.monthly_salary)
    const perDay     = monthly / 30
    const unpaidDays = Number(rec.unpaid_leave_days   || 0)
    const missedDays = Number(rec.missed_timesheet_days || 0)
    const breakdown  = Array.isArray(rec.calc_breakdown) ? rec.calc_breakdown : null

    // Adjustments (bonuses, incentives, arrears from late-approved comp
    // changes, etc.) are folded into net_pay but were never shown as line
    // items — that's what made the final total look disconnected from the
    // segment math above it. Surface them explicitly.
    const adjItems = rec.adj_items || []
    const adjTotal = adjItems.reduce((s, a) => s + Number(a.amount), 0)
    const adjustmentsHtml = adjItems.length ? `
      <div style="padding-top:8px;border-top:1px solid var(--border);margin-top:6px;">
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">Adjustments</div>
        ${adjItems.map(a => `
          <div class="hrms-summary-row">
            <span title="${Utils.escapeHtml(a.remark || '')}">${Utils.escapeHtml(_adjLabel(a.type))}${a.creator?.name ? ` <span style="color:var(--text-muted);">— ${Utils.escapeHtml(a.creator.name)}</span>` : ''}</span>
            <strong style="color:${Number(a.amount) >= 0 ? '#1D9E75' : '#DC2626'};">${Number(a.amount) >= 0 ? '+' : ''}${_fmt(a.amount)}</strong>
          </div>
        `).join('')}
      </div>
    ` : ''

    // Fetch audit history with changer name
    const { data: logs } = await Config.supabase
      .from('payroll_audit_log')
      .select('*, changer:employees!changed_by(name)')
      .eq('payroll_record_id', rec.id)
      .eq('field_name', 'deductions')
      .order('changed_at', { ascending: true })

    // "Overridden" means a human actually changed it — not a mismatch
    // against a naive re-estimate, which doesn't know about mid-month
    // rate changes and would false-positive on every split month.
    const isOverridden = (logs || []).length > 0

    const historyRows = (logs || []).map(l => {
      const who  = l.changer?.name || 'HR'
      const when = new Date(l.changed_at).toLocaleString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      })
      return `
        <div style="display:grid;grid-template-columns:1.2fr 0.8fr 0.8fr 1.5fr;gap:8px;padding:10px 0;border-bottom:1px solid var(--border);font-size:12px;align-items:start;">
          <div>
            <div style="font-weight:600;color:var(--text);">${Utils.escapeHtml(who)}</div>
            <div style="color:var(--text-muted);font-size:11px;margin-top:2px;">${when}</div>
          </div>
          <div>
            <div style="color:var(--text-muted);font-size:11px;margin-bottom:2px;">From</div>
            <div style="font-weight:600;">−${_fmt(Number(l.original_value))}</div>
          </div>
          <div>
            <div style="color:var(--text-muted);font-size:11px;margin-bottom:2px;">To</div>
            <div style="font-weight:600;color:#1D9E75;">−${_fmt(Number(l.updated_value))}</div>
          </div>
          <div>
            <div style="color:var(--text-muted);font-size:11px;margin-bottom:2px;">Reason</div>
            <div style="color:var(--text);">${Utils.escapeHtml(l.remark || '—')}</div>
          </div>
        </div>`
    }).join('')

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Pay Calculation — ${Utils.escapeHtml(emp.name || '')}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">${CLOSE_SVG}</button>
      </div>
      <div class="modal-body" style="padding:20px 24px;">
        <div id="ded-err" class="alert alert--danger" style="display:none;margin-bottom:14px;"></div>

        <div class="hrms-section-label" style="margin-bottom:10px;">Breakdown</div>
        <div class="hrms-salary-summary" style="margin-bottom:20px;">
          ${breakdown && breakdown.length ? `
            ${breakdown.length > 1 ? `<p style="font-size:11px;color:var(--text-muted);margin:0 0 10px;">A compensation change took effect mid-month — each period below is priced at its own rate, ₹/day always calculated as that period's monthly salary ÷ 30.</p>` : ''}
            ${breakdown.map((seg, i) => `
              <div style="${i > 0 ? 'border-top:1px solid var(--border);margin-top:10px;padding-top:10px;' : ''}">
                ${breakdown.length > 1 ? `<div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">${seg.segment_start} → ${seg.segment_end}</div>` : ''}
                <div class="hrms-summary-row">
                  <span>Monthly Salary</span>
                  <strong>${_fmt(seg.monthly_salary)}</strong>
                </div>
                <div class="hrms-summary-row">
                  <span>Per Day Rate</span>
                  <strong>${_fmt(seg.day_rate)}/day</strong>
                </div>
                <div class="hrms-summary-row">
                  <span>Unpaid Leave</span>
                  <strong style="color:#DC2626;">${seg.unpaid_leave_days} day${seg.unpaid_leave_days !== 1 ? 's' : ''}</strong>
                </div>
                <div class="hrms-summary-row">
                  <span>Missed Timesheet</span>
                  <strong style="color:#DC2626;">${seg.missed_timesheet_days} day${seg.missed_timesheet_days !== 1 ? 's' : ''}</strong>
                </div>
                <div class="hrms-summary-row">
                  <span>Deducted This Period</span>
                  <strong style="color:#DC2626;">−${_fmt(seg.segment_deduction)}</strong>
                </div>
                <div class="hrms-summary-row">
                  <span>Earned This Period</span>
                  <strong style="color:#1D9E75;">${_fmt(seg.segment_prorated)}</strong>
                </div>
              </div>
            `).join('')}
            <div class="hrms-summary-row" style="padding-top:8px;border-top:1px solid var(--border);margin-top:10px;">
              <span style="color:var(--text-muted);">Total Deduction</span>
              <span style="color:var(--text-muted);">−${_fmt(rec.deductions)}</span>
            </div>
            ${adjustmentsHtml}
            <div class="hrms-summary-row hrms-summary-row--net" style="padding-top:10px;border-top:1px solid var(--border);margin-top:8px;">
              <span style="font-size:15px;font-weight:600;">Total Earning This Month</span>
              <strong style="color:#1D9E75;font-size:18px;">${_fmt(rec.net_pay)}</strong>
            </div>
          ` : `
            <div class="hrms-summary-row">
              <span>Monthly Salary</span>
              <strong>${_fmt(monthly)}</strong>
            </div>
            <div class="hrms-summary-row">
              <span>Per Day Rate</span>
              <strong>${_fmt(perDay)}/day</strong>
            </div>
            <div class="hrms-summary-row" style="padding-top:8px;border-top:1px solid var(--border);margin-top:4px;">
              <span>Unpaid Leave</span>
              <strong style="color:#DC2626;">${unpaidDays} day${unpaidDays !== 1 ? 's' : ''} &nbsp;·&nbsp; −${_fmt(perDay * unpaidDays)}</strong>
            </div>
            <div class="hrms-summary-row">
              <span>Missed Timesheet</span>
              <strong style="color:#DC2626;">${missedDays} day${missedDays !== 1 ? 's' : ''} &nbsp;·&nbsp; −${_fmt(perDay * missedDays)}</strong>
            </div>
            <div class="hrms-summary-row" style="padding-top:8px;border-top:1px solid var(--border);margin-top:4px;">
              <span style="color:var(--text-muted);">Total Deduction</span>
              <span style="color:var(--text-muted);">−${_fmt(rec.deductions)}</span>
            </div>
            ${adjustmentsHtml}
            <div class="hrms-summary-row hrms-summary-row--net" style="padding-top:10px;border-top:1px solid var(--border);margin-top:8px;">
              <span style="font-size:15px;font-weight:600;">Total Earning This Month</span>
              <strong style="color:#1D9E75;font-size:18px;">${_fmt(rec.net_pay)}</strong>
            </div>
            <p style="font-size:11px;color:var(--text-muted);margin-top:8px;">Detailed segment breakdown isn't available for this record — it was generated before breakdown tracking was added. Regenerate this payroll run to get it.</p>
          `}
          ${isOverridden ? `
            <div class="hrms-summary-row" style="background:#FEF3C7;border-radius:6px;padding:6px 10px;margin-top:6px;">
              <span style="font-size:12px;color:#92400E;">⚠ Manually overridden to</span>
              <strong style="color:#92400E;">−${_fmt(rec.deductions)}</strong>
            </div>
          ` : ''}
        </div>

        ${logs?.length ? `
          <div class="hrms-section-label" style="margin-bottom:10px;">Change History</div>
          <div style="margin-bottom:20px;">
            <div style="display:grid;grid-template-columns:1.2fr 0.8fr 0.8fr 1.5fr;gap:8px;padding:0 0 8px;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--border);">
              <div>Changed By</div><div>From</div><div>To</div><div>Reason</div>
            </div>
            ${historyRows}
          </div>
        ` : ''}

        <div class="hrms-section-label" style="margin-bottom:4px;">Override Deduction</div>
        <p style="font-size:12px;color:var(--text-muted);margin:0 0 12px;">Changes the Total Deduction (currently −${_fmt(rec.deductions)}) shown above — Total Earning This Month will update to match once saved.</p>
        <div class="form-group" style="margin-bottom:14px;">
          <label class="form-label">New Deduction Amount (₹)</label>
          <div class="input-wrapper">
            <span class="input-prefix">₹</span>
            <input class="form-input form-input--prefixed" type="number" id="ded-amount"
              value="${rec.deductions}" min="0">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Reason <span class="required">*</span></label>
          <input class="form-input" type="text" id="ded-remark"
            placeholder="e.g. Worked on Sunday 28 Jun, leave record corrected…">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Close</button>
        <button class="btn btn--primary" id="ded-save-btn">Save Override</button>
      </div>
    `, 'ded-modal')

    document.getElementById('ded-save-btn').addEventListener('click', async () => {
      const errEl      = document.getElementById('ded-err')
      errEl.style.display = 'none'
      const remark     = document.getElementById('ded-remark').value.trim()
      const deductions = parseFloat(document.getElementById('ded-amount').value) || 0

      if (!remark) {
        errEl.textContent   = 'A reason is required (saved to audit log).'
        errEl.style.display = 'block'
        return
      }

      const btn = document.getElementById('ded-save-btn')
      btn.disabled    = true
      btn.textContent = 'Saving…'

      const adjTotal = (rec.adj_items || []).reduce((s, a) => s + Number(a.amount), 0)
      const newNet   = Number(rec.prorated_salary) - deductions + adjTotal

      const [upd] = await Promise.all([
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
      btn.textContent = 'Save Override'

      if (upd.error) {
        errEl.textContent   = upd.error.message
        errEl.style.display = 'block'
        return
      }

      Utils.closeModal()
      Utils.showToast('Deduction updated.', 'success')
      await _loadProcessingTab()
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
      .select('id, name, designation, status, deactivated_at, department_id')
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

ModuleRegistry.register({
  key:       'payroll',
  routeId:   'payroll',
  label:     'Payroll',
  order:     1,
  icon:      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`,
  getModule: () => Payroll,
  features:  {
    view_payroll:    'View Payroll',
    manage_payroll:  'Manage Payroll',
    process_payroll: 'Process Payroll',
  },
})
