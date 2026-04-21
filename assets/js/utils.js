/* ============================================================
   GROWTHIC ONE — Shared Utilities
   ============================================================ */

const Utils = (() => {

  /* ── Date formatting ──────────────────────────────────────── */
  function formatDate(dateStr, options = {}) {
    if (!dateStr) return '—'
    const d = new Date(dateStr)
    if (isNaN(d)) return '—'
    return d.toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
      ...options
    })
  }

  function formatDateShort(dateStr) {
    return formatDate(dateStr, { day: 'numeric', month: 'short' })
  }

  function formatMonth(dateStr) {
    if (!dateStr) return '—'
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
  }

  /* ── Currency ─────────────────────────────────────────────── */
  function formatCurrency(amount) {
    if (amount == null) return '—'
    return '₹' + Number(amount).toLocaleString('en-IN')
  }

  /* ── String helpers ───────────────────────────────────────── */
  function getInitials(name) {
    if (!name) return '??'
    return name.trim().split(/\s+/).map(n => n[0]).join('').toUpperCase().slice(0, 2)
  }

  function escapeHtml(str) {
    if (str == null) return ''
    return String(str)
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;')
      .replace(/'/g,  '&#39;')
  }

  function truncate(str, maxLen = 60) {
    if (!str) return ''
    return str.length > maxLen ? str.slice(0, maxLen) + '…' : str
  }

  /* ── Role display labels ──────────────────────────────────── */
  const ROLE_LABELS = {
    super_admin:     'Super Admin',
    founders_office: "Founder's Office",
    team_lead:       'Team Lead',
    bde:             'BDE',
    delivery:        'Delivery Team',
    hr:              'HR',
  }

  function getRoleLabel(role) {
    return ROLE_LABELS[role] || role
  }

  /* ── Toast notifications ──────────────────────────────────── */
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container')
    if (!container) return

    const toast = document.createElement('div')
    toast.className = `toast toast--${type}`
    toast.textContent = message
    container.appendChild(toast)

    requestAnimationFrame(() => {
      requestAnimationFrame(() => toast.classList.add('toast--visible'))
    })

    setTimeout(() => {
      toast.classList.remove('toast--visible')
      setTimeout(() => toast.remove(), 300)
    }, 3500)
  }

  /* ── Modal helpers ────────────────────────────────────────── */
  function openModal(html) {
    closeModal()
    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay'
    overlay.id = 'active-modal-overlay'
    overlay.innerHTML = `<div class="modal">${html}</div>`
    document.body.appendChild(overlay)

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal()
    })
    document.addEventListener('keydown', _escCloseModal)
  }

  function closeModal() {
    const existing = document.getElementById('active-modal-overlay')
    if (existing) existing.remove()
    document.removeEventListener('keydown', _escCloseModal)
  }

  function _escCloseModal(e) {
    if (e.key === 'Escape') closeModal()
  }

  /* ── Drawer helpers ───────────────────────────────────────── */
  function openDrawer(html) {
    closeDrawer()
    const overlay = document.createElement('div')
    overlay.className = 'drawer-overlay'
    overlay.id = 'active-drawer-overlay'
    overlay.innerHTML = `<div class="drawer">${html}</div>`
    document.body.appendChild(overlay)

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeDrawer()
    })
    document.addEventListener('keydown', _escCloseDrawer)
  }

  function closeDrawer() {
    const existing = document.getElementById('active-drawer-overlay')
    if (existing) existing.remove()
    document.removeEventListener('keydown', _escCloseDrawer)
  }

  function _escCloseDrawer(e) {
    if (e.key === 'Escape') closeDrawer()
  }

  /* ── DOM helpers ──────────────────────────────────────────── */
  function el(id) { return document.getElementById(id) }

  function on(id, event, handler) {
    const elem = typeof id === 'string' ? document.getElementById(id) : id
    if (elem) elem.addEventListener(event, handler)
  }

  /* ── Debounce ─────────────────────────────────────────────── */
  function debounce(fn, delay = 300) {
    let timer
    return (...args) => {
      clearTimeout(timer)
      timer = setTimeout(() => fn(...args), delay)
    }
  }

  /* ── Permission check helper ──────────────────────────────── */
  function canAccess(userRole, allowedRoles) {
    return allowedRoles.includes(userRole)
  }

  return {
    formatDate,
    formatDateShort,
    formatMonth,
    formatCurrency,
    getInitials,
    escapeHtml,
    truncate,
    getRoleLabel,
    showToast,
    openModal,
    closeModal,
    openDrawer,
    closeDrawer,
    el,
    on,
    debounce,
    canAccess,
  }
})()
