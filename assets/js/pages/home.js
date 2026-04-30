/* ============================================================
   HOME — Personalised Dashboard
   Growthic One — Phase 7
   ============================================================ */

const HomeModule = (() => {

  let _user = null
  const currentYear = new Date().getFullYear()

  /* ── Helpers ─────────────────────────────────────────────── */

  function _greeting() {
    const h = new Date().getHours()
    if (h >= 5  && h < 12) return 'Good morning'
    if (h >= 12 && h < 17) return 'Good afternoon'
    if (h >= 17 && h < 21) return 'Good evening'
    return 'Working late?'
  }

  function _formattedToday() {
    return new Date().toLocaleDateString('en-IN', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    })
  }

  function _motivationalLine() {
    const lines = [
      'Great things are built one day at a time.',
      "You're doing better than you think.",
      'Make today count.',
      'Progress, not perfection.',
      'Small steps, big impact.',
      'Another chance to do great work.',
      "Keep going — you've got this.",
    ]
    return lines[new Date().getDay()]
  }

  function _relativeTime(dateStr) {
    if (!dateStr) return ''
    const now  = new Date()
    const then = new Date(dateStr)
    const diffMs = now - then
    const diffDays = diffMs / 86400000
    if (diffDays < 1)  return 'Today'
    if (diffDays < 2)  return 'Yesterday'
    return Utils.formatDate(dateStr)
  }

  function _leaveDays(req) {
    if (req.is_half_day) return 0.5
    const s = new Date(req.start_date)
    const e = new Date(req.end_date)
    return Math.max(0, Math.round((e - s) / 86400000) + 1)
  }

  function _todayISO() {
    const d = new Date()
    return d.toISOString().split('T')[0]
  }

  function _avatarHtml(person) {
    if (person.profile_image_url) {
      return `<img src="${Utils.escapeHtml(person.profile_image_url)}"
                   alt="${Utils.escapeHtml(person.name)}"
                   style="width:32px;height:32px;border-radius:50%;object-fit:cover;">`
    }
    return `<span class="avatar-circle avatar-circle--sm">${Utils.escapeHtml(Utils.getInitials(person.name))}</span>`
  }

  /* ── Stat card ───────────────────────────────────────────── */

  function _statCard(value, label, color) {
    return `
      <div class="home-stat-card section-card">
        <div class="home-stat-value" style="color:${color}">${value}</div>
        <div class="home-stat-label">${label}</div>
      </div>`
  }

  /* ── Section: Upcoming Leaves ────────────────────────────── */

  function _renderUpcomingLeaves(upcomingLeaves) {
    const rows = upcomingLeaves.length
      ? upcomingLeaves.map(req => {
          const days  = _leaveDays(req)
          const type  = Utils.escapeHtml(req.leave_types?.name || 'Leave')
          const start = Utils.formatDate(req.start_date)
          const end   = Utils.formatDate(req.end_date)
          const range = req.start_date === req.end_date ? start : `${start} – ${end}`
          return `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);">
              <div>
                <div style="font-weight:600;font-size:14px;">${type}</div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${range}</div>
              </div>
              <span class="badge badge--success">${days} day${days !== 1 ? 's' : ''}</span>
            </div>`
        }).join('')
      : `<p class="empty-state-text">No upcoming approved leaves.</p>`
    return `
      <div class="section-card" style="margin-bottom:16px;">
        <div class="section-card-header"><h3>My Upcoming Leaves</h3></div>
        <div class="section-card-body">${rows}</div>
      </div>`
  }

  /* ── Section: Pending Approvals ──────────────────────────── */

  function _renderPendingApprovals(count) {
    if (!count || count < 1) return ''
    return `
      <div class="section-card">
        <div class="section-card-header"><h3>Pending Approvals</h3></div>
        <div class="section-card-body" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
          <span>You have <strong>${count}</strong> request${count !== 1 ? 's' : ''} awaiting your action.</span>
          <button class="btn btn--primary btn--sm" onclick="window.location.hash='leave-tracker'">Review</button>
        </div>
      </div>`
  }

  /* ── Section: Upcoming Holidays ──────────────────────────── */

  function _renderHolidays(holidays) {
    const rows = holidays.length
      ? holidays.slice(0, 3).map(h => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
            <span style="font-size:14px;">${Utils.escapeHtml(h.name)}</span>
            <span style="font-size:12px;color:var(--text-muted);">${Utils.formatDate(h.date)}</span>
          </div>`).join('')
      : `<p class="empty-state-text">No upcoming holidays.</p>`
    return `
      <div class="section-card" style="margin-bottom:16px;">
        <div class="section-card-header"><h3>Upcoming Holidays</h3></div>
        <div class="section-card-body">${rows}</div>
      </div>`
  }

  /* ── Section: Recent Announcements ──────────────────────── */

  function _renderAnnouncements(announcements) {
    const rows = announcements.length
      ? announcements.slice(0, 2).map(a => {
          const author = a.employees?.name ? ` · ${Utils.escapeHtml(a.employees.name)}` : ''
          return `
            <div style="padding:10px 0;border-bottom:1px solid var(--border);">
              <div style="font-weight:600;font-size:14px;margin-bottom:4px;">${Utils.escapeHtml(a.title)}</div>
              <div style="font-size:13px;color:var(--text-secondary);margin-bottom:6px;">${Utils.escapeHtml(Utils.truncate(a.body, 120))}</div>
              <div style="font-size:11px;color:var(--text-muted);">${_relativeTime(a.created_at)}${author}</div>
            </div>`
        }).join('')
      : `<p class="empty-state-text">No announcements yet.</p>`
    return `
      <div class="section-card">
        <div class="section-card-header"><h3>Recent Announcements</h3></div>
        <div class="section-card-body">${rows}</div>
      </div>`
  }

  /* ── Section: Work Anniversaries ────────────────────────── */

  function _renderAnniversaries(workAnniversaries) {
    const today     = new Date()
    const todayMM   = today.getMonth() + 1
    const todayDD   = today.getDate()

    const celebrants = (workAnniversaries || []).filter(emp => {
      if (!emp.joining_date) return false
      const joined = new Date(emp.joining_date)
      if (joined.getFullYear() >= currentYear) return false
      return (joined.getMonth() + 1) === todayMM && joined.getDate() === todayDD
    })

    if (!celebrants.length) return ''

    const cards = celebrants.map(emp => {
      const years = currentYear - new Date(emp.joining_date).getFullYear()
      return `
        <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border);">
          ${_avatarHtml(emp)}
          <div style="flex:1;">
            <div style="font-weight:600;font-size:14px;">${Utils.escapeHtml(emp.name)}</div>
            <div style="font-size:12px;color:var(--text-muted);">${Utils.escapeHtml(emp.designation || '')}</div>
          </div>
          <span class="badge badge--primary">${years} year${years !== 1 ? 's' : ''} at Growthic</span>
        </div>`
    }).join('')

    return `
      <div class="section-card" style="margin-top:16px;">
        <div class="section-card-header"><h3>🎉 Work Anniversaries Today</h3></div>
        <div class="section-card-body">${cards}</div>
      </div>`
  }

  /* ── render ──────────────────────────────────────────────── */

  function render(user) {
    return `
      <div class="page-inner">
        <div id="home-content"><div class="page-loading">Loading…</div></div>
      </div>`
  }

  /* ── init ────────────────────────────────────────────────── */

  async function init(user) {
    _user = user

    const [
      { data: leaveData },
      { data: holidays },
      { data: announcements },
      pendingApprovalsCount,
      { data: workAnniversaries },
    ] = await Promise.all([
      API.getHomeLeaveData(user.id, currentYear),
      API.getUpcomingHolidays(3),
      API.getRecentAnnouncements(2),
      API.getPendingApprovalsCount(user.id),
      API.getWorkAnniversaries(),
    ])

    /* ── Leave stats ── */
    const credits  = leaveData?.credits  || []
    const requests = leaveData?.requests || []

    const totalCredited = credits.reduce((sum, c) => sum + Number(c.credited_days || 0), 0)

    const usedDays = requests
      .filter(r => r.status === 'approved' && new Date(r.start_date).getFullYear() === currentYear)
      .reduce((sum, r) => sum + _leaveDays(r), 0)

    const remaining    = totalCredited - usedDays
    const pendingCount = requests.filter(r => r.status === 'pending').length

    const todayISO = _todayISO()
    const upcomingLeaves = requests
      .filter(r => r.status === 'approved' && r.start_date >= todayISO)
      .sort((a, b) => a.start_date.localeCompare(b.start_date))
      .slice(0, 2)

    /* ── Build HTML ── */
    const firstName = Utils.escapeHtml((user.name || '').split(' ')[0])

    const html = `
      <section class="home-greeting">
        <div style="font-size:24px;font-weight:700;">${_greeting()}, ${firstName} 👋</div>
        <div style="font-size:13px;color:var(--text-muted);margin-top:4px;">${_formattedToday()}</div>
        <div style="font-size:13px;color:var(--text-muted);margin-top:2px;">${_motivationalLine()}</div>
      </section>

      <div class="home-stats-row">
        ${_statCard(remaining,     'Days Remaining',  'var(--primary)')}
        ${_statCard(usedDays,      'Days Used',       'var(--text-muted)')}
        ${_statCard(pendingCount,  'Pending',         'var(--warning)')}
        ${_statCard(totalCredited, 'Total Allocated', 'var(--success)')}
      </div>

      <div class="home-content-row">
        <div style="flex:1.5;min-width:0;">
          ${_renderUpcomingLeaves(upcomingLeaves)}
          ${_renderPendingApprovals(pendingApprovalsCount)}
        </div>
        <div style="flex:1;min-width:0;">
          ${_renderHolidays(holidays || [])}
          ${_renderAnnouncements(announcements || [])}
        </div>
      </div>

      ${_renderAnniversaries(workAnniversaries || [])}
    `

    const el = document.getElementById('home-content')
    if (el) el.innerHTML = html
  }

  return { render, init }

})()
