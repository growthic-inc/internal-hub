/* ============================================================
   Growthic Platform — Shared Utilities
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

  // "01st August 2026" — zero-padded ordinal day + full month name, for the
  // report cover slide's period line (e.g. "01st August 2026 - 31st August 2026").
  function formatDateOrdinal(dateStr) {
    if (!dateStr) return '—'
    const d = new Date(dateStr)
    if (isNaN(d)) return '—'
    const day = d.getDate()
    const suffix = (day % 10 === 1 && day !== 11) ? 'st'
      : (day % 10 === 2 && day !== 12) ? 'nd'
      : (day % 10 === 3 && day !== 13) ? 'rd'
      : 'th'
    const month = d.toLocaleDateString('en-IN', { month: 'long' })
    return `${String(day).padStart(2, '0')}${suffix} ${month} ${d.getFullYear()}`
  }

  function formatDateTime(dateStr) {
    if (!dateStr) return '—'
    const d = new Date(dateStr)
    if (isNaN(d)) return '—'
    return d.toLocaleString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    })
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
    super_admin: 'Super Admin',
    admin:       'Admin',
    employee:    'Employee',
    // Legacy values — kept so old data still renders correctly
    founders_office: "Founder's Office",
    team_lead:       'Team Lead',
    bde:             'Business Development',
    delivery:        'Delivery',
    hr:              'People & Culture',
    finance:         'Finance',
  }

  // Static fallback labels — used if departments table hasn't loaded yet
  const DEPT_LABELS = {
    management:           'Management',
    operations_growth:    'Operations & Growth',
    people_culture:       'People & Culture',
    business_development: 'Business Development',
    content_strategy:     'Content',
    creative:             'Creative',
    creators:             'Creators',
    finance:              'Finance',
  }

  // Dynamic department cache — populated by People/Leave modules after
  // loading from API.getDepartments(). Falls back to DEPT_LABELS if empty.
  let _deptCache    = {}   // slug -> display name
  let _deptKeyCache = {}   // slug -> immutable system_key

  function setDeptCache(departments) {
    _deptCache    = {}
    _deptKeyCache = {}
    ;(departments || []).forEach(d => {
      _deptCache[d.slug]    = d.name
      if (d.system_key) _deptKeyCache[d.slug] = d.system_key
    })
  }

  function getDeptLabel(dept) {
    return _deptCache[dept] || DEPT_LABELS[dept] || dept
  }

  // Resolve a department slug to its immutable system_key. Privilege
  // checks use this so they survive renames (the slug may change, the
  // system_key never does). Falls back to the slug itself — safe because
  // the original departments' slug == system_key.
  function getDeptSystemKey(dept) {
    return _deptKeyCache[dept] || dept
  }

  /* ── Employment type labels ───────────────────────────────── */
  const EMPLOYMENT_TYPE_LABELS = {
    full_time:  'Full Time',
    part_time:  'Part Time',
    freelancer: 'Freelancer',
    intern:     'Intern',
    probation:  'Probation',
  }

  function getEmploymentTypeLabel(type) {
    return EMPLOYMENT_TYPE_LABELS[type] || type
  }

  /* ── Work location labels ─────────────────────────────────── */
  const WORK_LOCATION_LABELS = {
    office: 'Office',
    remote: 'Remote',
    hybrid: 'Hybrid',
  }

  function getWorkLocationLabel(loc) {
    return WORK_LOCATION_LABELS[loc] || loc
  }

  const EXPENSE_LABELS = {
    travel:                  'Travel (Cab / Train / Flight)',
    food_meals:              'Food & Meals',
    printing_stationery:     'Printing & Stationery',
    internet_communication:  'Internet & Communication',
    photography_videography: 'Photography & Videography',
    event_venue:             'Event & Venue',
    software_tools:          'Software & Tools',
    courier_delivery:        'Courier & Delivery',
    marketing_materials:     'Marketing Materials',
    accommodation:           'Accommodation',
    other:                   'Other',
  }

  function getExpenseLabel(type) {
    return EXPENSE_LABELS[type] || type
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
  function openModal(html, cls = '') {
    closeModal()
    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay'
    overlay.id = 'active-modal-overlay'
    overlay.innerHTML = `<div class="modal${cls ? ' ' + cls : ''}">${html}</div>`
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

  function todayIST() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  }

  /* ── CSV export ───────────────────────────────────────────── */
  function downloadCSV(filename, headers, rows) {
    const cell = v => {
      const s = v == null ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv  = [headers, ...rows].map(row => row.map(cell).join(',')).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  /* ── Attendance day-status classifier ────────────────────────
     Single source of truth for "what does this day show" — used by
     the Leave Tracker's Attendance tab, HRMS Team Overview's calendar,
     and the Home dashboard's attendance card, so all three can never
     drift apart on the same priority order again:
     Sunday > Holiday > Leave > WFH > Client Visit > punch record.

     ctx: {
       holiday:     string name, or falsy
       leave:       { name, status, is_half_day, half_day_period, is_late_half_day } or falsy
       isWfh:       boolean
       cv:          truthy (object or true) or falsy
       attendance:  raw employee_attendance row, or falsy
       todayISO:    'YYYY-MM-DD' — used to tell "future" from "no data yet"
     }
     Returns { state, ...extra } — state is one of:
     off | holiday | leave | leave-pending | wfh | cv | present | late |
     partial | absent | blank | future | no-data
     A still-pending Leave doesn't hide an existing WFH/Client Visit —
     both stand until the Leave is actually decided, so those cases
     return the WFH/CV state plus a `pendingLeave` field the caller can
     use to show both. `blank` means an attendance row exists (e.g.
     today, before punch-in) but carries no punch/absence data yet —
     distinct from `no-data` (no row at all) so callers don't mislabel
     "not punched in yet" as "no record". */
  function computeDayStatus(iso, ctx) {
    const { holiday, leave, isWfh, cv, attendance, todayISO } = ctx || {}
    const isSunday = new Date(iso + 'T00:00:00').getDay() === 0

    if (isSunday) return { state: 'off' }
    if (holiday)  return { state: 'holiday', label: holiday }

    if (leave && leave.status === 'pending' && (isWfh || cv)) {
      return isWfh ? { state: 'wfh', pendingLeave: leave } : { state: 'cv', cv, pendingLeave: leave }
    }
    if (leave) return { state: leave.status === 'pending' ? 'leave-pending' : 'leave', leave }
    if (isWfh) return { state: 'wfh' }
    if (cv)    return { state: 'cv', cv, attendance }

    if (attendance) {
      if (attendance.is_exempted) return { state: 'present', attendance, exempted: true }
      if (attendance.is_absent)   return { state: 'absent', attendance }
      if (attendance.punch_in && attendance.punch_out) {
        return { state: attendance.late_minutes > 0 ? 'late' : 'present', attendance }
      }
      if (attendance.punch_in) {
        return { state: attendance.late_minutes > 0 ? 'late' : 'partial', attendance }
      }
      return { state: 'blank', attendance }
    }
    if (todayISO && iso > todayISO) return { state: 'future' }
    return { state: 'no-data' }
  }

  return {
    formatDate,
    formatDateShort,
    formatDateOrdinal,
    formatDateTime,
    formatMonth,
    formatCurrency,
    getInitials,
    escapeHtml,
    truncate,
    getRoleLabel,
    getDeptLabel,
    getDeptSystemKey,
    setDeptCache,
    getExpenseLabel,
    getEmploymentTypeLabel,
    getWorkLocationLabel,
    showToast,
    openModal,
    closeModal,
    openDrawer,
    closeDrawer,
    el,
    on,
    debounce,
    canAccess,
    todayIST,
    computeDayStatus,
    downloadCSV,
    EMPLOYMENT_TYPE_LABELS,
    WORK_LOCATION_LABELS,
  }
})()
