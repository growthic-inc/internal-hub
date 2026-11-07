/* ============================================================
   HALL OF FAME — Growthic One
   Every quarter's champions, newest first. Read-only: HR publishes
   them from /hrms → Quarterly Champions. Champions are badges with a
   `period` ('2026-Q4') and a `league`, so this page just groups the
   badge awards by period.

   Also exposes tilesHtml() / periodLabel() so the home-page card
   draws champions exactly the same way.
   ============================================================ */

const HallOfFameModule = (() => {


  /** '2026-Q4' → 'Q4 2026' */
  function periodLabel(key) {
    const [y, q] = String(key || '').split('-')
    return q ? `${q} ${y}` : String(key || '')
  }

  /** Group champion badges (with .awards) by period, newest first. Skips unawarded badges. */
  function groupByPeriod(badges) {
    const map = new Map()
    ;(badges || []).forEach(b => {
      if (!b.period || !(b.awards && b.awards.length)) return
      if (!map.has(b.period)) map.set(b.period, [])
      map.get(b.period).push(b)
    })
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }

  /** The tiles for one quarter's badges */
  function tilesHtml(badges) {
    return `<div class="champ-tiles">${badges.map(b => {
      const a   = b.awards[0]
      const emp = a.employee || {}
      const avatar = emp.profile_image_url
        ? `<img src="${Utils.escapeHtml(emp.profile_image_url)}" alt="">`
        : Utils.escapeHtml(Utils.getInitials(emp.name || ''))
      return `
        <div class="champ-tile">
          <span class="champ-tile-crown">🏆</span>
          <div class="champ-avatar">${avatar}</div>
          <div class="champ-name">${Utils.escapeHtml(emp.name || '')}</div>
          <span class="champ-league">${Utils.escapeHtml(b.league || '')}</span>
          ${a.note ? `<div class="champ-note">${Utils.escapeHtml(a.note)}</div>` : ''}
        </div>`
    }).join('')}</div>`
  }

  function render() {
    return `
      <div class="page-inner">
        <div id="hof-root"><div class="page-loading">Loading…</div></div>
      </div>`
  }

  async function init() {
    const root = document.getElementById('hof-root')
    if (!root) return
    const { data, error } = await API.getChampionBadges()
    if (error) {
      root.innerHTML = `<div class="section-card"><div class="section-card-body" style="color:var(--text-muted);">
        Could not load the Hall of Fame right now.</div></div>`
      return
    }
    const groups = groupByPeriod(data)
    if (!groups.length) {
      root.innerHTML = `
        <div class="section-card"><div class="section-card-body" style="text-align:center;padding:36px 20px;">
          <div style="font-size:34px;margin-bottom:8px;">🏆</div>
          <div style="font-weight:600;color:var(--text-secondary);margin-bottom:4px;">No champions yet</div>
          <div style="font-size:13px;color:var(--text-muted);">Quarterly champions will appear here once they're announced.</div>
        </div></div>`
      return
    }
    root.innerHTML = groups.map(([key, badges]) => `
      <section class="champ-quarter">
        <h3 class="champ-quarter-title">🏆 ${Utils.escapeHtml(periodLabel(key))} Champions</h3>
        ${tilesHtml(badges)}
      </section>`).join('')
  }

  return { render, init, tilesHtml, groupByPeriod, periodLabel }
})()

ModuleRegistry.register({
  key:       'hall-of-fame',
  routeId:   'hall-of-fame',
  label:     'Hall of Fame',
  order:     12,
  universal: true,
  icon:      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8"></path><path d="M12 17v4"></path><path d="M7 4h10v5a5 5 0 0 1-10 0z"></path><path d="M17 5h3v2a3 3 0 0 1-3 3"></path><path d="M7 5H4v2a3 3 0 0 0 3 3"></path></svg>`,
  getModule: () => HallOfFameModule,
  features:  {
    view_hall_of_fame: 'View Hall of Fame',
  },
})
