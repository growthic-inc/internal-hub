/* ============================================================
   HOME — Morning Briefing Dashboard
   Growthic One — Phase 10
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
    const diffDays = (Date.now() - new Date(dateStr)) / 86400000
    if (diffDays < 1)  return 'Today'
    if (diffDays < 2)  return 'Yesterday'
    return Utils.formatDate(dateStr)
  }

  function _todayISO() {
    return new Date().toISOString().split('T')[0]
  }

  function _avatarHtml(person) {
    if (person.profile_image_url) {
      return `<img src="${Utils.escapeHtml(person.profile_image_url)}"
                   alt="${Utils.escapeHtml(person.name)}"
                   style="width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0;">`
    }
    return `<span class="avatar-circle avatar-circle--sm" style="flex-shrink:0;">${Utils.escapeHtml(Utils.getInitials(person.name))}</span>`
  }

  function _birthdaysInRange(employees, days = 7) {
    const today = new Date()
    const result = []
    for (const emp of employees) {
      if (!emp.date_of_birth) continue
      const dob = new Date(emp.date_of_birth)
      for (let i = 0; i < days; i++) {
        const d = new Date(today)
        d.setDate(today.getDate() + i)
        if (dob.getMonth() === d.getMonth() && dob.getDate() === d.getDate()) {
          result.push({ ...emp, birthdayDate: new Date(d), isToday: i === 0 })
          break
        }
      }
    }
    return result.sort((a, b) => a.birthdayDate - b.birthdayDate)
  }

  /* ── Section: Timesheet nudge ─────────────────────────────── */

  function _renderTimesheetNudge(entries) {
    const all        = entries || []
    const totalHours = all.reduce((s, e) => s + Number(e.hours || 0), 0)
    const draftCount = all.filter(e => e.status === 'draft').length

    let icon, message, sub, actionHtml, color

    if (!totalHours) {
      icon       = '🕐'
      color      = 'var(--warning)'
      message    = "You haven't logged any hours today."
      sub        = 'Add your first entry to get started.'
      actionHtml = `<a href="#timesheet" class="btn btn--primary btn--sm">Log Time</a>`
    } else if (draftCount > 0) {
      icon       = '📋'
      color      = 'var(--primary)'
      message    = `${totalHours.toFixed(1)}h logged today — ${draftCount} draft${draftCount > 1 ? 's' : ''} pending submission.`
      sub        = 'Submit your drafts for manager review.'
      actionHtml = `<a href="#timesheet" class="btn btn--primary btn--sm">Go to Timesheet</a>`
    } else {
      icon       = '✅'
      color      = 'var(--success)'
      message    = `${totalHours.toFixed(1)}h logged and submitted today.`
      sub        = "You're all set!"
      actionHtml = `<a href="#timesheet" class="btn btn--ghost btn--sm">View Timesheet</a>`
    }

    return `
      <div class="section-card" style="display:flex;align-items:center;gap:16px;margin-bottom:16px;">
        <div style="font-size:28px;line-height:1;">${icon}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:14px;color:${color};">${message}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${sub}</div>
        </div>
        ${actionHtml}
      </div>`
  }

  /* ── Section: Pending Approvals ──────────────────────────── */

  function _renderPendingApprovals(leaveCount, tsCount) {
    const items = []
    if (leaveCount > 0) items.push({ label: `${leaveCount} leave/WFH request${leaveCount > 1 ? 's' : ''}`, hash: 'leave-tracker' })
    if (tsCount    > 0) items.push({ label: `${tsCount} timesheet entr${tsCount > 1 ? 'ies' : 'y'}`, hash: 'timesheet' })
    if (!items.length) return ''

    const rows = items.map(item => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 0;">
        <span style="font-size:14px;">⏳ <strong>${item.label}</strong> awaiting your review</span>
        <a href="#${item.hash}" class="btn btn--primary btn--sm">Review</a>
      </div>`).join('')

    return `
      <div class="section-card" style="margin-bottom:16px;">
        <div class="section-card-header"><h3>Pending Approvals</h3></div>
        <div class="section-card-body">${rows}</div>
      </div>`
  }

  /* ── Section: Who's out today ─────────────────────────────── */

  function _renderWhoIsOut(rows, currentUserId) {
    const people = (rows || [])
      .map(r => r.employees)
      .filter(emp => emp && emp.id !== currentUserId)

    const cards = people.length
      ? people.map(emp => `
          <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);">
            ${_avatarHtml(emp)}
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${Utils.escapeHtml(emp.name)}</div>
              <div style="font-size:12px;color:var(--text-muted);">${Utils.escapeHtml(emp.designation || emp.department || '')}</div>
            </div>
            <span class="badge badge--warning">OOO</span>
          </div>`).join('')
      : `<p class="empty-state-text">Everyone's in today.</p>`

    return `
      <div class="section-card" style="margin-bottom:16px;">
        <div class="section-card-header"><h3>Who's Out Today</h3></div>
        <div class="section-card-body">${cards}</div>
      </div>`
  }

  /* ── Section: Birthdays this week ────────────────────────── */

  function _renderBirthdays(employees) {
    const celebrants = _birthdaysInRange(employees, 7)
    if (!celebrants.length) return ''

    const cards = celebrants.map(emp => {
      const label    = emp.isToday ? 'Today' : emp.birthdayDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
      const badgeCls = emp.isToday ? 'badge--danger' : 'badge--muted'
      return `
        <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border);">
          ${_avatarHtml(emp)}
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:14px;">${Utils.escapeHtml(emp.name)}</div>
            <div style="font-size:12px;color:var(--text-muted);">${Utils.escapeHtml(emp.designation || '')}</div>
          </div>
          <span class="badge ${badgeCls}">${label}</span>
        </div>`
    }).join('')

    return `
      <div class="section-card" style="margin-bottom:16px;">
        <div class="section-card-header"><h3>🎂 Birthdays This Week</h3></div>
        <div class="section-card-body">${cards}</div>
      </div>`
  }

  /* ── Section: Work Anniversaries ────────────────────────── */

  function _renderAnniversaries(workAnniversaries) {
    const today   = new Date()
    const todayMM = today.getMonth() + 1
    const todayDD = today.getDate()

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
          <span class="badge badge--primary">${years} yr${years !== 1 ? 's' : ''} 🎉</span>
        </div>`
    }).join('')

    return `
      <div class="section-card" style="margin-bottom:16px;">
        <div class="section-card-header"><h3>🎉 Work Anniversaries Today</h3></div>
        <div class="section-card-body">${cards}</div>
      </div>`
  }

  /* ── Section: Upcoming Holidays ──────────────────────────── */

  function _renderHolidays(holidays) {
    const rows = (holidays || []).length
      ? holidays.slice(0, 5).map(h => `
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
    const rows = (announcements || []).length
      ? announcements.slice(0, 3).map(a => {
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
    const todayISO = _todayISO()

    const [
      { data: todayEntries },
      { data: whoIsOut },
      pendingLeaveCount,
      pendingTsCount,
      { data: holidays },
      { data: announcements },
      { data: workAnniversaries },
      { data: allEmployees },
    ] = await Promise.all([
      API.getTimesheetEntries(user.id, todayISO, todayISO),
      API.getWhoIsOutToday(),
      API.getPendingApprovalsCount(user.id),
      API.getPendingTimesheetApprovalsCount(user.id),
      API.getUpcomingHolidays(5),
      API.getRecentAnnouncements(3),
      API.getWorkAnniversaries(),
      API.getBirthdayEmployees(),
    ])

    const firstName = Utils.escapeHtml((user.name || '').split(' ')[0])

    const html = `
      <section class="home-greeting">
        <div style="font-size:24px;font-weight:700;">${_greeting()}, ${firstName} 👋</div>
        <div style="font-size:13px;color:var(--text-muted);margin-top:4px;">${_formattedToday()}</div>
        <div style="font-size:13px;color:var(--text-muted);margin-top:2px;">${_motivationalLine()}</div>
      </section>

      ${_renderTimesheetNudge(todayEntries)}

      ${_renderPendingApprovals(pendingLeaveCount, pendingTsCount)}

      <div class="home-content-row">
        <div style="flex:1.4;min-width:0;">
          ${_renderWhoIsOut(whoIsOut, user.id)}
          ${_renderAnnouncements(announcements || [])}
        </div>
        <div style="flex:1;min-width:0;">
          ${_renderBirthdays(allEmployees || [])}
          ${_renderAnniversaries(workAnniversaries || [])}
          ${_renderHolidays(holidays || [])}
        </div>
      </div>
    `

    const el = document.getElementById('home-content')
    if (el) el.innerHTML = html
  }

  return { render, init }

})()
