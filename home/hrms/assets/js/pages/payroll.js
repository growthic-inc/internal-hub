/* ============================================================
   HRMS — Payroll Module
   Initial scope: Salary Structure per employee.
   ============================================================ */

const Payroll = (() => {

  let _user       = null
  let _employees  = []
  let _structures = []   // all salary_structures rows
  let _activeTab  = 'salary-structure'

  const CLOSE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`

  /* ── Helpers ────────────────────────────────────────────── */
  function _fmt(n) {
    if (!n && n !== 0) return '—'
    return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  }

  function _calcGross(s) {
    return (Number(s.basic_monthly) || 0)
      + (Number(s.hra_monthly) || 0)
      + (Number(s.special_allowance_monthly) || 0)
      + (Number(s.other_allowances_monthly) || 0)
  }

  function _calcDeductions(s) {
    return (Number(s.pf_employee_monthly) || 0)
      + (Number(s.professional_tax_monthly) || 0)
      + (Number(s.tds_monthly) || 0)
  }

  function _calcNet(s) {
    return _calcGross(s) - _calcDeductions(s)
  }

  function _monthlyFromAnnual(annual) {
    return Math.round((annual || 0) / 12)
  }

  /* ── Render ─────────────────────────────────────────────── */
  function render(user) {
    _user = user
    return `
      <div class="page-inner">
        <div class="page-toolbar">
          <div class="tabs" id="payroll-tabs">
            <button class="tab-btn tab-btn--active" data-tab="salary-structure">Salary Structure</button>
          </div>
          <div id="payroll-toolbar-actions"></div>
        </div>
        <div id="payroll-content" class="mt-4">
          <div class="page-loading">Loading…</div>
        </div>
      </div>
    `
  }

  /* ── Init ───────────────────────────────────────────────── */
  async function init(user) {
    _user = user

    document.querySelectorAll('#payroll-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#payroll-tabs .tab-btn').forEach(b => b.classList.remove('tab-btn--active'))
        btn.classList.add('tab-btn--active')
        _activeTab = btn.dataset.tab
        _loadTab(_activeTab)
      })
    })

    await _loadData()
    _loadTab(_activeTab)
  }

  async function _loadData() {
    const [empRes, structRes] = await Promise.all([
      API.getEmployeesFull(),
      _getSalaryStructures(),
    ])
    _employees  = (empRes.data || []).filter(e => e.status === 'active').sort((a, b) => a.name.localeCompare(b.name))
    _structures = structRes.data || []
  }

  function _loadTab(tab) {
    const toolbar = document.getElementById('payroll-toolbar-actions')
    if (toolbar) toolbar.innerHTML = ''
    if (tab === 'salary-structure') _loadSalaryStructureTab()
  }

  /* ══════════════════════════════════════════════════════════
     TAB: SALARY STRUCTURE
  ══════════════════════════════════════════════════════════ */
  function _loadSalaryStructureTab() {
    const toolbar = document.getElementById('payroll-toolbar-actions')
    if (toolbar) {
      toolbar.innerHTML = `<button class="btn btn--primary btn--sm" id="payroll-add-btn">+ Add / Update Structure</button>`
      document.getElementById('payroll-add-btn').addEventListener('click', () => _openStructureModal(null))
    }

    const content = document.getElementById('payroll-content')
    if (!content) return

    // Group: employees with structures vs without
    const structMap = {}
    _structures.forEach(s => {
      // Keep only the latest effective structure per employee
      if (!structMap[s.employee_id] || s.effective_from > structMap[s.employee_id].effective_from) {
        structMap[s.employee_id] = s
      }
    })

    const withStruct    = _employees.filter(e => structMap[e.id])
    const withoutStruct = _employees.filter(e => !structMap[e.id])

    content.innerHTML = `
      <!-- Summary stats -->
      <div class="hrms-stat-row mb-4">
        <div class="hrms-stat-card">
          <div class="hrms-stat-label">Employees with Structure</div>
          <div class="hrms-stat-value">${withStruct.length} / ${_employees.length}</div>
        </div>
        <div class="hrms-stat-card">
          <div class="hrms-stat-label">Total Monthly Gross</div>
          <div class="hrms-stat-value">${_fmt(withStruct.reduce((sum, e) => sum + _calcGross(structMap[e.id]), 0))}</div>
        </div>
        <div class="hrms-stat-card">
          <div class="hrms-stat-label">Total Monthly Net</div>
          <div class="hrms-stat-value">${_fmt(withStruct.reduce((sum, e) => sum + _calcNet(structMap[e.id]), 0))}</div>
        </div>
        <div class="hrms-stat-card hrms-stat-card--warn">
          <div class="hrms-stat-label">Pending Setup</div>
          <div class="hrms-stat-value">${withoutStruct.length}</div>
        </div>
      </div>

      <!-- Salary structures table -->
      <div class="section-card mb-4">
        <div class="section-card-header">
          <h3>Salary Structures</h3>
          <span class="badge badge--muted">${withStruct.length} employees</span>
        </div>
        <div class="section-card-body" style="padding:0;">
          ${withStruct.length ? `
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Department</th>
                    <th>Effective From</th>
                    <th>Annual CTC</th>
                    <th style="text-align:right;">Basic</th>
                    <th style="text-align:right;">HRA</th>
                    <th style="text-align:right;">Special Allow.</th>
                    <th style="text-align:right;">Other Allow.</th>
                    <th style="text-align:right;">Gross/Mo</th>
                    <th style="text-align:right;">Deductions/Mo</th>
                    <th style="text-align:right;">Net/Mo</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${withStruct.map(e => {
                    const s = structMap[e.id]
                    return `
                      <tr>
                        <td>
                          <div style="font-weight:500;font-size:13px;">${Utils.escapeHtml(e.name)}</div>
                          <div style="font-size:11px;color:var(--text-muted);">${Utils.escapeHtml(e.designation || '')}</div>
                        </td>
                        <td style="font-size:12px;">${Utils.escapeHtml(Utils.getDeptLabel(e.department) || '—')}</td>
                        <td style="font-size:12px;white-space:nowrap;">${s.effective_from}</td>
                        <td style="font-size:12px;font-weight:600;">${_fmt(s.ctc_annual)}</td>
                        <td style="font-size:12px;text-align:right;">${_fmt(s.basic_monthly)}</td>
                        <td style="font-size:12px;text-align:right;">${_fmt(s.hra_monthly)}</td>
                        <td style="font-size:12px;text-align:right;">${_fmt(s.special_allowance_monthly)}</td>
                        <td style="font-size:12px;text-align:right;">${_fmt(s.other_allowances_monthly)}</td>
                        <td style="font-size:12px;text-align:right;font-weight:600;color:var(--text);">${_fmt(_calcGross(s))}</td>
                        <td style="font-size:12px;text-align:right;color:var(--danger);">${_fmt(_calcDeductions(s))}</td>
                        <td style="font-size:12px;text-align:right;font-weight:700;color:#1D9E75;">${_fmt(_calcNet(s))}</td>
                        <td>
                          <button class="btn btn--xs btn--ghost" data-edit-struct="${e.id}">Edit</button>
                        </td>
                      </tr>
                    `
                  }).join('')}
                </tbody>
              </table>
            </div>
          ` : '<p class="empty-state">No salary structures set up yet.</p>'}
        </div>
      </div>

      <!-- Employees pending setup -->
      ${withoutStruct.length ? `
        <div class="section-card">
          <div class="section-card-header">
            <h3>Pending Setup</h3>
            <span class="badge badge--warning">${withoutStruct.length}</span>
          </div>
          <div class="section-card-body" style="padding:0;">
            <table class="data-table">
              <thead>
                <tr><th>Employee</th><th>Department</th><th>Designation</th><th></th></tr>
              </thead>
              <tbody>
                ${withoutStruct.map(e => `
                  <tr>
                    <td style="font-weight:500;font-size:13px;">${Utils.escapeHtml(e.name)}</td>
                    <td style="font-size:12px;">${Utils.escapeHtml(Utils.getDeptLabel(e.department) || '—')}</td>
                    <td style="font-size:12px;">${Utils.escapeHtml(e.designation || '—')}</td>
                    <td><button class="btn btn--xs btn--primary" data-add-struct="${e.id}">+ Set Up</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}
    `

    // Bind edit buttons
    content.querySelectorAll('[data-edit-struct]').forEach(btn => {
      btn.addEventListener('click', () => {
        const emp = _employees.find(e => e.id === btn.dataset.editStruct)
        _openStructureModal(emp, structMap[emp?.id])
      })
    })

    // Bind "Set Up" buttons from pending list
    content.querySelectorAll('[data-add-struct]').forEach(btn => {
      btn.addEventListener('click', () => {
        const emp = _employees.find(e => e.id === btn.dataset.addStruct)
        _openStructureModal(emp, null)
      })
    })
  }

  /* ── Add / Edit Salary Structure Modal ──────────────────── */
  function _openStructureModal(preselectedEmp, existingStruct) {
    const todayISO  = new Date().toISOString().slice(0, 10)
    const isEdit    = !!existingStruct

    const empOptions = _employees.map(e =>
      `<option value="${e.id}" ${preselectedEmp?.id === e.id ? 'selected' : ''}>${Utils.escapeHtml(e.name)} — ${Utils.escapeHtml(Utils.getDeptLabel(e.department) || '')}</option>`
    ).join('')

    const v = (field) => existingStruct ? (existingStruct[field] || '') : ''

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">${isEdit ? 'Edit Salary Structure' : 'Set Up Salary Structure'}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">${CLOSE_SVG}</button>
      </div>
      <div class="modal-body" style="padding:20px 24px;">
        <div id="payroll-modal-err" class="alert alert--danger" style="display:none;"></div>

        <!-- Employee + Effective Date -->
        <div class="form-row" style="margin-bottom:16px;">
          <div class="form-group" style="flex:2;">
            <label class="form-label">Employee <span class="required">*</span></label>
            <select class="form-input" id="pm-employee" ${isEdit ? 'disabled' : ''}>
              <option value="">Select employee…</option>
              ${empOptions}
            </select>
          </div>
          <div class="form-group" style="flex:1;">
            <label class="form-label">Effective From <span class="required">*</span></label>
            <input class="form-input" type="date" id="pm-effective" value="${v('effective_from') || todayISO}">
          </div>
        </div>

        <!-- CTC -->
        <div class="form-group" style="margin-bottom:20px;">
          <label class="form-label">Annual CTC (₹) <span class="required">*</span></label>
          <input class="form-input" type="number" id="pm-ctc" placeholder="e.g. 600000"
            value="${v('ctc_annual')}" min="0" step="1000">
          <div class="form-hint">Enter total annual Cost to Company.</div>
        </div>

        <!-- Earnings -->
        <div class="hrms-section-label">Monthly Earnings</div>
        <div class="hrms-form-grid" style="margin-bottom:20px;">
          <div class="form-group">
            <label class="form-label">Basic Salary <span class="required">*</span></label>
            <div class="input-wrapper">
              <span class="input-prefix">₹</span>
              <input class="form-input form-input--prefixed" type="number" id="pm-basic"
                placeholder="0" value="${v('basic_monthly')}" min="0">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">HRA</label>
            <div class="input-wrapper">
              <span class="input-prefix">₹</span>
              <input class="form-input form-input--prefixed" type="number" id="pm-hra"
                placeholder="0" value="${v('hra_monthly')}" min="0">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Special Allowance</label>
            <div class="input-wrapper">
              <span class="input-prefix">₹</span>
              <input class="form-input form-input--prefixed" type="number" id="pm-special"
                placeholder="0" value="${v('special_allowance_monthly')}" min="0">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Other Allowances</label>
            <div class="input-wrapper">
              <span class="input-prefix">₹</span>
              <input class="form-input form-input--prefixed" type="number" id="pm-other"
                placeholder="0" value="${v('other_allowances_monthly')}" min="0">
            </div>
          </div>
        </div>

        <!-- Deductions -->
        <div class="hrms-section-label">Monthly Deductions</div>
        <div class="hrms-form-grid" style="margin-bottom:20px;">
          <div class="form-group">
            <label class="form-label">PF (Employee)</label>
            <div class="input-wrapper">
              <span class="input-prefix">₹</span>
              <input class="form-input form-input--prefixed" type="number" id="pm-pf-emp"
                placeholder="0" value="${v('pf_employee_monthly')}" min="0">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">PF (Employer)</label>
            <div class="input-wrapper">
              <span class="input-prefix">₹</span>
              <input class="form-input form-input--prefixed" type="number" id="pm-pf-er"
                placeholder="0" value="${v('pf_employer_monthly')}" min="0">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Professional Tax</label>
            <div class="input-wrapper">
              <span class="input-prefix">₹</span>
              <input class="form-input form-input--prefixed" type="number" id="pm-pt"
                placeholder="0" value="${v('professional_tax_monthly')}" min="0">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">TDS</label>
            <div class="input-wrapper">
              <span class="input-prefix">₹</span>
              <input class="form-input form-input--prefixed" type="number" id="pm-tds"
                placeholder="0" value="${v('tds_monthly')}" min="0">
            </div>
          </div>
        </div>

        <!-- Live summary -->
        <div class="hrms-salary-summary" id="pm-summary">
          ${_renderSalarySummary(existingStruct || {})}
        </div>

        <!-- Notes -->
        <div class="form-group" style="margin-top:16px;">
          <label class="form-label">Notes</label>
          <textarea class="form-input" id="pm-notes" rows="2"
            placeholder="e.g. Revised as per appraisal cycle Apr 2026…" style="resize:vertical;">${v('notes')}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="pm-save-btn">${isEdit ? 'Save Changes' : 'Save Structure'}</button>
      </div>
    `, 'salary-structure-modal')

    // Live summary update
    const fields = ['pm-basic', 'pm-hra', 'pm-special', 'pm-other', 'pm-pf-emp', 'pm-pt', 'pm-tds']
    fields.forEach(id => {
      document.getElementById(id)?.addEventListener('input', _updateSummary)
    })

    function _updateSummary() {
      const s = _readModalValues()
      const el = document.getElementById('pm-summary')
      if (el) el.innerHTML = _renderSalarySummary(s)
    }

    document.getElementById('pm-save-btn').addEventListener('click', () => _submitStructure(preselectedEmp, existingStruct))
  }

  function _readModalValues() {
    const n = (id) => parseFloat(document.getElementById(id)?.value) || 0
    return {
      basic_monthly:             n('pm-basic'),
      hra_monthly:               n('pm-hra'),
      special_allowance_monthly: n('pm-special'),
      other_allowances_monthly:  n('pm-other'),
      pf_employee_monthly:       n('pm-pf-emp'),
      pf_employer_monthly:       n('pm-pf-er'),
      professional_tax_monthly:  n('pm-pt'),
      tds_monthly:               n('pm-tds'),
    }
  }

  function _renderSalarySummary(s) {
    const gross      = _calcGross(s)
    const deductions = _calcDeductions(s)
    const net        = gross - deductions
    return `
      <div class="hrms-summary-row">
        <span>Gross Monthly</span>
        <strong>${_fmt(gross)}</strong>
      </div>
      <div class="hrms-summary-row hrms-summary-row--deduction">
        <span>Total Deductions</span>
        <strong>- ${_fmt(deductions)}</strong>
      </div>
      <div class="hrms-summary-row hrms-summary-row--net">
        <span>Net Take-Home</span>
        <strong>${_fmt(net)}</strong>
      </div>
    `
  }

  async function _submitStructure(preselectedEmp, existingStruct) {
    const errEl  = document.getElementById('payroll-modal-err')
    const btn    = document.getElementById('pm-save-btn')
    errEl.style.display = 'none'

    const empId     = preselectedEmp?.id || document.getElementById('pm-employee')?.value
    const effective = document.getElementById('pm-effective')?.value
    const ctc       = parseFloat(document.getElementById('pm-ctc')?.value) || 0
    const notes     = document.getElementById('pm-notes')?.value?.trim() || null
    const vals      = _readModalValues()

    const fail = (m) => { errEl.textContent = m; errEl.style.display = 'block' }

    if (!empId)     return fail('Please select an employee.')
    if (!effective) return fail('Please select an effective date.')
    if (!ctc)       return fail('Please enter the Annual CTC.')
    if (!vals.basic_monthly) return fail('Basic salary is required.')

    btn.disabled    = true
    btn.textContent = 'Saving…'

    const payload = {
      employee_id:               empId,
      effective_from:            effective,
      ctc_annual:                ctc,
      ...vals,
      notes,
      created_by:                _user.id,
      updated_at:                new Date().toISOString(),
    }

    const { error } = existingStruct
      ? await _updateSalaryStructure(existingStruct.id, payload)
      : await _createSalaryStructure(payload)

    btn.disabled    = false
    btn.textContent = existingStruct ? 'Save Changes' : 'Save Structure'

    if (error) return fail(error.message || 'Failed to save. Please try again.')

    Utils.closeModal()
    Utils.showToast(existingStruct ? 'Salary structure updated.' : 'Salary structure saved.', 'success')
    await _loadData()
    _loadSalaryStructureTab()
  }

  /* ── API calls (salary_structures table) ─────────────────── */
  async function _getSalaryStructures() {
    return Config.supabase
      .from('salary_structures')
      .select('*, employee:employees!employee_id(id, name, department, designation)')
      .order('effective_from', { ascending: false })
  }

  async function _createSalaryStructure(data) {
    return Config.supabase
      .from('salary_structures')
      .insert(data)
      .select()
      .single()
  }

  async function _updateSalaryStructure(id, data) {
    return Config.supabase
      .from('salary_structures')
      .update(data)
      .eq('id', id)
  }

  return { render, init }

})()
