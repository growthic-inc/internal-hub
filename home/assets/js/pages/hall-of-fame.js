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
      const note = (a.note || '').trim().replace(/^["“”']+|["“”']+$/g, '')
      const sub  = emp.designation || (emp.department ? Utils.getDeptLabel(emp.department) : '')
      return `
        <div class="champ-tile" title="${Utils.escapeHtml(emp.name || '')} — ${Utils.escapeHtml(b.league || '')}">
          <div class="champ-avatar-wrap">
            <div class="champ-avatar">${avatar}</div>
            <span class="champ-trophy">🏆</span>
          </div>
          <div class="champ-main">
            <div class="champ-name">${Utils.escapeHtml(emp.name || '')}</div>
            ${sub ? `<div class="champ-sub">${Utils.escapeHtml(sub)}</div>` : ''}
          </div>
          <span class="champ-side">
            <span class="champ-tag">${Utils.escapeHtml(b.league || '')}</span>
            <button type="button" class="champ-clap" aria-label="Clap for ${Utils.escapeHtml(emp.name || 'this champion')}" title="Clap">👏</button>
          </span>
          ${note ? `<div class="champ-note">“${Utils.escapeHtml(note)}”</div>` : ''}
        </div>`
    }).join('')}</div>`
  }

  /** Larger centred cards — the showcase for the latest quarter on the Hall of Fame page */
  function spotlightHtml(badges) {
    return `<div class="hof-spot-grid">${badges.map(b => {
      const a   = b.awards[0]
      const emp = a.employee || {}
      const avatar = emp.profile_image_url
        ? `<img src="${Utils.escapeHtml(emp.profile_image_url)}" alt="">`
        : Utils.escapeHtml(Utils.getInitials(emp.name || ''))
      const note = (a.note || '').trim().replace(/^["“”']+|["“”']+$/g, '')
      const sub  = emp.designation || (emp.department ? Utils.getDeptLabel(emp.department) : '')
      return `
        <div class="champ-spot">
          <span class="champ-tag">${Utils.escapeHtml(b.league || '')}</span>
          <div class="champ-avatar-wrap">
            <div class="champ-avatar">${avatar}</div>
            <span class="champ-trophy">🏆</span>
          </div>
          <div class="champ-spot-name">${Utils.escapeHtml(emp.name || '')}</div>
          ${sub ? `<div class="champ-spot-role">${Utils.escapeHtml(sub)}</div>` : ''}
          <div class="champ-spot-note">${note ? `“${Utils.escapeHtml(note)}”` : ''}</div>
          <button type="button" class="champ-clap" aria-label="Clap for ${Utils.escapeHtml(emp.name || 'this champion')}" title="Clap">👏</button>
        </div>`
    }).join('')}</div>`
  }

  /* ── Clap reaction: a full-screen celebration on the viewer's own screen,
     like a reaction in a meeting — confetti rains over the whole page and 👏
     float up from the bottom. Purely visual; nothing is sent anywhere. ──── */
  const CONFETTI = ['#0F4799', '#1a72c7', '#60a5fa', '#f5c542', '#ec4899', '#14b8a6', '#8b5cf6']
  let _live = 0
  const rnd = (a, b) => a + Math.random() * (b - a)

  function celebrate(btn) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (_live > 220) return                                   // keep rapid tapping smooth
    const vw = window.innerWidth, vh = window.innerHeight
    let layer = document.getElementById('champ-fx')
    if (!layer) {
      layer = document.createElement('div')
      layer.id = 'champ-fx'
      layer.setAttribute('aria-hidden', 'true')
      layer.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483000;overflow:hidden'
      document.body.appendChild(layer)
    }
    const spawn = (el, frames, opts) => {
      layer.appendChild(el); _live++
      const anim = el.animate(frames, { fill: 'forwards', ...opts })
      anim.onfinish = () => { el.remove(); _live-- }
    }

    // confetti raining across the whole screen
    for (let i = 0; i < 46; i++) {
      const p = document.createElement('span')
      const w = rnd(7, 12), h = Math.random() < 0.5 ? w : rnd(4, 6)
      const x = rnd(0, vw), sway = rnd(-70, 70), spin = rnd(-720, 720)
      p.style.cssText = `position:absolute;left:${x}px;top:0;width:${w}px;height:${h}px;` +
        `background:${CONFETTI[i % CONFETTI.length]};border-radius:${Math.random() < 0.3 ? '50%' : '2px'}`
      spawn(p, [
        { transform: `translate(0,-24px) rotate(0deg)`, opacity: 1 },
        { transform: `translate(${sway}px,${vh * 0.55}px) rotate(${spin * 0.6}deg)`, opacity: 1, offset: 0.65 },
        { transform: `translate(${sway * 1.4}px,${vh + 30}px) rotate(${spin}deg)`, opacity: 0.9 },
      ], { duration: rnd(2200, 3600), delay: rnd(0, 650), easing: 'cubic-bezier(.25,.5,.4,1)' })
    }

    // 👏 floating up from the bottom edge, spread across the width
    for (let i = 0; i < 8; i++) {
      const c = document.createElement('span')
      c.textContent = '👏'
      const x = rnd(vw * 0.06, vw * 0.94), size = rnd(28, 48)
      c.style.cssText = `position:absolute;left:${x}px;top:${vh}px;font-size:${size}px;line-height:1`
      const rise = rnd(vh * 0.35, vh * 0.8), sway = rnd(-60, 60)
      spawn(c, [
        { transform: 'translate(-50%,0) scale(.5)', opacity: 0 },
        { transform: `translate(calc(-50% + ${sway / 2}px),${-rise * 0.2}px) scale(1.1)`, opacity: 1, offset: 0.15 },
        { transform: `translate(calc(-50% + ${sway}px),${-rise}px) scale(1)`, opacity: 0 },
      ], { duration: rnd(1800, 2800), delay: i * 90 + rnd(0, 150), easing: 'ease-out' })
    }

    btn.animate([
      { transform: 'scale(1)' }, { transform: 'scale(1.35) rotate(-12deg)' }, { transform: 'scale(1)' },
    ], { duration: 280 })
  }

  // One listener covers every champion card, on Home and on Hall of Fame
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('click', e => {
      const btn = e.target && e.target.closest && e.target.closest('.champ-clap')
      if (btn) celebrate(btn)
    })
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
    const [latestKey, latestBadges] = groups[0]
    const older = groups.slice(1)
    const winners = groups.reduce((n, [, bs]) => n + bs.length, 0)

    root.innerHTML = `
      <div class="hof-hero">
        <div class="hof-hero-icon">🏆</div>
        <div>
          <h2>Our quarterly champions</h2>
          <p>Celebrating the people who raised the bar. Give them a clap.</p>
        </div>
        <div class="hof-hero-stat"><b>${winners}</b><span>champion${winners !== 1 ? 's' : ''} so far</span></div>
      </div>

      <div class="hof-section-title">Latest · ${Utils.escapeHtml(periodLabel(latestKey))}</div>
      ${spotlightHtml(latestBadges)}

      ${older.length ? `<div class="hof-section-title">Previous quarters</div>` + older.map(([key, badges]) => `
        <div class="section-card champ-quarter">
          <div class="section-card-header"><h3>🏆 ${Utils.escapeHtml(periodLabel(key))} Champions</h3></div>
          <div class="section-card-body">${tilesHtml(badges)}</div>
        </div>`).join('') : ''}`
  }

  return { render, init, tilesHtml, spotlightHtml, groupByPeriod, periodLabel }
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
