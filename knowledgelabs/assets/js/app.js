/* ============================================================
   Knowledge Labs — App Shell
   Single-purpose app (one page: the department directory + resource
   browser), so no ModuleRegistry/router — unlike /home and /hrms —
   just an auth guard and a straight render. Everyone past login can
   open this app; RLS on knowledge_resources is what actually decides
   which resources they see (own department + any explicit grants).
   ============================================================ */

const KnowledgeLabsApp = (() => {

  let _currentUser = null

  const ICON_LABS = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v6l-6 10a2 2 0 0 0 2 3h14a2 2 0 0 0 2-3l-6-10V2"/><line x1="9" y1="2" x2="15" y2="2"/></svg>`

  async function init() {
    try {
      const session = await Auth.requireAuth()
      if (!session) return

      _currentUser = await Auth.getCurrentUser()
      if (!_currentUser) {
        await Auth.signOut()
        window.location.href = '/'
        return
      }

      _renderSidebar()
      Shell.renderHeaderUser(_currentUser)
      Shell.initUserMenu()
      Shell.initLogout()
      Shell.initTheme()
      Shell.initMobileNav()
      Shell.initAppSwitcher('knowledgelabs', _currentUser)

      const content = document.getElementById('page-content')
      if (content && typeof KnowledgeLabsBrowse.render === 'function') {
        content.innerHTML = KnowledgeLabsBrowse.render(_currentUser)
      }
      if (typeof KnowledgeLabsBrowse.init === 'function') {
        await KnowledgeLabsBrowse.init(_currentUser)
      }

    } catch (err) {
      console.error('[Knowledge Labs] init() failed:', err)
      const content = document.getElementById('page-content')
      if (content) content.innerHTML = `
        <div style="padding:32px;color:var(--danger,#EF4444);">
          <strong>Knowledge Labs failed to load.</strong><br>
          <code style="font-size:12px;">${err?.message || String(err)}</code>
        </div>`
    }
  }

  function _renderSidebar() {
    const nav = document.getElementById('sidebar-nav')
    if (!nav) return
    nav.innerHTML = `
      <a class="nav-item nav-item--active" href="#">
        <span class="nav-icon">${ICON_LABS}</span>
        <span class="nav-label">Library</span>
      </a>`
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }

  return {}
})()
