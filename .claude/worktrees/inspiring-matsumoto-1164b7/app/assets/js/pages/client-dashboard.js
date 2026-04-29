/* ============================================================
   CLIENT DASHBOARD — Phase 1
   ============================================================ */

const ClientDashboard = (() => {

  const ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>`

  function render(user) {
    return `
      <div class="page-inner">
        <div class="stub-container">
          <div class="stub-card">
            <div class="stub-icon">${ICON}</div>
            <h2>Client Dashboard</h2>
            <p>Performance tracking, KPI cards, engagement trends, SOW progress, and top content — per client, per platform.</p>
            <span class="badge badge--primary">Phase 1 — Coming next</span>
          </div>
        </div>
      </div>
    `
  }

  return { render }
})()
