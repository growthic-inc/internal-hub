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
    return Utils.todayIST()
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
    today.setHours(0, 0, 0, 0)
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

  function _renderHero(user, todayEntries, whoIsOut, whoIsWfh, pendingLeaveCount, pendingTsCount) {
    const firstName   = Utils.escapeHtml((user.name || '').split(' ')[0])
    const totalHours  = (todayEntries || []).reduce((s, e) => s + Number(e.hours || 0), 0)
    const draftCount  = (todayEntries || []).filter(e => e.status === 'draft').length
    const outCount    = (whoIsOut || []).filter(r => r.employees && r.employees.id !== user.id).length
    const wfhCount    = (whoIsWfh || []).filter(r => r.employees && r.employees.id !== user.id).length
    const pendingTotal = (pendingLeaveCount || 0) + (pendingTsCount || 0)

    const hoursLabel = totalHours
      ? `⏱ ${totalHours.toFixed(1)}h logged${draftCount ? ` (${draftCount} draft)` : ''}`
      : `⏱ No hours logged yet`

    const absenceParts = [
      outCount > 0 ? `${outCount} out` : '',
      wfhCount > 0 ? `${wfhCount} WFH` : '',
    ].filter(Boolean)

    const stats = [
      { label: hoursLabel,                        href: '#timesheet'     },
      pendingTotal > 0 ? { label: `📋 ${pendingTotal} pending review`, href: '#leave-tracker' } : null,
      absenceParts.length ? { label: `👤 ${absenceParts.join(', ')} today`, href: '#leave-tracker' } : null,
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

  /* ── Section: Knowledge Labs entry point ──────────────────── */

  function _renderKnowledgeLabsCard(resources) {
    const list      = resources || []
    const deptCount = new Set(list.map(r => r.department_id)).size

    const statLine = list.length
      ? `${deptCount} department${deptCount !== 1 ? 's' : ''} · ${list.length} resource${list.length !== 1 ? 's' : ''} available to you`
      : `Your department's SOPs and templates will show up here`

    return `
      <div class="section-card home-fade-in" style="border-left:3px solid var(--primary);margin-top:12px;">
        <div class="section-card-body" style="display:flex;align-items:center;gap:14px;padding:14px 20px;">
          <div style="width:38px;height:38px;border-radius:50%;background:var(--primary-light);display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0;">🧪</div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:13px;">Knowledge Labs</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${Utils.escapeHtml(statLine)}</div>
          </div>
          <a href="/knowledgelabs/" class="btn btn--primary btn--sm">Open</a>
        </div>
      </div>`
  }

  /* ── Section: Pending Approvals ──────────────────────────── */

  function _renderPendingApprovals(leaveCount, tsCount) {
    const items = []
    if (leaveCount > 0) items.push({ label: `${leaveCount} leave/WFH request${leaveCount > 1 ? 's' : ''}`, hash: 'leave-tracker' })
    if (tsCount    > 0) items.push({ label: `${tsCount} timesheet entr${tsCount > 1 ? 'ies' : 'y'}`, hash: 'timesheet', deepTab: 'team' })
    if (!items.length) return ''

    const rows = items.map(item => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--warning-light);">
        <span style="font-size:13px;font-weight:500;">⏳ <strong>${item.label}</strong> awaiting your review</span>
        <a href="#${item.hash}" class="btn btn--primary btn--sm"${item.deepTab ? ` data-deep-tab="${item.deepTab}"` : ''}>Review</a>
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

  function _renderWhoIsOut(outRows, wfhRows, currentUserId) {
    const oooList = (outRows || [])
      .map(r => r.employees)
      .filter(emp => emp && emp.id !== currentUserId)

    const wfhList = (wfhRows || [])
      .map(r => r.employees)
      .filter(emp => emp && emp.id !== currentUserId)

    const totalCount = oooList.length + wfhList.length

    const chips = [
      ...oooList.map(emp => `
        <div class="home-person-chip" title="${Utils.escapeHtml(emp.name)} — Out today">
          ${_avatarHtml(emp)}
          <div style="min-width:0;">
            <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px;">${Utils.escapeHtml(emp.name)}</div>
            ${emp.designation ? `<div style="font-size:11px;color:var(--text-muted);">${Utils.escapeHtml(emp.designation)}</div>` : ''}
          </div>
          <span class="badge badge--warning" style="font-size:10px;margin-left:2px;">OOO</span>
        </div>`),
      ...wfhList.map(emp => `
        <div class="home-person-chip" title="${Utils.escapeHtml(emp.name)} — Working from home">
          ${_avatarHtml(emp)}
          <div style="min-width:0;">
            <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px;">${Utils.escapeHtml(emp.name)}</div>
            ${emp.designation ? `<div style="font-size:11px;color:var(--text-muted);">${Utils.escapeHtml(emp.designation)}</div>` : ''}
          </div>
          <span class="badge badge--primary" style="font-size:10px;margin-left:2px;">WFH</span>
        </div>`),
    ]

    const body = totalCount
      ? `<div class="home-chip-row">${chips.join('')}</div>`
      : `<p class="empty-state-text" style="margin:0;padding:4px 0;">👍 Everyone's in the office today.</p>`

    return `
      <div class="section-card home-hover-card" style="margin-bottom:14px;">
        <div class="section-card-header">
          <h3>Out & WFH Today</h3>
          ${totalCount ? `<span class="badge badge--muted">${totalCount}</span>` : ''}
        </div>
        <div class="section-card-body">${body}</div>
      </div>`
  }

  /* ── Section: Birthdays this week ────────────────────────── */

  /* ── Section: Upcoming Events (merged) ─────────────────────── */

  function _getUpcomingAnniversaries(employees, days = 30) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const results = []
    for (const emp of (employees || [])) {
      if (!emp.joining_date) continue
      const joined = new Date(emp.joining_date)
      // Skip employees in their first year (no "anniversary" yet)
      if (joined.getFullYear() >= today.getFullYear()) continue
      // Find anniversary date this year; if already past, use next year
      const anniv = new Date(today.getFullYear(), joined.getMonth(), joined.getDate())
      if (anniv < today) anniv.setFullYear(today.getFullYear() + 1)
      const daysUntil = Math.round((anniv - today) / 86400000)
      if (daysUntil <= days) {
        results.push({
          type:      'anniversary',
          label:     emp.name,
          subLabel:  emp.designation || '',
          date:      anniv,
          daysUntil,
          employee:  emp,
          years:     anniv.getFullYear() - joined.getFullYear(),
        })
      }
    }
    return results
  }

  function _renderUpcomingEvents(employees, eventsData) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const DAYS  = 30
    const all   = []

    // Birthdays in next 30 days
    _birthdaysInRange(employees, DAYS).forEach(emp => {
      const daysUntil = Math.round((emp.birthdayDate - today) / 86400000)
      all.push({ type: 'birthday', label: emp.name, subLabel: emp.designation || '', date: emp.birthdayDate, daysUntil, employee: emp })
    })

    // Work anniversaries in next 30 days
    _getUpcomingAnniversaries(employees, DAYS).forEach(e => all.push(e))

    // Upcoming holidays
    ;(eventsData.holidays || []).forEach(h => {
      const date      = new Date(h.date + 'T00:00:00')
      const daysUntil = Math.round((date - today) / 86400000)
      all.push({ type: 'holiday', label: h.name, date, daysUntil })
    })

    // Company events
    ;(eventsData.events || []).forEach(ev => {
      const date      = new Date(ev.start_date + 'T00:00:00')
      const daysUntil = Math.round((date - today) / 86400000)
      all.push({ type: 'event', label: ev.title, date, daysUntil })
    })

    // Sort chronologically; ties broken alphabetically
    all.sort((a, b) => a.daysUntil - b.daysUntil || a.label.localeCompare(b.label))

    const ICON = { birthday: '🎂', anniversary: '🎉', holiday: '🏖️', event: '📅' }

    const rows = all.length
      ? all.slice(0, 8).map((ev, i) => {
          const icon     = ICON[ev.type] || '📅'
          const dateText = ev.daysUntil === 0 ? 'Today!'
                         : ev.daysUntil === 1 ? 'Tomorrow'
                         : ev.date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
          const badgeCls = ev.daysUntil === 0 ? 'badge--danger'
                         : ev.daysUntil <= 3  ? 'badge--warning'
                         : 'badge--muted'
          const borderStyle = i === 0 ? ' style="border-top:none;"' : ''

          if (ev.employee) {
            const extra = ev.type === 'anniversary' ? ` · ${ev.years} yr${ev.years !== 1 ? 's' : ''}` : ''
            return `
              <div class="home-holiday-row"${borderStyle}>
                <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;overflow:hidden;">
                  ${_avatarHtml(ev.employee)}
                  <div style="min-width:0;">
                    <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${icon} ${Utils.escapeHtml(ev.label)}</div>
                    ${ev.subLabel ? `<div style="font-size:11px;color:var(--text-muted);">${Utils.escapeHtml(ev.subLabel)}${extra}</div>` : ''}
                  </div>
                </div>
                <span class="badge ${badgeCls}" style="margin-left:8px;flex-shrink:0;">${dateText}</span>
              </div>`
          }
          return `
            <div class="home-holiday-row"${borderStyle}>
              <div style="font-size:13px;font-weight:500;">${icon} ${Utils.escapeHtml(ev.label)}</div>
              <span class="badge ${badgeCls}" style="margin-left:8px;flex-shrink:0;white-space:nowrap;">${dateText}</span>
            </div>`
        }).join('')
      : `<p class="empty-state-text" style="margin:0;padding:16px 20px;">Nothing coming up in the next 30 days.</p>`

    return `
      <div class="section-card home-hover-card">
        <div class="section-card-header">
          <h3>Upcoming Events</h3>
          <a href="#leave-tracker" style="font-size:12px;color:var(--primary);font-weight:500;">Manage →</a>
        </div>
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

    // Deep-link: when a Review button targets a specific module tab, store
    // the desired tab in sessionStorage so the module opens on it.
    document.querySelectorAll('a[data-deep-tab]').forEach(a => {
      a.addEventListener('click', () => {
        const module = a.getAttribute('href').slice(1)   // e.g. "timesheet"
        sessionStorage.setItem(`${module}:tab`, a.dataset.deepTab)
      })
    })
  }

  /* ── render ──────────────────────────────────────────────── */

  function render(user) {
    return `
      <div class="page-inner">
        <div id="home-content"><div class="page-loading">Loading…</div></div>
      </div>`
  }

  /* ── Section: Your Badges (right column mini-cards) ──────── */

  /** On the home page show only the highest tenure badge + all other categories */
  function _filterHomeBadges(earnedBadges) {
    const all     = earnedBadges || []
    const tenure  = all
      .filter(eb => eb.badge?.category === 'tenure')
      .sort((a, b) => (b.badge?.criteria_months || 0) - (a.badge?.criteria_months || 0))
    const others  = all.filter(eb => eb.badge?.category !== 'tenure')
    return [...(tenure.length ? [tenure[0]] : []), ...others]
  }

  function _renderMyBadges(earnedBadges) {
    const badges = _filterHomeBadges(earnedBadges)
    const now    = Date.now()

    const body = badges.length
      ? `<div class="my-badges-grid">
          ${badges.map(eb => {
            const b      = eb.badge || {}
            const colour = b.colour || '#0F4799'
            const isNew  = eb.awarded_at && (now - new Date(eb.awarded_at)) < 86400000 * 3
            return `
              <div class="my-badge-card" style="--bc:${colour};"
                   title="${Utils.escapeHtml(b.description || '')}">
                ${isNew ? `<span class="my-badge-new">NEW</span>` : ''}
                <div class="my-badge-icon">${b.icon || '🏅'}</div>
                <div class="my-badge-name">${Utils.escapeHtml(b.name || '')}</div>
                <div class="my-badge-desc">${Utils.escapeHtml(b.description || '')}</div>
              </div>`
          }).join('')}
        </div>`
      : `<div style="text-align:center;padding:12px 0 4px;">
           <div style="font-size:28px;margin-bottom:8px;">🏅</div>
           <div style="font-size:13px;font-weight:600;color:var(--text-secondary);margin-bottom:4px;">No badges yet</div>
           <div style="font-size:12px;color:var(--text-muted);">Keep showing up — they're coming.</div>
         </div>`

    return `
      <div class="section-card home-badges-card">
        <div class="section-card-header">
          <h3>Your Badges</h3>
          ${badges.length ? `<span class="badge" style="background:var(--primary);color:#fff;">${badges.length}</span>` : ''}
        </div>
        <div class="section-card-body" id="home-badges-inner">${body}</div>
      </div>`
  }

  /* ── Auto-badge check (runs fire-and-forget on login) ────── */

  async function _checkAndAwardAutoBadges(user) {
    try {
      const [{ data: allBadges }, { data: existingBadges }] = await Promise.all([
        API.getBadges(),
        API.getEmployeeBadges(user.id),
      ])
      if (!allBadges) return

      const today         = new Date()
      const existingMap   = {}    // badge_id → employee_badge row
      ;(existingBadges || []).forEach(eb => { existingMap[eb.badge_id] = eb })

      const toAward = []

      // ── Tenure badges ──────────────────────────────────────
      // Rule: award ALL missed milestones to the profile (so it looks complete),
      // but only announce + notify the HIGHEST one to avoid feed spam on rollout.
      if (user.joining_date) {
        const joined = new Date(user.joining_date)
        const months = (today.getFullYear() - joined.getFullYear()) * 12
          + (today.getMonth() - joined.getMonth())
          + (today.getDate() >= joined.getDate() ? 0 : -1)

        const tenureBadges = allBadges
          .filter(b => b.category === 'tenure' && b.criteria_months != null)
          .sort((a, b) => a.criteria_months - b.criteria_months)

        // Split into: badges to insert silently vs. the one to announce
        // Only ever award the single highest milestone not yet earned.
        // Lower milestones are skipped entirely — profile shows only current level.
        const unearned = tenureBadges.filter(b => months >= b.criteria_months && !existingMap[b.id])
        if (unearned.length > 0) {
          toAward.push({ badge: unearned[unearned.length - 1], note: null })
        }
      }

      // ── Birthday badge ─────────────────────────────────────
      if (user.date_of_birth) {
        const birthdayBadge = allBadges.find(b => b.category === 'special' && b.name === 'Birthday Star')
        if (birthdayBadge) {
          const dob     = new Date(user.date_of_birth)
          // Birthday this calendar year
          const bday    = new Date(today.getFullYear(), dob.getMonth(), dob.getDate())
          const daysUntil = Math.round((bday - today) / 86400000)

          if (daysUntil >= 0 && daysUntil < 7) {
            const existing = existingMap[birthdayBadge.id]
            if (!existing) {
              toAward.push({ badge: birthdayBadge, note: null, isAuto: true })
            } else {
              // Re-award each year: if last awarded in a prior year, revoke + re-award
              const awardYear = new Date(existing.awarded_at).getFullYear()
              if (awardYear < today.getFullYear()) {
                await API.revokeEmployeeBadge(existing.id)
                toAward.push({ badge: birthdayBadge, note: null, isAuto: true })
              }
            }
          }
        }
      }

      // ── Award each new badge ───────────────────────────────
      for (const { badge, note } of toAward) {
        const { data: awarded, error } = await API.awardBadge({
          employee_id: user.id,
          badge_id:    badge.id,
          awarded_by:  null,
          note,
        })
        if (error || !awarded) continue

        // In-app notification to self
        API.createNotification({
          recipient_employee_id: user.id,
          type:      'success',
          message:   `🎉 You earned the "${badge.name}" badge!`,
          module:    'badges',
          record_id: awarded.id,
        }).catch(() => {})

        // Post to announcements feed (published, attributed to system)
        const annTitle   = `${badge.icon} ${user.name} earned the "${badge.name}" badge!`
        const annContent = badge.category === 'tenure'
          ? `Congratulations to ${user.name} on reaching the ${badge.name} milestone at Growthic! 🎉`
          : badge.category === 'special'
          ? `It's ${user.name}'s birthday week! Wishing you an amazing celebration 🎂🎉`
          : `Congratulations to ${user.name} — just earned the "${badge.name}" badge!`

        API.createAnnouncement({
          title:      annTitle,
          content:    annContent,
          published:  true,
          created_by: user.id,
        }).catch(() => {})
      }

      // Refresh "Your Badges" widget if new badges were awarded
      if (toAward.length > 0) {
        const { data: refreshed } = await API.getEmployeeBadges(user.id)
        const inner = document.getElementById('home-badges-inner')
        if (inner) {
          const tmpDiv = document.createElement('div')
          tmpDiv.innerHTML = _renderMyBadges(refreshed)
          const newInner = tmpDiv.querySelector('#home-badges-inner')
          if (newInner) inner.innerHTML = newInner.innerHTML
        }
      }
    } catch (_) { /* silent — badge check never crashes the home page */ }
  }

  /* ── init ────────────────────────────────────────────────── */

  async function init(user) {
    _user = user
    const todayISO = _todayISO()

    const [
      { data: todayEntries },
      { data: whoIsOut },
      { data: whoIsWfh },
      pendingLeaveCount,
      pendingTsCount,
      { data: upcomingEventsData },
      { data: announcements },
      { data: allEmployees },
      { data: myBadges },
      { data: knowledgeResources },
    ] = await Promise.all([
      API.getTimesheetEntries(user.id, todayISO, todayISO),
      API.getWhoIsOutToday(),
      API.getWhoIsWfhToday(),
      API.getPendingApprovalsCount(user.id),
      API.getPendingTimesheetApprovalsCount(user.id, user.role),
      API.getUpcomingEventsData(30),
      API.getRecentAnnouncements(3),
      API.getBirthdayEmployees(),
      API.getEmployeeBadges(user.id),
      API.getKnowledgeResources(),
    ])

    const html = `
      ${_renderHero(user, todayEntries, whoIsOut, whoIsWfh, pendingLeaveCount, pendingTsCount)}
      ${_renderTimesheetNudge(todayEntries)}
      ${_renderKnowledgeLabsCard(knowledgeResources)}
      ${_renderPendingApprovals(pendingLeaveCount, pendingTsCount)}

      <div class="home-content-row" style="margin-top:14px;">
        <div style="flex:1.5;min-width:0;display:flex;flex-direction:column;gap:14px;">
          ${_renderWhoIsOut(whoIsOut, whoIsWfh, user.id)}
          ${_renderAnnouncements(announcements || [])}
        </div>
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:14px;">
          ${_renderMyBadges(myBadges)}
          ${_renderUpcomingEvents(allEmployees || [], upcomingEventsData || { holidays: [], events: [] })}
        </div>
      </div>
    `

    const el = document.getElementById('home-content')
    if (el) {
      el.innerHTML = html
      _bindInteractions()
    }

    // Fire-and-forget: check + award tenure / birthday badges without blocking render
    _checkAndAwardAutoBadges(user)
  }

  return { render, init }

})()
