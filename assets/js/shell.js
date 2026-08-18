/* ============================================================
   Growthic Platform — Shared Shell Behaviours
   Used by: Growthic One (app/home/), Growthic HRMS (app/hrms/)
   ============================================================ */

const Shell = (() => {

  /* ── Dark mode toggle ───────────────────────────────────── */
  function initTheme() {
    const btn  = document.getElementById('theme-toggle-btn')
    const sun  = document.getElementById('theme-icon-sun')
    const moon = document.getElementById('theme-icon-moon')
    if (!btn) return

    function _apply(isDark) {
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
      localStorage.setItem('theme', isDark ? 'dark' : 'light')
      if (sun)  sun.style.display  = isDark ? 'block' : 'none'
      if (moon) moon.style.display = isDark ? 'none'  : 'block'
    }

    _apply(document.documentElement.getAttribute('data-theme') === 'dark')
    btn.addEventListener('click', () => _apply(document.documentElement.getAttribute('data-theme') !== 'dark'))
  }

  /* ── User menu dropdown ─────────────────────────────────── */
  function initUserMenu() {
    const btn      = document.getElementById('user-avatar-btn')
    const dropdown = document.getElementById('user-dropdown')
    if (!btn || !dropdown) return

    btn.addEventListener('click', e => {
      e.stopPropagation()
      dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none'
    })
    document.addEventListener('click', () => { dropdown.style.display = 'none' })
  }

  /* ── Mobile nav: hamburger + sidebar overlay ────────────── */
  function initMobileNav() {
    const hamburger = document.getElementById('hamburger-btn')
    const sidebar   = document.getElementById('sidebar')
    const overlay   = document.getElementById('sidebar-overlay')
    if (!hamburger || !sidebar) return

    function open() {
      sidebar.classList.add('sidebar--open')
      overlay?.classList.add('sidebar-overlay--visible')
      document.body.classList.add('sidebar-is-open')
    }

    function close() {
      sidebar.classList.remove('sidebar--open')
      overlay?.classList.remove('sidebar-overlay--visible')
      document.body.classList.remove('sidebar-is-open')
    }

    hamburger.addEventListener('click', () => sidebar.classList.contains('sidebar--open') ? close() : open())
    overlay?.addEventListener('click', close)

    document.getElementById('sidebar-nav')?.addEventListener('click', e => {
      if (e.target.closest('.nav-item') && window.innerWidth <= 768) close()
    })

    window.addEventListener('hashchange', () => {
      if (window.innerWidth <= 768) close()
    })

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') close()
    })
  }

  /* ── Logout button ──────────────────────────────────────── */
  function initLogout(redirectTo = '/') {
    const btn = document.getElementById('logout-btn')
    if (!btn) return
    btn.addEventListener('click', async () => {
      btn.textContent = 'Signing out…'
      btn.disabled = true
      await Auth.signOut()
      window.location.href = redirectTo
    })
  }

  /* ── Header: avatar + user dropdown info ────────────────── */
  function renderHeaderUser(user) {
    const avatar = document.getElementById('user-avatar')
    if (avatar) {
      if (user.profile_image_url) {
        avatar.innerHTML = `<img src="${Utils.escapeHtml(user.profile_image_url)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
      } else {
        avatar.textContent = Utils.getInitials(user.name)
      }
    }
    const info = document.getElementById('user-dropdown-info')
    if (info) {
      info.innerHTML = `
        <div class="dropdown-user-name">${Utils.escapeHtml(user.name)}</div>
        <div class="dropdown-user-role">${Utils.getRoleLabel(user.role)}</div>
        ${user.department ? `<div class="dropdown-user-dept">${Utils.getDeptLabel(user.department)}</div>` : ''}
      `
    }
  }

  /* ── App Switcher ───────────────────────────────────────── */
  function initAppSwitcher(currentAppId, user) {
    const headerActions = document.querySelector('.header-actions')
    if (!headerActions || typeof PlatformConfig === 'undefined') return

    const WAFFLE = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`

    const btn = document.createElement('button')
    btn.className  = 'btn-icon'
    btn.id         = 'app-switcher-btn'
    btn.title      = 'Switch app'
    btn.setAttribute('aria-label', 'Switch app')
    btn.innerHTML  = WAFFLE
    headerActions.insertBefore(btn, headerActions.firstChild)

    const popover = document.createElement('div')
    popover.id        = 'app-switcher-popover'
    popover.className = 'app-switcher-popover'
    popover.style.display = 'none'
    document.body.appendChild(popover)

    function _open() {
      const apps = PlatformConfig.getAccessible(user)
      const rect  = btn.getBoundingClientRect()
      // Anchor to the button's RIGHT edge, not its left — the button sits
      // near the right side of the header, so a left-anchored popover can
      // run off the viewport. Right-anchoring keeps it fully on-screen.
      popover.style.top   = `${rect.bottom + 8}px`
      popover.style.left  = 'auto'
      popover.style.right = `${window.innerWidth - rect.right}px`
      popover.innerHTML = `
        <div class="app-switcher-label">Apps</div>
        <div class="app-switcher-grid">
          ${apps.map(app => {
            const isCurrent = app.id === currentAppId
            return `
              <a class="app-switcher-item${isCurrent ? ' app-switcher-item--current' : ''}"
                 href="${app.path}" ${isCurrent ? 'aria-current="page" tabindex="-1"' : ''}>
                <div class="app-switcher-icon">${app.icon || app.shortName[0]}</div>
                <div class="app-switcher-name">${app.name}</div>
                ${isCurrent ? '<div class="app-switcher-badge">Current</div>' : ''}
              </a>`
          }).join('')}
        </div>`

      popover.querySelectorAll('.app-switcher-item--current').forEach(el => {
        el.addEventListener('click', e => e.preventDefault())
      })

      popover.style.display = 'block'
    }

    btn.addEventListener('click', e => {
      e.stopPropagation()
      popover.style.display !== 'none' ? (popover.style.display = 'none') : _open()
    })

    document.addEventListener('click', e => {
      if (!popover.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
        popover.style.display = 'none'
      }
    })
  }

  return { initTheme, initUserMenu, initMobileNav, initLogout, renderHeaderUser, initAppSwitcher }
})()
