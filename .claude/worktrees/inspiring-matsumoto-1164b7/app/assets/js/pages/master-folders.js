/* ============================================================
   MASTER FOLDERS — Phase 1
   ============================================================ */

const MasterFolders = (() => {

  const ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`

  function render(user) {
    return `
      <div class="page-inner">
        <div class="stub-container">
          <div class="stub-card">
            <div class="stub-icon">${ICON}</div>
            <h2>Master Folders</h2>
            <p>Centralised repository for final client deliverables — Approved Content, Creatives, and Reports — organised by client and month, stored in Google Drive.</p>
            <span class="badge badge--primary">Phase 1 — Coming next</span>
          </div>
        </div>
      </div>
    `
  }

  return { render }
})()
