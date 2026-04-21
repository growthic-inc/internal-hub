/* ============================================================
   ACCESS CONTROL — Super Admin only
   ============================================================ */

const AccessControl = (() => {

  const ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>`

  function render(user) {
    return `
      <div class="page-inner">
        <div class="stub-container">
          <div class="stub-card">
            <div class="stub-icon">${ICON}</div>
            <h2>Access Control</h2>
            <p>Admin-level matrix showing which team members have access to which tools and social media accounts. Toggle access directly from the matrix.</p>
            <span class="badge badge--muted">Future phase</span>
          </div>
        </div>
      </div>
    `
  }

  return { render }
})()
