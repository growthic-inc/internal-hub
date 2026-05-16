/* ============================================================
   Brain — Client list with health scores
   ============================================================ */
const BrainClients = (() => {

  async function render(user, container, onNavigate) {
    const main = container || document.getElementById('brain-main')
    if (!main) return
    main.innerHTML = '<p class="loading-text">Loading clients…</p>'

    // Fetch clients + their brain data in parallel
    const [
      { data: clients },
      { data: healthScores },
      { data: lastThreads },
      { data: openItems },
    ] = await Promise.all([
      Config.supabase.from('clients').select('id, client_name, client_domain, client_contacts').order('client_name'),
      Config.supabase.from('brain_health_scores').select('client_id, score, scored_at').order('scored_at', { ascending: false }),
      Config.supabase.from('brain_threads').select('client_id, last_date').order('last_date', { ascending: false }),
      Config.supabase.from('brain_intelligence').select('client_id').eq('category', 'open_item'),
    ])

    // Build lookup maps (first entry wins — already sorted desc)
    const latestScore  = {}
    const latestThread = {}
    const openCount    = {}

    ;(healthScores || []).forEach(h => { if (!latestScore[h.client_id])  latestScore[h.client_id] = h.score })
    ;(lastThreads  || []).forEach(t => { if (!latestThread[t.client_id]) latestThread[t.client_id] = t.last_date })
    ;(openItems    || []).forEach(o => { openCount[o.client_id] = (openCount[o.client_id] || 0) + 1 })

    const connected   = (clients || []).filter(c => c.client_domain || c.client_contacts?.length)
    const unconnected = (clients || []).filter(c => !c.client_domain && !c.client_contacts?.length)

    const totalClients = (clients || []).length

    main.innerHTML = `
      <div class="brain-page-header">
        <h1 class="brain-page-title">Client Intelligence</h1>
        <p class="brain-subtitle">
          ${connected.length} of ${totalClients} client${totalClients !== 1 ? 's' : ''} connected
          <span style="width:3px;height:3px;border-radius:50%;background:var(--border);display:inline-block;"></span>
          syncs daily
        </p>
      </div>

      ${connected.length ? `
        <div class="brain-section-label">
          Connected <span class="brain-section-count">${connected.length}</span>
        </div>
        <div class="brain-clients-grid">
          ${connected.map(c => _clientCard(c, latestScore[c.id], latestThread[c.id], openCount[c.id] || 0)).join('')}
        </div>
      ` : ''}

      ${unconnected.length ? `
        <div class="brain-section-label">
          Not connected <span class="brain-section-count">${unconnected.length}</span>
        </div>
        <p class="brain-setup-hint">
          To enable Brain for a client, open Growthic One → Client Directory → Edit Client → add their <strong>domain</strong> (e.g. client.com) or specific <strong>contact emails</strong>.
        </p>
        <div class="brain-clients-grid brain-clients-grid--dim">
          ${unconnected.map(c => _clientCard(c, null, null, 0, true)).join('')}
        </div>
      ` : ''}
    `

    main.querySelectorAll('.brain-client-card[data-id]').forEach(card => {
      card.addEventListener('click', () => {
        if (onNavigate) onNavigate(card.dataset.id)
        else window.location.href = `/brain?client=${card.dataset.id}`
      })
    })
  }

  function _clientCard(client, score, lastDate, openCount, dim = false) {
    const hasScore  = score !== null && score !== undefined
    const scoreCls  = !hasScore ? 'brain-health-ring--none'
      : score >= 70 ? 'brain-health-ring--good'
      : score >= 40 ? 'brain-health-ring--ok'
      : 'brain-health-ring--bad'

    const domainLine = client.client_domain
      || client.client_contacts?.[0]
      || (dim ? 'Not connected' : '')
    const lastContact = lastDate ? _relativeDate(new Date(lastDate)) : null

    const chevron = `<svg class="brain-card-arrow" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`

    return `
      <div class="brain-client-card${dim ? ' brain-client-card--dim' : ''}" data-id="${client.id}">
        <div class="brain-card-top">
          <div class="brain-health-ring ${scoreCls}">
            ${hasScore ? score : '—'}
          </div>
          <div class="brain-card-info">
            <div class="brain-client-name">${Utils.escapeHtml(client.client_name)}</div>
            ${domainLine ? `<div class="brain-client-domain">${Utils.escapeHtml(domainLine)}</div>` : ''}
          </div>
          ${!dim ? chevron : ''}
        </div>
        <div class="brain-card-footer">
          <span>${lastContact ? `Last contact: ${lastContact}` : '<em>No data yet</em>'}</span>
          ${openCount ? `<span class="brain-open-badge">${openCount} open</span>` : ''}
        </div>
      </div>
    `
  }

  function _relativeDate(date) {
    const days = Math.floor((Date.now() - date.getTime()) / 86400000)
    if (days === 0) return 'Today'
    if (days === 1) return 'Yesterday'
    if (days < 7)  return `${days} days ago`
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`
    return date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })
  }

  return { render }
})()
