/* ============================================================
   GROWTHIC ONE — access-control.js
   Employee directory has moved to people.js (Phase 7).
   This file is kept as a stub to avoid reference errors.
   The AccessControl nav item has been removed from app.js.
   ============================================================ */

// Stub — never routed to; People module handles the directory.
const AccessControl = (() => {
  function render() { return '<div class="page-inner"><p style="color:var(--text-muted);padding:24px;">Redirecting…</p></div>' }
  function init()   { window.location.hash = 'people' }
  return { render, init }
})()
