/* ============================================================
   QUARTERLY CHAMPIONS — HRMS
   HR publishes the winners of a quarterly review in one go.
   Each winner is an ordinary badge award (badges + employee_badges)
   whose badge carries a `period` ('2026-Q4') and a `league`, so
   there are no extra tables. Growthic One reads the same rows for
   the home-page card and the Hall of Fame.

   Publishing is idempotent: it matches existing badges by period +
   league and skips awards that already exist, so clicking Publish
   again after a partial failure simply completes the job.
   ============================================================ */

const ChampionsModule = (() => {

  /* ── State ─────────────────────────────────────────────────── */
  let _user       = null
  let _employees  = []
  let _champions  = []          // champion badges (each with .awards[])
  let _quarter    = 1
  let _year       = new Date().getFullYear()
  let _rows       = []          // [{ badgeId, league, employeeId, note }]
  let _prefilled  = false       // rows currently mirror a published quarter
  let _busy       = false
  const _pendingAnnounce = new Set()   // quarters whose first publish hit errors: announce when a retry succeeds

  const BADGE_ICON   = '🏆'
  const BADGE_COLOUR = '#d97706'

  /* ── Period helpers ────────────────────────────────────────── */
  const _key   = (y, q) => `${y}-Q${q}`
  const _label = (key)  => { const [y, q] = key.split('-'); return `${q} ${y}` }
  const _norm  = (s)    => (s || '').trim().replace(/\s+/g, ' ').toLowerCase()
  const _blankRow = ()  => ({ badgeId: null, league: '', employeeId: '', note: '' })

  function _currentQuarter() { return Math.floor(new Date().getMonth() / 3) + 1 }

  function _existingFor(key) { return _champions.filter(b => b.period === key) }

  /** Group champion badges by period, newest first */
  function _byPeriod() {
    const map = new Map()
    _champions.forEach(b => {
      if (!map.has(b.period)) map.set(b.period, [])
      map.get(b.period).push(b)
    })
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }

  /* ── render ────────────────────────────────────────────────── */
  function render(user) {
    _user = user
    return `
      <div class="page-inner">
        <div id="champ-root"><div class="page-loading">Loading…</div></div>
      </div>`
  }

  async function init(user) {
    _user    = user
    _quarter = _currentQuarter()
    _year    = new Date().getFullYear()
    _rows    = [_blankRow(), _blankRow(), _blankRow()]
    _prefilled = false
    _busy    = false

    const [{ data: emps }, { data: champs }] = await Promise.all([
      API.getEmployees(),
      API.getChampionBadges(),
    ])
    _employees = emps || []
    _champions = champs || []

    _syncRowsToPeriod()
    _paint()
  }

  /* ── Prefill the form when the chosen quarter already exists ── */
  function _syncRowsToPeriod() {
    const existing = _existingFor(_key(_year, _quarter))
    if (existing.length) {
      _rows = existing.map(b => ({
        badgeId:    b.id,
        league:     b.league || '',
        employeeId: b.awards?.[0]?.employee?.id || '',
        note:       b.awards?.[0]?.note || '',
      }))
      _prefilled = true
    } else if (_prefilled) {
      _rows = [_blankRow(), _blankRow(), _blankRow()]
      _prefilled = false
    }
  }

  /* ── Paint ─────────────────────────────────────────────────── */
  function _paint() {
    const root = document.getElementById('champ-root')
    if (!root) return
    const key      = _key(_year, _quarter)
    const existing = _existingFor(key)
    const thisYear = new Date().getFullYear()
    const yearOpts = [...new Set([thisYear - 1, thisYear, thisYear + 1, _year])].sort()

    root.innerHTML = `
      <div class="section-card" style="margin-bottom:16px;">
        <div class="section-card-header">
          <h3>🏆 Publish quarterly champions</h3>
        </div>
        <div class="section-card-body">
          <div class="champ-period-row">
            <div>
              <label class="form-label" for="champ-quarter">Quarter</label>
              <select class="form-select" id="champ-quarter">
                ${[1, 2, 3, 4].map(q => `<option value="${q}"${q === _quarter ? ' selected' : ''}>Q${q}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="form-label" for="champ-year">Year</label>
              <select class="form-select" id="champ-year">
                ${yearOpts.map(y => `<option value="${y}"${y === _year ? ' selected' : ''}>${y}</option>`).join('')}
              </select>
            </div>
          </div>

          ${existing.length ? `
            <div class="champ-hint champ-hint--info">
              ${_label(key)} is already published. Changes you make here update it —
              swapping a winner replaces their badge.
            </div>` : `
            <div class="champ-hint">
              Nothing is saved or announced until you click <b>Publish</b>.
            </div>`}

          <div class="champ-rows" id="champ-rows">
            <div class="champ-row champ-row--head">
              <span>League</span><span>Champion</span><span>Reason / reward</span><span></span>
            </div>
            ${_rows.map((r, i) => _rowHtml(r, i)).join('')}
          </div>

          <div class="champ-actions">
            <button class="btn btn--ghost" id="champ-add-row" type="button">+ Add another league</button>
            <button class="btn btn--primary" id="champ-publish" type="button">
              ${existing.length ? 'Update champions' : 'Publish champions'}
            </button>
          </div>
          <div id="champ-error" class="alert alert-danger" style="display:none;margin-top:12px;"></div>
        </div>
      </div>

      <div class="section-card">
        <div class="section-card-header"><h3>Published quarters</h3></div>
        <div class="section-card-body" id="champ-history">${_historyHtml()}</div>
      </div>`

    _bind()
  }

  function _rowHtml(r, i) {
    const opts = _employees.map(e =>
      `<option value="${e.id}"${e.id === r.employeeId ? ' selected' : ''}>${Utils.escapeHtml(e.name)}</option>`
    ).join('')
    return `
      <div class="champ-row" data-i="${i}">
        <input class="form-input" data-f="league" placeholder="e.g. Sales League"
               value="${Utils.escapeHtml(r.league)}" maxlength="60">
        <select class="form-select" data-f="employeeId">
          <option value="">Select employee…</option>${opts}
        </select>
        <input class="form-input" data-f="note" placeholder="e.g. Closed 12 deals — voucher ₹5,000"
               value="${Utils.escapeHtml(r.note)}" maxlength="200">
        <button class="champ-row-remove" data-remove="${i}" type="button" title="Remove" aria-label="Remove row">✕</button>
      </div>`
  }

  function _historyHtml() {
    const groups = _byPeriod()
    if (!groups.length) {
      return `<p style="margin:0;font-size:13px;color:var(--text-muted);">No quarters published yet.</p>`
    }
    return groups.map(([key, badges]) => `
      <div class="champ-hist">
        <div class="champ-hist-head">
          <b>${Utils.escapeHtml(_label(key))}</b>
          <span class="champ-hist-actions">
            <button class="btn btn--ghost btn--sm" data-edit="${key}" type="button">Edit</button>
            <button class="btn btn--ghost btn--sm" data-del="${key}" type="button" style="color:var(--danger);">Delete</button>
          </span>
        </div>
        <ul class="champ-hist-list">
          ${badges.map(b => {
            const a = b.awards?.[0]
            return `<li><span class="champ-hist-league">${Utils.escapeHtml(b.league || '')}</span>
              <span>${a?.employee ? Utils.escapeHtml(a.employee.name) : '<i>unassigned</i>'}</span>
              ${a?.note ? `<span class="champ-hist-note">${Utils.escapeHtml(a.note)}</span>` : ''}</li>`
          }).join('')}
        </ul>
      </div>`).join('')
  }

  /* ── Events ────────────────────────────────────────────────── */
  function _bind() {
    document.getElementById('champ-quarter')?.addEventListener('change', (e) => {
      _quarter = Number(e.target.value); _syncRowsToPeriod(); _paint()
    })
    document.getElementById('champ-year')?.addEventListener('change', (e) => {
      _year = Number(e.target.value); _syncRowsToPeriod(); _paint()
    })

    // Keep typed values in state so re-rendering never loses them
    document.getElementById('champ-rows')?.addEventListener('input', _onField)
    document.getElementById('champ-rows')?.addEventListener('change', _onField)
    document.getElementById('champ-rows')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove]')
      if (!btn) return
      _rows.splice(Number(btn.dataset.remove), 1)
      if (!_rows.length) _rows.push(_blankRow())
      _paint()
    })

    document.getElementById('champ-add-row')?.addEventListener('click', () => {
      _rows.push(_blankRow()); _paint()
    })
    document.getElementById('champ-publish')?.addEventListener('click', _publish)

    document.getElementById('champ-history')?.addEventListener('click', (e) => {
      const edit = e.target.closest('[data-edit]')
      const del  = e.target.closest('[data-del]')
      if (edit) {
        const [y, q] = edit.dataset.edit.split('-Q')
        _year = Number(y); _quarter = Number(q)
        _prefilled = false; _syncRowsToPeriod(); _paint()
        document.getElementById('champ-root')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } else if (del) {
        _deleteQuarter(del.dataset.del)
      }
    })
  }

  function _onField(e) {
    const rowEl = e.target.closest('.champ-row[data-i]')
    const f     = e.target.dataset.f
    if (!rowEl || !f) return
    _rows[Number(rowEl.dataset.i)][f] = e.target.value
  }

  function _showError(msg) {
    const el = document.getElementById('champ-error')
    if (!el) return
    el.textContent = msg
    el.style.display = msg ? 'block' : 'none'
  }

  /* ── Publish / update ──────────────────────────────────────── */
  function _validate() {
    const seenLeague = new Set(), seenEmp = new Set()
    for (const [i, r] of _rows.entries()) {
      const n = i + 1
      if (!r.league.trim())  return `Row ${n}: enter the league name.`
      if (!r.employeeId)     return `Row ${n}: choose the champion.`
      if (seenLeague.has(_norm(r.league))) return `Row ${n}: the league "${r.league.trim()}" is listed twice.`
      if (seenEmp.has(r.employeeId))       return `Row ${n}: this person is already a champion in another league this quarter.`
      seenLeague.add(_norm(r.league)); seenEmp.add(r.employeeId)
    }
    return null
  }

  async function _publish() {
    if (_busy) return
    _showError('')
    const problem = _validate()
    if (problem) { _showError(problem); return }

    _busy = true
    const btn = document.getElementById('champ-publish')
    if (btn) { btn.disabled = true; btn.textContent = 'Publishing…' }

    const key       = _key(_year, _quarter)
    const label     = _label(key)
    const existing  = _existingFor(key)
    const firstTime = existing.length === 0 || _pendingAnnounce.has(key)
    const errors    = []
    const announced = []   // [{ name, league, note }] for the announcement

    try {
      // 1. Leagues removed from the form → delete their badge (awards cascade)
      const keepIds = new Set(_rows.map(r => r.badgeId).filter(Boolean))
      for (const b of existing) {
        if (keepIds.has(b.id)) continue
        const stillListed = _rows.some(r => !r.badgeId && _norm(r.league) === _norm(b.league))
        if (stillListed) continue
        const { error } = await API.deleteChampionBadge(b.id)
        if (error) errors.push(`Could not remove "${b.league}": ${error.message}`)
      }

      // 2. Each row: ensure badge, ensure the right person holds it
      for (const r of _rows) {
        const league = r.league.trim().replace(/\s+/g, ' ')
        const name   = `${label} Champion · ${league}`
        const emp    = _employees.find(e => e.id === r.employeeId)
        const note   = r.note.trim() || null

        let badge = existing.find(b => b.id === r.badgeId)
                 || existing.find(b => _norm(b.league) === _norm(league))

        if (!badge) {
          const { data, error } = await API.createChampionBadge({
            name, description: `${label} Champion — ${league}`,
            icon: BADGE_ICON, colour: BADGE_COLOUR, period: key, league,
          })
          if (error || !data) { errors.push(`${league}: ${error?.message || 'could not create badge'}`); continue }
          badge = { ...data, awards: [] }
        } else if (badge.league !== league) {
          const { error } = await API.updateChampionBadge(badge.id, {
            name, league, description: `${label} Champion — ${league}`,
          })
          if (error) { errors.push(`${league}: ${error.message}`); continue }
        }

        const awards = badge.awards || []
        const mine   = awards.find(a => a.employee?.id === r.employeeId)

        // Anyone else holding this league's badge is replaced
        for (const a of awards) {
          if (a === mine) continue
          await API.revokeEmployeeBadge(a.id)
        }

        let needsAward = !mine
        if (mine && (mine.note || null) !== note) {   // note changed → rewrite quietly
          await API.revokeEmployeeBadge(mine.id)
          needsAward = true
        }
        const notify = !mine

        if (needsAward) {
          const { data: award, error } = await API.awardBadge({
            employee_id: r.employeeId, badge_id: badge.id, awarded_by: _user.id, note,
          })
          if (error) { errors.push(`${league} (${emp?.name || 'winner'}): ${error.message}`); continue }
          if (notify) {
            API.createNotification({
              recipient_employee_id: r.employeeId,
              type:      'success',
              message:   `🏆 You're a ${label} Champion — ${league}!${note ? ` "${note}"` : ''}`,
              module:    'badges',
              record_id: award?.id || null,
            }).catch(() => {})
          }
        }
        announced.push({ name: emp?.name || '', league, note })
      }

      // 3. One announcement, only the first time a quarter is published
      //    (a first publish that hit errors announces on the retry instead)
      if (firstTime && errors.length) _pendingAnnounce.add(key)
      if (firstTime && announced.length && !errors.length) {
        _pendingAnnounce.delete(key)
        const lines = announced.map(a => `• ${a.name} — ${a.league}${a.note ? `: ${a.note}` : ''}`).join('\n')
        API.createAnnouncement({
          title:      `🏆 ${label} Champions`,
          content:    `Congratulations to our ${label} champions!\n\n${lines}`,
          published:  true,
          created_by: _user.id,
        }).catch(() => {})
      }

      // 4. Refresh from the database
      const { data: fresh } = await API.getChampionBadges()
      _champions = fresh || []
      _prefilled = false
      // On errors keep what HR typed so the retry has something to retry;
      // on success show the saved state.
      if (!errors.length) _syncRowsToPeriod()

      if (errors.length) {
        _paint()
        _showError(`Some items did not save — click the button again to retry:\n${errors.join('\n')}`)
        Utils.showToast('Published with some errors', 'warning')
      } else {
        _paint()
        Utils.showToast(firstTime ? `🏆 ${label} champions published!` : `${label} champions updated`, 'success')
      }
    } catch (err) {
      console.error('[Champions] publish failed:', err)
      _paint()
      _showError(err?.message || 'Something went wrong. Please try again.')
    } finally {
      _busy = false
    }
  }

  /* ── Delete a whole quarter ────────────────────────────────── */
  async function _deleteQuarter(key) {
    const badges = _existingFor(key)
    if (!badges.length) return
    if (!confirm(`Delete ${_label(key)} champions?\n\nThis removes the badges from the winners' profiles and from the Hall of Fame. This cannot be undone.`)) return

    const errors = []
    for (const b of badges) {
      const { error } = await API.deleteChampionBadge(b.id)
      if (error) errors.push(error.message)
    }
    const { data: fresh } = await API.getChampionBadges()
    _champions = fresh || []
    _prefilled = false
    _syncRowsToPeriod()
    _paint()
    if (errors.length) _showError(`Could not delete everything: ${errors[0]}`)
    else Utils.showToast(`${_label(key)} champions deleted`, 'success')
  }

  return { render, init }
})()

ModuleRegistry.register({
  key:       'champions',
  routeId:   'champions',
  label:     'Quarterly Champions',
  order:     8,
  icon:      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8"></path><path d="M12 17v4"></path><path d="M7 4h10v5a5 5 0 0 1-10 0z"></path><path d="M17 5h3v2a3 3 0 0 1-3 3"></path><path d="M7 5H4v2a3 3 0 0 0 3 3"></path></svg>`,
  getModule: () => ChampionsModule,
  features:  {},
})
