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

  /* ── Section: Hero ───────────────────────────────────────── */

  function _renderHero(user, todayEntries, whoIsOut, pendingLeaveCount, pendingTsCount) {
    const firstName   = Utils.escapeHtml((user.name || '').split(' ')[0])
    const totalHours  = (todayEntries || []).reduce((s, e) => s + Number(e.hours || 0), 0)
    const draftCount  = (todayEntries || []).filter(e => e.status === 'draft').length
    const outCount    = (whoIsOut || []).filter(r => r.employees && r.employees.id !== user.id).length
    const pendingTotal = (pendingLeaveCount || 0) + (pendingTsCount || 0)

    const hoursLabel = totalHours
      ? `⏱ ${totalHours.toFixed(1)}h logged${draftCount ? ` (${draftCount} draft)` : ''}`
      : `⏱ No hours logged yet`

    const stats = [
      { label: hoursLabel,                        href: '#timesheet'     },
      pendingTotal > 0 ? { label: `📋 ${pendingTotal} pending review`, href: '#leave-tracker' } : null,
      outCount > 0    ? { label: `👤 ${outCount} out today`,           href: '#leave-tracker' } : null,
    ].filter(Boolean)

    return `
      <div class="home-hero home-fade-in">
        <div style="position:absolute;right:-24px;top:-24px;width:220px;height:220px;border-radius:50%;background:rgba(255,255,255,0.05);pointer-events:none;"></div>
        <div style="position:absolute;right:80px;bottom:-50px;width:160px;height:160px;border-radius:50%;background:rgba(255,255,255,0.04);pointer-events:none;"></div>
        <div style="position:relative;z-index:1;">
          <div style="font-size:11px;font-weight:600;letter-spacing:0.07em;text-transform:uppercase;color:rgba(255,255,255,0.5);margin-bottom:10px;">${_formattedToday()}</div>
          <div style="font-size:28px;font-weight:700;color:#fff;line-height:1.2;margin-bottom:6px;">${_greeting()}, ${firstName} 👋</div>
          <div style="font-size:13px;color:rgba(255,255,255,0.6);font-style:italic;">${_motivationalLine()}</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:18px;">
            ${stats.map(s => `
              <a href="${s.href}" class="home-stat-pill">${s.label}</a>
            `).join('')}
          </div>
        </div>
      </div>`
  }

  /* ── Section: Timesheet nudge ─────────────────────────────── */

  function _renderTimesheetNudge(entries) {
    const all        = entries || []
    const totalHours = all.reduce((s, e) => s + Number(e.hours || 0), 0)
    const draftCount = all.filter(e => e.status === 'draft').length

    let icon, message, sub, actionHtml, color, colorLight

    if (!totalHours) {
      icon       = '🕐'
      color      = 'var(--warning)'
      colorLight = 'var(--warning-light)'
      message    = "You haven't logged any hours today."
      sub        = 'Add your first entry to get started.'
      actionHtml = `<a href="#timesheet" class="btn btn--primary btn--sm">Log Time</a>`
    } else if (draftCount > 0) {
      icon       = '📋'
      color      = 'var(--primary)'
      colorLight = 'var(--primary-light)'
      message    = `${totalHours.toFixed(1)}h logged — ${draftCount} draft${draftCount > 1 ? 's' : ''} pending submission.`
      sub        = 'Submit your drafts for manager review.'
      actionHtml = `<a href="#timesheet" class="btn btn--primary btn--sm">Submit Drafts</a>`
    } else {
      icon       = '✅'
      color      = 'var(--success)'
      colorLight = 'var(--success-light)'
      message    = `${totalHours.toFixed(1)}h logged and submitted today.`
      sub        = "You're all set for today!"
      actionHtml = `<a href="#timesheet" class="btn btn--ghost btn--sm">View</a>`
    }

    return `
      <div class="section-card home-ts-nudge home-fade-in" style="border-left:3px solid ${color};">
        <div class="section-card-body" style="display:flex;align-items:center;gap:14px;padding:14px 20px;">
          <div style="width:38px;height:38px;border-radius:50%;background:${colorLight};display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0;">${icon}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:13px;color:${color};">${message}</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${sub}</div>
          </div>
          ${actionHtml}
        </div>
      </div>`
  }

  /* ── Section: Pending Approvals ──────────────────────────── */

  function _renderPendingApprovals(leaveCount, tsCount) {
    const items = []
    if (leaveCount > 0) items.push({ label: `${leaveCount} leave/WFH request${leaveCount > 1 ? 's' : ''}`, hash: 'leave-tracker' })
    if (tsCount    > 0) items.push({ label: `${tsCount} timesheet entr${tsCount > 1 ? 'ies' : 'y'}`, hash: 'timesheet' })
    if (!items.length) return ''

    const rows = items.map(item => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--warning-light);">
        <span style="font-size:13px;font-weight:500;">⏳ <strong>${item.label}</strong> awaiting your review</span>
        <a href="#${item.hash}" class="btn btn--primary btn--sm">Review</a>
      </div>`).join('')

    return `
      <div class="section-card home-fade-in" style="border-left:3px solid var(--warning);margin-top:12px;">
        <div class="section-card-header" style="background:var(--warning-light);">
          <h3 style="color:#92400E;">Action Required</h3>
          <span class="badge" style="background:var(--warning);color:#fff;">${items.length}</span>
        </div>
        <div class="section-card-body">${rows}</div>
      </div>`
  }

  /* ── Section: Who's out today ─────────────────────────────── */

  function _renderWhoIsOut(rows, currentUserId) {
    const people = (rows || [])
      .map(r => r.employees)
      .filter(emp => emp && emp.id !== currentUserId)

    const body = people.length
      ? `<div class="home-chip-row">
          ${people.map(emp => `
            <div class="home-person-chip" title="${Utils.escapeHtml(emp.name)} — Out today">
              ${_avatarHtml(emp)}
              <div style="min-width:0;">
                <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px;">${Utils.escapeHtml(emp.name)}</div>
                ${emp.designation ? `<div style="font-size:11px;color:var(--text-muted);">${Utils.escapeHtml(emp.designation)}</div>` : ''}
              </div>
              <span class="badge badge--warning" style="font-size:10px;margin-left:2px;">OOO</span>
            </div>`).join('')}
        </div>`
      : `<p class="empty-state-text" style="margin:0;padding:4px 0;">👍 Everyone's in today.</p>`

    return `
      <div class="section-card home-hover-card" style="margin-bottom:14px;">
        <div class="section-card-header">
          <h3>Who's Out Today</h3>
          ${people.length ? `<span class="badge badge--muted">${people.length}</span>` : ''}
        </div>
        <div class="section-card-body">${body}</div>
      </div>`
  }

  /* ── Section: Birthdays this week ────────────────────────── */

  function _renderBirthdays(employees) {
    const celebrants = _birthdaysInRange(employees, 7)
    if (!celebrants.length) return ''

    const rows = celebrants.map(emp => {
      const label    = emp.isToday ? '🎂 Today!' : emp.birthdayDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
      const badgeCls = emp.isToday ? 'badge--danger' : 'badge--muted'
      return `
        <div class="home-person-row">
          ${_avatarHtml(emp)}
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:13px;">${Utils.escapeHtml(emp.name)}</div>
            ${emp.designation ? `<div style="font-size:11px;color:var(--text-muted);">${Utils.escapeHtml(emp.designation)}</div>` : ''}
          </div>
          <span class="badge ${badgeCls}">${label}</span>
        </div>`
    }).join('')

    return `
      <div class="section-card home-hover-card" style="margin-bottom:14px;">
        <div class="section-card-header"><h3>🎂 Birthdays This Week</h3></div>
        <div class="section-card-body">${rows}</div>
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

    const rows = celebrants.map(emp => {
      const years = currentYear - new Date(emp.joining_date).getFullYear()
      return `
        <div class="home-person-row">
          ${_avatarHtml(emp)}
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:13px;">${Utils.escapeHtml(emp.name)}</div>
            ${emp.designation ? `<div style="font-size:11px;color:var(--text-muted);">${Utils.escapeHtml(emp.designation)}</div>` : ''}
          </div>
          <span class="badge badge--primary">${years} yr${years !== 1 ? 's' : ''} 🎉</span>
        </div>`
    }).join('')

    return `
      <div class="section-card home-hover-card" style="margin-bottom:14px;">
        <div class="section-card-header"><h3>🎉 Work Anniversaries</h3></div>
        <div class="section-card-body">${rows}</div>
      </div>`
  }

  /* ── Section: Upcoming Holidays ──────────────────────────── */

  function _renderHolidays(holidays) {
    const rows = (holidays || []).length
      ? holidays.slice(0, 5).map((h, i) => `
          <div class="home-holiday-row" ${i === 0 ? 'style="border-top:none;"' : ''}>
            <div>
              <div style="font-size:13px;font-weight:500;">${Utils.escapeHtml(h.name)}</div>
            </div>
            <span style="font-size:12px;color:var(--text-muted);white-space:nowrap;">${Utils.formatDate(h.date)}</span>
          </div>`).join('')
      : `<p class="empty-state-text" style="margin:0;">No upcoming holidays.</p>`

    return `
      <div class="section-card home-hover-card" style="margin-bottom:14px;">
        <div class="section-card-header"><h3>Upcoming Holidays</h3></div>
        <div class="section-card-body" style="padding:0;">${rows}</div>
      </div>`
  }

  /* ── Section: Recent Announcements ──────────────────────── */

  function _renderAnnouncements(announcements) {
    if (!(announcements || []).length) {
      return `
        <div class="section-card home-hover-card">
          <div class="section-card-header">
            <h3>Recent Announcements</h3>
            <a href="#announcements" style="font-size:12px;color:var(--primary);font-weight:500;">View all →</a>
          </div>
          <div class="section-card-body"><p class="empty-state-text" style="margin:0;">No announcements yet.</p></div>
        </div>`
    }

    const items = announcements.slice(0, 4).map(a => {
      const author    = a.employees?.name ? Utils.escapeHtml(a.employees.name) : ''
      const body      = Utils.escapeHtml(a.content || '')
      const thumbUrl  = a.image_urls?.[0] ? Utils.escapeHtml(a.image_urls[0]) : null
      return `
        <div class="home-ann-item" role="button" tabindex="0" aria-expanded="false">
          <div class="home-ann-header">
            ${thumbUrl ? `<img src="${thumbUrl}" alt="" class="home-ann-thumb">` : ''}
            <div style="font-weight:600;font-size:13px;flex:1;min-width:0;padding-right:12px;">${Utils.escapeHtml(a.title)}</div>
            <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
              <span style="font-size:11px;color:var(--text-muted);">${_relativeTime(a.created_at)}</span>
              <span class="home-ann-chevron">›</span>
            </div>
          </div>
          <div class="home-ann-body">
            ${thumbUrl ? `<img src="${thumbUrl}" alt="" class="home-ann-body-img">` : ''}
            <div style="font-size:13px;color:var(--text-secondary);line-height:1.6;">${body}</div>
            ${author ? `<div style="font-size:11px;color:var(--text-muted);margin-top:8px;font-weight:500;">— ${author}</div>` : ''}
            <a href="#announcements" style="display:inline-block;font-size:12px;color:var(--primary);margin-top:10px;font-weight:500;">View in Announcements →</a>
          </div>
        </div>`
    }).join('')

    return `
      <div class="section-card home-hover-card">
        <div class="section-card-header">
          <h3>Recent Announcements</h3>
          <a href="#announcements" style="font-size:12px;color:var(--primary);font-weight:500;">View all →</a>
        </div>
        <div class="section-card-body" style="padding:0;">
          ${items}
        </div>
      </div>`
  }

  /* ── Bind interactions ───────────────────────────────────── */

  function _bindInteractions() {
    document.querySelectorAll('.home-ann-item').forEach(item => {
      const toggle = (e) => {
        // Don't expand if clicking the "View all →" link
        if (e.target.tagName === 'A') return
        const body    = item.querySelector('.home-ann-body')
        const chevron = item.querySelector('.home-ann-chevron')
        const isOpen  = item.classList.contains('open')
        item.classList.toggle('open', !isOpen)
        item.setAttribute('aria-expanded', String(!isOpen))
        body.style.display    = isOpen ? 'none' : 'block'
        chevron.style.transform = isOpen ? '' : 'rotate(90deg)'
      }
      item.addEventListener('click', toggle)
      item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e) } })
    })
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

    const html = `
      ${_renderHero(user, todayEntries, whoIsOut, pendingLeaveCount, pendingTsCount)}
      ${_renderTimesheetNudge(todayEntries)}
      ${_renderPendingApprovals(pendingLeaveCount, pendingTsCount)}

      <div class="home-content-row" style="margin-top:14px;">
        <div style="flex:1.5;min-width:0;display:flex;flex-direction:column;gap:14px;">
          ${_renderWhoIsOut(whoIsOut, user.id)}
          ${_renderAnnouncements(announcements || [])}
        </div>
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:14px;">
          ${_renderBirthdays(allEmployees || [])}
          ${_renderAnniversaries(workAnniversaries || [])}
          ${_renderHolidays(holidays || [])}
        </div>
      </div>
    `

    const el = document.getElementById('home-content')
    if (el) {
      el.innerHTML = html
      _bindInteractions()
    }
  }

  return { render, init }

})()
