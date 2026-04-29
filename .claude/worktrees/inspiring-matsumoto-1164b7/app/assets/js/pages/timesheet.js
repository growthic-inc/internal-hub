/* ============================================================
   TIMESHEET — Phase 1
   ============================================================ */

const Timesheet = (() => {

  const ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`

  function render(user) {
    return `
      <div class="page-inner">
        <div class="stub-container">
          <div class="stub-card">
            <div class="stub-icon">${ICON}</div>
            <h2>Timesheet</h2>
            <p>Log daily work linked to clients and project codes. Two-step approval flow: Draft → Submitted → Approved. Team Leads review and approve their team's entries.</p>
            <span class="badge badge--primary">Phase 1 — Coming next</span>
          </div>
        </div>
      </div>
    `
  }

  return { render }
})()
