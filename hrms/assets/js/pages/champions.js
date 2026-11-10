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

  let _hSearch    = ''          // history table: text filter
  let _hQuarter   = ''          // history table: quarter filter ('' = all)
  let _invalid    = -1          // index of the row the last validation complained about

  const BADGE_ICON   = '🏆'
  const BADGE_COLOUR = '#d97706'

  /* ── Period helpers ────────────────────────────────────────── */
  const _key   = (y, q) => `${y}-Q${q}`
  const _label = (key)  => { const [y, q] = key.split('-'); return `${q} ${y}` }
  const _norm  = (s)    => (s || '').trim().replace(/\s+/g, ' ').toLowerCase()
  const _blankRow = ()  => ({ badgeId: null, league: '', employeeId: '', note: '' })

  const _esc    = (v)   => Utils.escapeHtml(v)
  const _emp    = (id)  => _employees.find(e => e.id === id)
  const _sub    = (emp) => emp?.department ? Utils.getDeptLabel(emp.department) : ''
  const _avatar = (emp) => !emp ? '?'
    : (emp.profile_image_url ? `<img src="${_esc(emp.profile_image_url)}" alt="">` : _esc(Utils.getInitials(emp.name || '')))
  const _ready  = (r)   => !!(r.league.trim() && r.employeeId)

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
    _invalid = -1

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
    const key       = _key(_year, _quarter)
    const published = _existingFor(key).length > 0
    const thisYear  = new Date().getFullYear()
    const yearOpts  = [...new Set([thisYear - 1, thisYear, thisYear + 1, _year])].sort()

    root.innerHTML = `
      <div class="chm-hero">
        <div class="chm-hero-icon">🏆</div>
        <div>
          <h2>Celebrate this quarter's champions</h2>
          <p>Pick one winner per league. They're notified straight away, and everyone sees them on
             the Growthic One home page and in the Hall of Fame.</p>
        </div>
      </div>

      <div class="chm-layout">
        <div class="section-card chm-form">
          <div class="chm-block">
            <div class="chm-step">
              <span class="chm-step-n">1</span><span class="chm-step-t">Choose the quarter</span>
              <span class="chm-status${published ? ' chm-status--live' : ''}">${published ? 'Published' : 'Draft'}</span>
            </div>
            <div class="chm-period">
              <div class="chm-seg" id="champ-quarter" role="group" aria-label="Quarter">
                ${[1, 2, 3, 4].map(q => `<button type="button" class="chm-seg-btn${q === _quarter ? ' is-on' : ''}" data-q="${q}" aria-pressed="${q === _quarter}">Q${q}</button>`).join('')}
              </div>
              <select class="form-select chm-year" id="champ-year" aria-label="Year">
                ${yearOpts.map(y => `<option value="${y}"${y === _year ? ' selected' : ''}>${y}</option>`).join('')}
              </select>
            </div>
            <p class="chm-note">${published
              ? `${_esc(_label(key))} is already published. Changes you make here update it, and swapping a winner replaces their badge.`
              : `Nothing is saved or announced until you press Publish.`}</p>
          </div>

          <div class="chm-block" style="border-bottom:0;">
            <div class="chm-step"><span class="chm-step-n">2</span><span class="chm-step-t">Pick the winners</span></div>
            <div class="chm-suggest" id="champ-suggest">${_suggestHtml()}</div>
            <div class="chm-cards" id="champ-rows">${_rows.map((r, i) => _cardHtml(r, i)).join('')}</div>
            <button class="chm-add" id="champ-add-row" type="button">+ Add another league</button>
          </div>

          <div id="champ-error" class="alert alert-danger" style="display:none;margin:0 20px 14px;"></div>

          <div class="chm-bar">
            <span class="chm-progress" id="champ-progress">${_progressText()}</span>
            <button class="btn btn--primary" id="champ-publish" type="button">
              ${published ? 'Update champions' : 'Publish champions'}
            </button>
          </div>
        </div>

        <aside class="section-card chm-preview">
          <div class="chm-preview-head">
            <b>Preview</b>
            <span>${_esc(_label(key))} · how it looks on Growthic One</span>
          </div>
          <div class="chm-preview-body" id="champ-preview-body">${_previewHtml()}</div>
        </aside>
      </div>

      <div class="chm-hist-title">Published quarters</div>
      <div id="champ-history">${_historyHtml()}</div>`

    _bind()
  }

  function _cardHtml(r, i) {
    const opts = _employees.map(e => {
      const dept = _sub(e)
      return `<option value="${e.id}"${e.id === r.employeeId ? ' selected' : ''}>${_esc(e.name)}${dept ? ` · ${_esc(dept)}` : ''}</option>`
    }).join('')
    return `
      <div class="chm-card" id="champ-row-${i}" data-i="${i}">
        <div class="chm-card-top">
          <span class="chm-card-n">🏆 Winner ${i + 1}</span>
          <button class="chm-card-x" data-remove="${i}" type="button" title="Remove" aria-label="Remove winner ${i + 1}">✕</button>
        </div>
        <div class="chm-fields">
          <label class="chm-field"><span>League</span>
            <input class="form-input" data-f="league" placeholder="e.g. Sales League"
                   value="${_esc(r.league)}" maxlength="60"></label>
          <label class="chm-field"><span>Champion</span>
            <select class="form-select" data-f="employeeId">
              <option value="">Select employee…</option>${opts}
            </select></label>
          <label class="chm-field chm-field--wide"><span>Reason or reward <em>(optional)</em></span>
            <input class="form-input" data-f="note" placeholder="e.g. Closed 12 deals, ₹5,000 voucher"
                   value="${_esc(r.note)}" maxlength="200"></label>
        </div>
      </div>`
  }

  /** "Used before" chips — leagues from earlier quarters that aren't in the form yet */
  function _suggestHtml() {
    const typed = new Set(_rows.map(r => _norm(r.league)).filter(Boolean))
    const seen  = new Set(), list = []
    _champions.slice().sort((a, b) => b.period.localeCompare(a.period)).forEach(b => {
      const n = _norm(b.league)
      if (!n || seen.has(n)) return
      seen.add(n)
      if (!typed.has(n)) list.push(b.league)
    })
    if (!list.length) return ''
    return `<span class="chm-suggest-l">Used before:</span>` +
      list.slice(0, 6).map(l => `<button type="button" class="chm-chip-btn" data-suggest="${_esc(l)}">+ ${_esc(l)}</button>`).join('')
  }

  function _progressText() {
    const n = _rows.filter(_ready).length, total = _rows.length
    if (total && n === total) return `✓ All ${total} winner${total !== 1 ? 's' : ''} ready to publish`
    return `${n} of ${total} winner${total !== 1 ? 's' : ''} ready`
  }

  /** Live preview — same chips people will see on Growthic One */
  function _previewHtml() {
    return `<div class="chm-preview-tiles">${_rows.map(r => {
      const emp    = _emp(r.employeeId)
      const league = r.league.trim().replace(/\s+/g, ' ')
      const note   = (r.note || '').trim()
      const sub    = _sub(emp)
      return `
        <div class="champ-tile${!emp && !league ? ' chm-ghost' : ''}">
          <div class="champ-avatar-wrap">
            <div class="champ-avatar">${_avatar(emp)}</div>
            <span class="champ-trophy">🏆</span>
          </div>
          <div class="champ-main">
            <div class="champ-name">${emp ? _esc(emp.name) : '<span class="chm-ph">Champion</span>'}</div>
            ${sub ? `<div class="champ-sub">${_esc(sub)}</div>` : ''}
          </div>
          <span class="champ-tag${league ? '' : ' chm-ph-tag'}">${league ? _esc(league) : 'League'}</span>
          ${note ? `<div class="champ-note">“${_esc(note)}”</div>` : ''}
        </div>`
    }).join('')}</div>`
  }

  function _refreshLive() {
    const prev = document.getElementById('champ-preview-body')
    if (prev) prev.innerHTML = _previewHtml()
    const prog = document.getElementById('champ-progress')
    if (prog) prog.textContent = _progressText()
    const sug = document.getElementById('champ-suggest')
    if (sug) sug.innerHTML = _suggestHtml()
  }

  /* ── Published data: a spreadsheet-style table ─────────────── */
  const _fmtDate = (iso) => {
    const d = iso ? new Date(iso) : null
    return d && !isNaN(d) ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
  }

  /** Flat rows for the table and the CSV export, after the search / quarter filters */
  function _historyRows() {
    const q = _hSearch.trim().toLowerCase()
    const rows = []
    _byPeriod().forEach(([key, badges]) => {
      if (_hQuarter && key !== _hQuarter) return
      badges.forEach(b => {
        const a = b.awards?.[0], emp = a?.employee
        const row = {
          key, quarter: _label(key), league: b.league || '', name: emp?.name || '',
          emp, dept: emp?.department ? Utils.getDeptLabel(emp.department) : '',
          designation: emp?.designation || '', note: a?.note || '', date: _fmtDate(a?.awarded_at),
        }
        const hay = `${row.quarter} ${row.league} ${row.name} ${row.dept} ${row.designation} ${row.note}`.toLowerCase()
        if (!q || hay.includes(q)) rows.push(row)
      })
    })
    return rows
  }

  function _tableHtml() {
    const rows = _historyRows()
    if (!rows.length) return `<div class="chm-empty" style="margin:14px;">No champions match your filters.</div>`
    const editing = _key(_year, _quarter)
    const latest  = _byPeriod()[0]?.[0]
    let prev = null

    return `<div class="chm-table-wrap"><table class="chm-table">
      <thead><tr>
        <th>Quarter</th><th>League</th><th>Champion</th><th>Department</th>
        <th>Reason / reward</th><th>Published on</th><th class="chm-act-h"></th>
      </tr></thead>
      <tbody>${rows.map(r => {
        const first = r.key !== prev; prev = r.key
        return `
        <tr${first ? ' class="chm-qstart"' : ''}>
          <td class="chm-qcell"><b>${_esc(r.quarter)}</b>
            ${first && r.key === latest ? '<span class="chm-chip">Latest</span>' : ''}
            ${first && r.key === editing ? '<span class="chm-chip chm-chip--edit">Editing</span>' : ''}</td>
          <td><span class="champ-tag">${_esc(r.league)}</span></td>
          <td><span class="chm-who"><span class="champ-avatar">${r.emp ? _avatar(r.emp) : '?'}</span>
              <span>${r.name ? `<b>${_esc(r.name)}</b>` : '<i>unassigned</i>'}${r.designation ? `<small>${_esc(r.designation)}</small>` : ''}</span></span></td>
          <td>${r.dept ? _esc(r.dept) : '—'}</td>
          <td class="chm-note-cell">${r.note ? _esc(r.note) : '<span class="chm-ph">—</span>'}</td>
          <td class="chm-date">${_esc(r.date)}</td>
          <td class="chm-act">
            <button class="btn btn--ghost btn--sm" data-edit="${r.key}" type="button" title="Edit ${_esc(r.quarter)}">Edit</button>
            <button class="btn btn--ghost btn--sm" data-del="${r.key}" type="button" title="Delete all of ${_esc(r.quarter)}" style="color:var(--danger);">Delete</button>
          </td>
        </tr>`
      }).join('')}
      </tbody></table></div>`
  }

  function _historyHtml() {
    const groups = _byPeriod()
    if (!groups.length) {
      return `<div class="chm-empty"><div>🏆</div><b>No champions published yet</b>
        Once you publish a quarter, it shows up here and on Growthic One.</div>`
    }
    const total = _historyRows().length
    return `
      <div class="section-card">
        <div class="chm-tools">
          <input class="form-input chm-search" id="champ-search" type="search" placeholder="Search name, league, reason…"
                 value="${_esc(_hSearch)}" aria-label="Search champions">
          <select class="form-select chm-filter" id="champ-hist-q" aria-label="Filter by quarter">
            <option value="">All quarters</option>
            ${groups.map(([key]) => `<option value="${key}"${key === _hQuarter ? ' selected' : ''}>${_esc(_label(key))}</option>`).join('')}
          </select>
          <span class="chm-count" id="champ-count">${total} champion${total !== 1 ? 's' : ''}</span>
          <button class="btn btn--ghost btn--sm" id="champ-export" type="button">⬇ Export CSV</button>
        </div>
        <div id="champ-table">${_tableHtml()}</div>
      </div>`
  }

  function _refreshTable() {
    const t = document.getElementById('champ-table'); if (t) t.innerHTML = _tableHtml()
    const n = _historyRows().length
    const c = document.getElementById('champ-count'); if (c) c.textContent = `${n} champion${n !== 1 ? 's' : ''}`
  }

  function _exportCsv() {
    const rows = _historyRows()
    if (!rows.length) { Utils.showToast('Nothing to export', 'warning'); return }
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const head = ['Quarter', 'League', 'Champion', 'Department', 'Designation', 'Reason / reward', 'Published on']
    const csv  = [head, ...rows.map(r => [r.quarter, r.league, r.name, r.dept, r.designation, r.note, r.date])]
      .map(r => r.map(cell).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url; a.download = `quarterly-champions${_hQuarter ? '-' + _hQuarter : ''}.csv`
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
  }

  /* ── Events ────────────────────────────────────────────────── */
  function _bind() {
    document.getElementById('champ-quarter')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-q]')
      if (!btn) return
      _quarter = Number(btn.dataset.q); _syncRowsToPeriod(); _paint()
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
      _invalid = -1
      _paint()
    })

    document.getElementById('champ-add-row')?.addEventListener('click', () => {
      _rows.push(_blankRow()); _invalid = -1; _paint()
    })

    // "Used before" chips: drop the league into the first empty row, or add one
    document.getElementById('champ-suggest')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-suggest]')
      if (!btn) return
      const league = btn.dataset.suggest
      const empty  = _rows.find(r => !r.league.trim())
      if (empty) empty.league = league
      else _rows.push({ ..._blankRow(), league })
      _paint()
    })

    document.getElementById('champ-publish')?.addEventListener('click', _publish)

    document.getElementById('champ-search')?.addEventListener('input', (e) => { _hSearch = e.target.value; _refreshTable() })
    document.getElementById('champ-hist-q')?.addEventListener('change', (e) => { _hQuarter = e.target.value; _refreshTable() })
    document.getElementById('champ-export')?.addEventListener('click', _exportCsv)

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
    const rowEl = e.target.closest('.chm-card[data-i]')
    const f     = e.target.dataset.f
    if (!rowEl || !f) return
    const i = Number(rowEl.dataset.i)
    _rows[i][f] = e.target.value
    if (_invalid === i) { _invalid = -1; rowEl.classList?.remove('chm-card--invalid') }
    _refreshLive()
  }

  /** Outline the winner card the last validation complained about */
  function _flagInvalid() {
    if (_invalid < 0) return
    const el = document.getElementById(`champ-row-${_invalid}`)
    if (el?.classList) {
      el.classList.add('chm-card--invalid')
      el.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    }
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
    _invalid = -1
    for (const [i, r] of _rows.entries()) {
      const n = i + 1
      if (!r.league.trim())  { _invalid = i; return `Winner ${n}: enter the league name.` }
      if (!r.employeeId)     { _invalid = i; return `Winner ${n}: choose the champion.` }
      if (seenLeague.has(_norm(r.league))) { _invalid = i; return `Winner ${n}: the league "${r.league.trim()}" is listed twice.` }
      if (seenEmp.has(r.employeeId))       { _invalid = i; return `Winner ${n}: this person is already a champion in another league this quarter.` }
      seenLeague.add(_norm(r.league)); seenEmp.add(r.employeeId)
    }
    return null
  }

  async function _publish() {
    if (_busy) return
    _showError('')
    const problem = _validate()
    if (problem) { _showError(problem); _flagInvalid(); return }

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
