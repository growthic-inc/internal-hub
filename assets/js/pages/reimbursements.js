/* ============================================================
   REIMBURSEMENTS — Phase 2
   ============================================================ */

const Reimbursements = (() => {

  const ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>`

  function render(user) {
    return `
      <div class="page-inner">
        <div class="stub-container">
          <div class="stub-card">
            <div class="stub-icon">${ICON}</div>
            <h2>Reimbursements</h2>
            <p>Submit expense claims with receipt upload, linked to project codes. Two-step approval: Team Lead then HR. HR can export approved claims for payroll.</p>
            <span class="badge badge--muted">Phase 2</span>
          </div>
        </div>
      </div>
    `
  }

  return { render }
})()
