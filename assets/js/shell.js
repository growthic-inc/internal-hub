/* ============================================================
   Growthic Platform — Shared Shell Behaviours
   Used by: Growthic One (app/home/), Growthic HRMS (app/home/hrms/)
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

  return { initTheme, initUserMenu, initMobileNav, initLogout, renderHeaderUser }
})()
