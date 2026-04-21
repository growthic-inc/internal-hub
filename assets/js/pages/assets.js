/* ============================================================
   ASSET MANAGEMENT — Phase 2
   ============================================================ */

const Assets = (() => {

  const ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"></line><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>`

  function render(user) {
    return `
      <div class="page-inner">
        <div class="stub-container">
          <div class="stub-card">
            <div class="stub-icon">${ICON}</div>
            <h2>Asset Management</h2>
            <p>Track company physical assets, request items, manage availability, and log returns. HR manages the full inventory and approves requests.</p>
            <span class="badge badge--muted">Phase 2</span>
          </div>
        </div>
      </div>
    `
  }

  return { render }
})()
