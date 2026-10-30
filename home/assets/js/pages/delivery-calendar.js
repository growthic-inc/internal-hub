/* ============================================================
   DELIVERY CALENDAR — Client Dashboard → "Delivery Calendar" tab
   Read-only view of the content writers' Master Sheet: one row per
   client, one column per day, each cell a status badge. Data comes
   from the delivery-calendar Edge Function (nothing is stored here
   except which clients are hidden, shared by everyone).
   ============================================================ */

const DeliveryCalendar = (() => {

  const OFF_DAY      = 0      // 0 = Sunday (weekly off, hatched)
  const ROLLING_DAYS = 15     // default window: 15 days either side of today
  const STALE_MS     = 2 * 60 * 1000

  let _root = null            // container element this view is mounted into
  let _data = null            // last response from the Edge Function
  let _error = null
  let _loading = false
  let _unsubscribe = null
  let _rangeStart = null, _rangeEnd = null
  let _legendVisible = true
  let _menuOpen = false, _rangePopOpen = false
  let _clientSearch = ''
  let _dd = { client: null, month: null }
  let _lastOwnWrite = 0
  let _refetchTimer = null
  let _items = []             // flat list backing the cells (tooltip lookups)
  let _docBound = false

  /* ── date helpers ───────────────────────────────────────── */
  const addDays      = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r }
  const startOfMonth = d => new Date(d.getFullYear(), d.getMonth(), 1)
  const endOfMonth   = d => new Date(d.getFullYear(), d.getMonth() + 1, 0)
  const addMonths    = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1)
  const daysInMonth  = d => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  const sameDay      = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  const iso          = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const esc          = s => Utils.escapeHtml(String(s ?? ''))
  const isUrl        = s => /^(https?:\/\/|www\.)/i.test(String(s || '').trim())
  const fmtShort     = d => d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })

  function _rollingWindow() {
    const t = new Date(); t.setHours(0, 0, 0, 0)
    return { start: addDays(t, -ROLLING_DAYS), end: addDays(t, ROLLING_DAYS) }
  }
  function _daysBetween(start, end) {
    const out = []
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) out.push(new Date(d))
    return out
  }

  /* ── mount / unmount ────────────────────────────────────── */
  async function mount(container) {
    if (!container) return
    if (_root === container && _data) { _render(); return }   // already showing — keep state
    _teardownLive()
    _root = container
    _data = null; _error = null
    const w = _rollingWindow()
    _rangeStart = w.start; _rangeEnd = w.end
    _bindDocument()
    _renderShell()
    await _load(false)
    _unsubscribe = API.subscribeDeliveryTabs(_onTabsChanged)
  }

  function _teardownLive() {
    if (_unsubscribe) { try { _unsubscribe() } catch (_) {} _unsubscribe = null }
    clearTimeout(_refetchTimer)
    _removeTooltip()
    document.getElementById('dcal-dd-overlay')?.remove()
  }

  function _alive() { return !!_root && document.body.contains(_root) }

  function _onTabsChanged() {
    if (!_alive()) { _teardownLive(); _root = null; return }
    if (Date.now() - _lastOwnWrite < 1500) return          // our own change — already applied
    clearTimeout(_refetchTimer)
    _refetchTimer = setTimeout(() => _load(false, true), 400)
  }

  function _bindDocument() {
    if (_docBound) return
    _docBound = true
    document.addEventListener('click', e => {
      if (!_alive()) return
      if (_menuOpen && !e.target.closest('.dcal-menu-wrap')) { _menuOpen = false; _syncMenu() }
      if (_rangePopOpen && !e.target.closest('.dcal-range-wrap')) { _rangePopOpen = false; _root.querySelector('.dcal-range-pop')?.classList.add('dcal-hidden') }
    })
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') document.getElementById('dcal-dd-overlay')?.remove()
    })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !_alive() || !_data) return
      if (Date.now() - new Date(_data.fetchedAt).getTime() > STALE_MS) _load(false, true)
    })
  }

  /* ── data ───────────────────────────────────────────────── */
  async function _load(refresh, silent = false) {
    if (_loading) return
    _loading = true
    if (!silent) { _error = null; _renderShell() }
    const { data, error } = await API.getDeliveryCalendar(refresh)
    _loading = false
    if (!_alive()) return
    if (error) {
      if (!_data || !silent) { _data = null; _error = error.message }
      else Utils.showToast(error.message, 'error')
    } else {
      _data = data; _error = null
    }
    _render()
  }

  function _visibleClients() { return (_data?.clients || []).filter(c => !c.hidden) }

  /* ── render ─────────────────────────────────────────────── */
  function _renderShell() {
    if (!_root) return
    _root.innerHTML = `<div class="dcal-state"><p class="loading-text">Loading delivery calendar…</p></div>`
  }

  function _render() {
    if (!_root) return
    if (_error) {
      _root.innerHTML = `
        <div class="dcal-state">
          <p style="font-size:14px;font-weight:600;color:var(--text);margin:0 0 6px;">Couldn't load the Delivery Calendar</p>
          <p style="font-size:13px;color:var(--text-muted);margin:0 0 14px;max-width:520px;">${esc(_error)}</p>
          <button class="btn btn--primary btn--sm" id="dcal-retry">Try again</button>
        </div>`
      _root.querySelector('#dcal-retry').onclick = () => _load(true)
      return
    }
    if (!_data) { _renderShell(); return }

    const scrollEl = _root.querySelector('.dcal-scroll')
    const scrollLeft = scrollEl ? scrollEl.scrollLeft : null

    const all     = _data.clients || []
    const hiddenN = all.filter(c => c.hidden).length
    const updated = new Date(_data.fetchedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })

    _root.innerHTML = `
      <div class="dcal-toolbar">
        <div class="dcal-nav">
          <span class="dcal-range-label">${esc(fmtShort(_rangeStart))} – ${esc(_rangeEnd.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' }))}</span>
          <div class="dcal-arrows">
            <button class="dcal-icon-btn" id="dcal-prev" title="Previous month" aria-label="Previous month">‹</button>
            <button class="dcal-icon-btn dcal-icon-btn--text" id="dcal-today">Today</button>
            <button class="dcal-icon-btn" id="dcal-next" title="Next month" aria-label="Next month">›</button>
          </div>
          <div class="dcal-range-wrap">
            <button class="dcal-icon-btn dcal-icon-btn--text" id="dcal-range-toggle">Custom range</button>
            <div class="dcal-range-pop dcal-hidden">
              <label>From <input type="date" id="dcal-from" value="${iso(_rangeStart)}"></label>
              <label>To <input type="date" id="dcal-to" value="${iso(_rangeEnd)}"></label>
              <button class="btn btn--primary btn--sm" id="dcal-apply">Apply</button>
            </div>
          </div>
        </div>
        <div class="dcal-actions">
          <span class="dcal-updated" title="Data is read from the Master Sheet and refreshed about every minute">Updated ${esc(updated)}</span>
          <button class="btn btn--ghost btn--sm" id="dcal-legend-toggle">${_legendVisible ? 'Hide legend' : 'Show legend'}</button>
          <div class="dcal-menu-wrap">
            <button class="btn btn--ghost btn--sm" id="dcal-menu-btn">Clients${hiddenN ? ` <span class="dcal-hidden-count">${hiddenN} hidden</span>` : ''} ▾</button>
            <div class="dcal-menu dcal-hidden" id="dcal-menu"></div>
          </div>
          <button class="btn btn--ghost btn--sm" id="dcal-sync">Sync now</button>
        </div>
      </div>
      ${_legendVisible ? _legendHtml() : ''}
      <div id="dcal-grid-host"></div>
    `

    _renderGrid()
    _bindToolbar()
    _syncMenu()
    if (scrollLeft != null) { const el = _root.querySelector('.dcal-scroll'); if (el) el.scrollLeft = scrollLeft }
  }

  function _legendHtml() {
    const item = (cls, label) => `<span><i class="dcal-dot dcal-s-${cls}"></i>${label}</span>`
    return `<div class="dcal-legend">
      ${item('ideation', 'ID = Ideation')}${item('ideation-approved', 'IA = Ideation Approved')}
      ${item('content-review', 'CR = Content Review')}${item('content-approved', 'CA = Content Approved')}
      ${item('delivered', 'DL = Delivered')}${item('client-approved', 'CLA = Client Approved')}
      ${item('green', '✓ = Posted')}${item('orange', 'RW = Rework')}${item('red', 'RJ = Rejected')}
      ${item('grey', '? = status text not recognised (hover to see what was typed)')}
    </div>`
  }

  function _renderGrid() {
    const host = _root.querySelector('#dcal-grid-host')
    const clients = _visibleClients()
    if (!clients.length) {
      host.innerHTML = `<div class="dcal-state"><p style="font-size:13px;color:var(--text-muted);margin:0;">${(_data.clients || []).length ? 'All clients are hidden. Use the Clients menu to show some.' : 'No client tabs found in the Master Sheet.'}</p></div>`
      return
    }

    const days  = _daysBetween(_rangeStart, _rangeEnd)
    const today = new Date()
    _items = []

    let html = `<div class="dcal-scroll"><table class="dcal-grid"><thead><tr><th class="dcal-client-cell">Client</th>`
    days.forEach((d, i) => {
      const off = d.getDay() === OFF_DAY, isToday = sameDay(d, today)
      const showMonth = d.getDate() === 1 || i === 0
      html += `<th class="dcal-day-head${off ? ' dcal-off' : ''}${isToday ? ' dcal-today' : ''}">${showMonth ? d.toLocaleString('en-IN', { month: 'short' }) + ' ' : ''}${d.getDate()}${isToday ? '<div class="dcal-today-label">Today</div>' : ''}</th>`
    })
    html += `</tr></thead><tbody>`

    for (const c of clients) {
      const byDate = {}
      for (const it of c.deliverables) (byDate[it.date] ||= []).push(it)
      html += `<tr><td class="dcal-client-cell dcal-client-link" data-gid="${c.gid}" title="Open ${esc(c.name)} calendar">${esc(c.name)}</td>`
      for (const d of days) {
        const key = iso(d), off = d.getDay() === OFF_DAY, isToday = sameDay(d, today)
        const its = byDate[key] || []
        html += `<td class="dcal-cell${off ? ' dcal-off' : ''}${isToday ? ' dcal-today' : ''}">`
        if (its.length) {
          html += `<div class="dcal-cell-inner">` + its.map(it => {
            _items.push({ it, client: c })
            return `<div class="dcal-part dcal-s-${it.statusColor}" data-k="${_items.length - 1}">${it.statusColor === 'green' ? '✓' : esc(it.statusAbbr)}</div>`
          }).join('') + `</div>`
        }
        html += `</td>`
      }
      html += `</tr>`
    }
    html += `</tbody></table></div>`
    host.innerHTML = html

    const table = host.querySelector('.dcal-grid')
    table.addEventListener('mouseover', e => {
      const part = e.target.closest('.dcal-part'); if (!part) return
      _showTooltip(e, _items[Number(part.dataset.k)])
    })
    table.addEventListener('mousemove', e => { if (e.target.closest('.dcal-part')) _moveTooltip(e) })
    table.addEventListener('mouseout', e => { if (e.target.closest('.dcal-part')) _removeTooltip() })
    table.addEventListener('click', e => {
      const link = e.target.closest('.dcal-client-link'); if (!link) return
      const client = clients.find(c => String(c.gid) === link.dataset.gid)
      if (client) _openDrilldown(client)
    })
  }

  /* ── toolbar ────────────────────────────────────────────── */
  function _bindToolbar() {
    const q = id => _root.querySelector(id)
    const setRange = (s, e) => { _rangeStart = s; _rangeEnd = e; _render() }
    q('#dcal-prev').onclick  = () => { const s = addMonths(_rangeStart, -1); setRange(s, endOfMonth(s)) }
    q('#dcal-next').onclick  = () => { const s = addMonths(_rangeStart, 1);  setRange(s, endOfMonth(s)) }
    q('#dcal-today').onclick = () => { const w = _rollingWindow(); setRange(w.start, w.end) }
    q('#dcal-range-toggle').onclick = e => {
      e.stopPropagation()
      _rangePopOpen = !_rangePopOpen
      q('.dcal-range-pop').classList.toggle('dcal-hidden', !_rangePopOpen)
    }
    q('#dcal-apply').onclick = () => {
      const from = q('#dcal-from').value, to = q('#dcal-to').value
      if (!from || !to) return
      const s = new Date(from + 'T00:00:00'), e = new Date(to + 'T00:00:00')
      if (s > e) { Utils.showToast('The start date must be before the end date.', 'error'); return }
      _rangePopOpen = false
      setRange(s, e)
    }
    q('#dcal-legend-toggle').onclick = () => { _legendVisible = !_legendVisible; _render() }
    q('#dcal-sync').onclick = async () => {
      const btn = q('#dcal-sync'); btn.disabled = true; btn.textContent = 'Syncing…'
      await _load(true, true)
    }
    q('#dcal-menu-btn').onclick = e => { e.stopPropagation(); _menuOpen = !_menuOpen; _syncMenu() }
  }

  /* ── Clients menu (shared hide / show) ──────────────────── */
  function _syncMenu() {
    const menu = _root?.querySelector('#dcal-menu'); if (!menu) return
    menu.classList.toggle('dcal-hidden', !_menuOpen)
    if (!_menuOpen) return
    const all = [...(_data?.clients || [])]
    const q = _clientSearch.trim().toLowerCase()
    const shown = q ? all.filter(c => c.name.toLowerCase().includes(q)) : all
    menu.innerHTML = `
      <div class="dcal-menu-head">
        <span>Show / hide clients <em>(same for everyone)</em></span>
        <button class="dcal-link-btn" id="dcal-show-all">Show all</button>
      </div>
      <div style="padding:0 10px 6px;"><input class="dcal-menu-search" id="dcal-menu-search" placeholder="Search…" value="${esc(_clientSearch)}" autocomplete="off"></div>
      <div class="dcal-menu-list">
        ${shown.map(c => `
          <label class="dcal-menu-row">
            <input type="checkbox" data-gid="${c.gid}" ${c.hidden ? '' : 'checked'}>
            <span>${esc(c.name)}</span>
            ${!c.looksLikeClient ? '<small title="This tab has few dated rows or recognised statuses">no data</small>' : ''}
          </label>`).join('') || '<div class="dcal-menu-empty">No match</div>'}
      </div>`
    const search = menu.querySelector('#dcal-menu-search')
    search.oninput = () => { _clientSearch = search.value; const pos = search.selectionStart; _syncMenu(); const s2 = _root.querySelector('#dcal-menu-search'); s2?.focus(); s2?.setSelectionRange(pos, pos) }
    menu.querySelector('#dcal-show-all').onclick = () => _setHidden(all.filter(c => c.hidden).map(c => c.gid), false)
    menu.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.onchange = () => _setHidden([Number(cb.dataset.gid)], !cb.checked)
    })
  }

  async function _setHidden(gids, hidden) {
    if (!gids.length || !_data) return
    const targets = _data.clients.filter(c => gids.includes(c.gid))
    const before = targets.map(c => ({ c, was: c.hidden, deliverables: c.deliverables }))
    targets.forEach(c => { c.hidden = hidden; if (hidden) c.deliverables = [] })
    _lastOwnWrite = Date.now()
    _render()
    const { error } = await API.setDeliveryTabsHidden(_data.sheetId, gids, hidden)
    if (error) {
      before.forEach(b => { b.c.hidden = b.was; b.c.deliverables = b.deliverables })
      Utils.showToast('Could not save that change. Please try again.', 'error')
      _render()
      return
    }
    _lastOwnWrite = Date.now()
    if (!hidden) await _load(false, true)    // newly shown clients need their data
  }

  /* ── hover tooltip ──────────────────────────────────────── */
  function _tooltipEl() {
    let el = document.getElementById('dcal-tooltip')
    if (!el) { el = document.createElement('div'); el.id = 'dcal-tooltip'; el.className = 'dcal-tooltip'; document.body.appendChild(el) }
    return el
  }
  function _showTooltip(e, entry) {
    if (!entry) return
    const { it, client } = entry
    const el = _tooltipEl()
    el.innerHTML = `<b>${esc(client.name)} — ${esc(it.status || 'No status')}</b>
      ${it.statusUnrecognized ? `<span class="dcal-tt-warn">Status text isn't one of the 9 recognised values.</span>` : ''}
      ${it.bucket ? `Bucket: ${esc(it.bucket)}<br>` : ''}
      ${it.content ? `Content: ${esc(it.content.slice(0, 140))}<br>` : ''}
      ${it.tagline ? `Tagline/Design: ${esc(it.tagline.slice(0, 140))}<br>` : ''}
      ${isUrl(it.creativeLink) ? `Has a creative link — open the client's calendar to use it.` : ''}`
    el.style.display = 'block'
    _moveTooltip(e)
  }
  function _moveTooltip(e) {
    const el = document.getElementById('dcal-tooltip'); if (!el) return
    const w = el.offsetWidth, h = el.offsetHeight
    let x = e.clientX + 14, y = e.clientY + 14
    if (x + w > window.innerWidth - 8)  x = e.clientX - w - 14
    if (y + h > window.innerHeight - 8) y = e.clientY - h - 14
    el.style.left = Math.max(8, x) + 'px'; el.style.top = Math.max(8, y) + 'px'
  }
  function _removeTooltip() { document.getElementById('dcal-tooltip')?.remove() }

  /* ── per-client month view ──────────────────────────────── */
  function _openDrilldown(client) {
    const dated = client.deliverables.map(d => d.date).sort()
    const month = dated.length ? startOfMonth(new Date(dated[dated.length - 1] + 'T00:00:00')) : startOfMonth(new Date())
    _dd = { client, month }
    _renderDrilldown()
  }

  function _renderDrilldown() {
    const { client, month } = _dd
    let overlay = document.getElementById('dcal-dd-overlay')
    if (!overlay) {
      overlay = document.createElement('div')
      overlay.id = 'dcal-dd-overlay'
      overlay.className = 'modal-overlay'
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })
      document.body.appendChild(overlay)
    }
    const n = daysInMonth(month)
    const firstDow = new Date(month.getFullYear(), month.getMonth(), 1).getDay()
    const blanks = firstDow === 0 ? 6 : firstDow - 1    // Monday-first
    const today = new Date()
    const label = month.toLocaleString('en-IN', { month: 'long', year: 'numeric' })

    const byDate = {}
    for (const it of client.deliverables) (byDate[it.date] ||= []).push(it)

    let cells = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="dcal-dd-head">${d}</div>`).join('')
    cells += '<div class="dcal-dd-day dcal-dd-blank"></div>'.repeat(blanks)
    for (let d = 1; d <= n; d++) {
      const date = new Date(month.getFullYear(), month.getMonth(), d)
      const its = byDate[iso(date)] || []
      cells += `<div class="dcal-dd-day${date.getDay() === OFF_DAY ? ' dcal-off' : ''}${sameDay(date, today) ? ' dcal-dd-today' : ''}">
        <div class="dcal-dd-num">${d}</div>
        ${its.map(it => `<div class="dcal-dd-item dcal-s-${it.statusColor}" title="${esc(it.status || 'Unrecognised')}${it.content ? ' — ' + esc(it.content) : ''}">
          ${esc(it.status || it.statusAbbr)}${isUrl(it.creativeLink) ? ` <a href="${esc(/^www\./i.test(it.creativeLink.trim()) ? 'https://' + it.creativeLink.trim() : it.creativeLink.trim())}" target="_blank" rel="noopener noreferrer">↗</a>` : ''}
        </div>`).join('')}
      </div>`
    }
    const monthKey = iso(month).slice(0, 7)
    const hasItems = client.deliverables.some(d => d.date.slice(0, 7) === monthKey)

    overlay.innerHTML = `
      <div class="modal modal--lg">
        <div class="modal-header">
          <h3 class="modal-title">${esc(client.name)} — ${esc(label)}</h3>
          <div class="dcal-dd-controls">
            <button class="dcal-icon-btn" id="dcal-dd-prev" aria-label="Previous month">‹</button>
            <button class="dcal-icon-btn" id="dcal-dd-next" aria-label="Next month">›</button>
            <button class="modal-close" id="dcal-dd-close" aria-label="Close">&times;</button>
          </div>
        </div>
        <div style="padding:0 24px 24px;">
          <div class="dcal-dd-grid">${cells}</div>
          ${hasItems ? '' : `<p class="dcal-dd-empty">No dated entries for ${esc(client.name)} in ${esc(label)}. Use ‹ › to check other months.</p>`}
        </div>
      </div>`
    overlay.querySelector('#dcal-dd-close').onclick = () => overlay.remove()
    overlay.querySelector('#dcal-dd-prev').onclick = () => { _dd.month = addMonths(_dd.month, -1); _renderDrilldown() }
    overlay.querySelector('#dcal-dd-next').onclick = () => { _dd.month = addMonths(_dd.month, 1);  _renderDrilldown() }
  }

  return { mount }
})()
