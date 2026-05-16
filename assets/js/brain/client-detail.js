/* ============================================================
   Brain — Individual client intelligence view
   ============================================================ */
const BrainClientDetail = (() => {
  let _activeTab = 'summary'

  async function render(clientId, user, container, onBack) {
    const main = container || document.getElementById('brain-main')
    if (!main) return
    main.innerHTML = '<p class="loading-text">Loading client intelligence…</p>'

    const [
      { data: client },
      { data: intelligence },
      { data: threads },
      { data: scores },
    ] = await Promise.all([
      Config.supabase.from('clients').select('id, client_name, client_domain, client_contacts').eq('id', clientId).single(),
      Config.supabase.from('brain_intelligence').select('*').eq('client_id', clientId).order('source_date', { ascending: false }),
      Config.supabase.from('brain_threads').select('id, subject, participants, first_date, last_date, snippet, data_class').eq('client_id', clientId).order('last_date', { ascending: false }).limit(50),
      Config.supabase.from('brain_health_scores').select('score, scored_at, signals').eq('client_id', clientId).order('scored_at', { ascending: false }).limit(30),
    ])

    if (!client) {
      main.innerHTML = '<p class="loading-text">Client not found.</p>'
      return
    }

    const currentScore = scores?.[0]?.score ?? null
    const scoreCls     = currentScore === null
      ? 'brain-health-ring--none'
      : currentScore >= 70
        ? 'brain-health-ring--good'
        : currentScore >= 40
          ? 'brain-health-ring--ok'
          : 'brain-health-ring--bad'

    const byCategory = {
      decision:      (intelligence || []).filter(i => i.category === 'decision'),
      preference:    (intelligence || []).filter(i => i.category === 'preference'),
      contact:       _dedupeContacts((intelligence || []).filter(i => i.category === 'contact')),
      open_item:     (intelligence || []).filter(i => i.category === 'open_item'),
      health_signal: (intelligence || []).filter(i => i.category === 'health_signal'),
    }

    main.innerHTML = `
      <div class="brain-detail-header">
        ${onBack
          ? `<button class="brain-back-btn" id="brain-back-btn">← All Clients</button>`
          : `<a href="/brain" class="brain-back-btn">← All Clients</a>`
        }
        <div class="brain-detail-title-row">
          <div>
            <h1 class="brain-page-title">${Utils.escapeHtml(client.client_name)}</h1>
            <p class="brain-subtitle">${Utils.escapeHtml(client.client_domain || client.client_contacts?.[0] || '')}</p>
          </div>
          <div class="brain-health-ring brain-health-ring--lg ${scoreCls}">
            ${currentScore !== null ? currentScore : '—'}
          </div>
        </div>
      </div>

      <div class="brain-detail-layout">
        <!-- Intelligence panel -->
        <div class="brain-intel-panel">
          <div class="brain-intel-tabs" id="brain-intel-tabs">
            ${['summary', 'decisions', 'preferences', 'contacts', 'open_items'].map(tab => `
              <button class="brain-intel-tab${tab === _activeTab ? ' brain-intel-tab--active' : ''}" data-tab="${tab}">
                ${_tabLabel(tab, byCategory)}
              </button>
            `).join('')}
          </div>
          <div class="brain-intel-body" id="brain-intel-body">
            ${_renderTab(_activeTab, byCategory, scores, threads)}
          </div>
        </div>

        <!-- Communication timeline -->
        <div class="brain-timeline-panel">
          <div class="brain-timeline-header">Communications</div>
          <div class="brain-timeline-body">
            ${(threads || []).length
              ? (threads || []).map(t => `
                  <div class="brain-thread-item">
                    <div class="brain-thread-date">${_formatDate(t.last_date)}</div>
                    <div class="brain-thread-subject">${Utils.escapeHtml(t.subject || '(no subject)')}</div>
                    <div class="brain-thread-participants">${_formatParticipants(t.participants)}</div>
                    ${t.snippet ? `<div class="brain-thread-snippet">${Utils.escapeHtml(t.snippet)}</div>` : ''}
                  </div>
                `).join('')
              : '<p class="brain-empty">No communications synced yet.</p>'
            }
          </div>
        </div>
      </div>
    `

    // Back button (integrated mode)
    if (onBack) {
      main.querySelector('#brain-back-btn')?.addEventListener('click', onBack)
    }

    // Tab switching
    main.querySelectorAll('.brain-intel-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        _activeTab = btn.dataset.tab
        main.querySelectorAll('.brain-intel-tab').forEach(b => b.classList.remove('brain-intel-tab--active'))
        btn.classList.add('brain-intel-tab--active')
        const body = document.getElementById('brain-intel-body')
        if (body) body.innerHTML = _renderTab(_activeTab, byCategory, scores, threads)
      })
    })
  }

  function _tabLabel(tab, byCategory) {
    const labels = {
      summary:     'Summary',
      decisions:   'Decisions',
      preferences: 'Preferences',
      contacts:    'Contacts',
      open_items:  'Open Items',
    }
    const counts = {
      decisions:   byCategory.decision.length,
      preferences: byCategory.preference.length,
      contacts:    byCategory.contact.length,
      open_items:  byCategory.open_item.length,
    }
    const count = counts[tab]
    return `${labels[tab]}${count ? ` <span class="brain-tab-count">${count}</span>` : ''}`
  }

  function _renderTab(tab, byCategory, scores, threads) {
    if (tab === 'summary')     return _renderSummary(byCategory, scores, threads)
    if (tab === 'decisions')   return _renderItems(byCategory.decision,   'No decisions recorded yet.')
    if (tab === 'preferences') return _renderItems(byCategory.preference, 'No preferences noted yet.')
    if (tab === 'contacts')    return _renderItems(byCategory.contact,    'No contacts extracted yet.')
    if (tab === 'open_items')  return _renderItems(byCategory.open_item,  'No open items — all clear.')
    return ''
  }

  function _renderSummary(byCategory, scores, threads) {
    const lastThread   = threads?.[0]
    const lastContact  = lastThread ? _formatDate(lastThread.last_date) : 'Never'
    const totalThreads = threads?.length || 0
    const openCount    = byCategory.open_item.length
    const currentScore = scores?.[0]?.score ?? null
    const prevScore    = scores?.[1]?.score ?? null
    const trend        = currentScore !== null && prevScore !== null ? currentScore - prevScore : null

    return `
      <div class="brain-summary-stats">
        <div class="brain-stat-pill">
          <span class="brain-stat-label">Last contact</span>
          <span class="brain-stat-val">${lastContact}</span>
        </div>
        <div class="brain-stat-pill">
          <span class="brain-stat-label">Threads synced</span>
          <span class="brain-stat-val">${totalThreads}</span>
        </div>
        <div class="brain-stat-pill">
          <span class="brain-stat-label">Open items</span>
          <span class="brain-stat-val${openCount > 0 ? ' brain-stat-val--warn' : ''}">${openCount}</span>
        </div>
        ${trend !== null ? `
          <div class="brain-stat-pill">
            <span class="brain-stat-label">Health trend</span>
            <span class="brain-stat-val${trend > 0 ? ' brain-stat-val--good' : trend < 0 ? ' brain-stat-val--bad' : ''}">
              ${trend > 0 ? '↑' : trend < 0 ? '↓' : '→'} ${Math.abs(trend)} pts
            </span>
          </div>
        ` : ''}
      </div>
      ${byCategory.open_item.length ? `
        <div class="brain-summary-section">
          <div class="brain-summary-section-title">Open Items</div>
          ${_renderItems(byCategory.open_item.slice(0, 3), '')}
        </div>
      ` : ''}
      ${byCategory.decision.length ? `
        <div class="brain-summary-section">
          <div class="brain-summary-section-title">Recent Decisions</div>
          ${_renderItems(byCategory.decision.slice(0, 3), '')}
        </div>
      ` : ''}
    `
  }

  function _dedupeContacts(contacts) {
    const seen = new Map()
    for (const c of contacts) {
      // content format: "Name — Role — email" or "Name — email"
      const emailMatch = c.content.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/)
      const key = emailMatch ? emailMatch[0].toLowerCase() : c.content.toLowerCase()
      const existing = seen.get(key)
      // keep the entry with the most recent source_date
      if (!existing || (c.source_date && (!existing.source_date || c.source_date > existing.source_date))) {
        seen.set(key, c)
      }
    }
    return Array.from(seen.values()).sort((a, b) =>
      (b.source_date ?? '').localeCompare(a.source_date ?? '')
    )
  }

  function _renderItems(items, emptyMsg) {
    if (!items.length) return emptyMsg ? `<p class="brain-empty">${emptyMsg}</p>` : ''
    return items.map(item => `
      <div class="brain-intel-item">
        <div class="brain-intel-content">${Utils.escapeHtml(item.content)}</div>
        <div class="brain-intel-meta">
          ${item.source_date ? `<span>${_formatDate(item.source_date)}</span>` : ''}
          ${item.verified
            ? '<span class="brain-verified">✓ Verified</span>'
            : '<span class="brain-ai-label">AI extracted</span>'
          }
        </div>
      </div>
    `).join('')
  }

  function _formatDate(dateStr) {
    if (!dateStr) return ''
    return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  function _formatParticipants(participants) {
    if (!participants?.length) return ''
    return participants.slice(0, 3).map(p => Utils.escapeHtml(p)).join(', ') +
      (participants.length > 3 ? ` +${participants.length - 3}` : '')
  }

  return { render }
})()
