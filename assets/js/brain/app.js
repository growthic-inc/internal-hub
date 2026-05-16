/* ============================================================
   Brain — App shell and router
   ============================================================ */
const BrainApp = (() => {
  let _user = null

  async function init() {
    const session = await Auth.requireAuth()
    if (!session) return

    _user = await Auth.getCurrentUser()
    if (!_user) { window.location.href = '/'; return }

    _renderHeader()
    _setupSync()
    _route()
  }

  function _renderHeader() {
    const chip = document.getElementById('brain-user-chip')
    if (!chip) return
    chip.innerHTML = _user.profile_image_url
      ? `<img src="${Utils.escapeHtml(_user.profile_image_url)}" alt="" class="brain-user-avatar">`
      : `<div class="brain-user-avatar brain-user-avatar--initials">${Utils.getInitials(_user.name)}</div>`
  }

  function _route() {
    const params   = new URLSearchParams(window.location.search)
    const clientId = params.get('client')
    if (clientId) BrainClientDetail.render(clientId, _user)
    else          BrainClients.render(_user)
  }

  function _showStatus(msg, type = 'info') {
    const bar = document.getElementById('brain-status-bar')
    if (!bar) return
    bar.textContent = msg
    bar.className   = `brain-status-bar brain-status-bar--${type}`
    bar.style.display = 'flex'
    setTimeout(() => { bar.style.display = 'none' }, 6000)
  }

  function _setupSync() {
    const btn = document.getElementById('brain-sync-btn')
    if (!btn) return
    btn.addEventListener('click', async () => {
      btn.disabled = true
      btn.classList.add('brain-sync-btn--syncing')
      _showStatus('Syncing Gmail…', 'info')

      try {
        const { data: { session } } = await Config.supabase.auth.getSession()
        const resp = await fetch(`${Config.SUPABASE_URL}/functions/v1/brain-sync`, {
          method:  'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'apikey':         Config.SUPABASE_ANON_KEY,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({ employee_id: _user.id }),
        })
        const result = await resp.json()
        if (result.error) {
          _showStatus(`Sync failed: ${result.error}`, 'error')
        } else {
          _showStatus(`Synced ${result.synced} thread${result.synced !== 1 ? 's' : ''} · ${result.matched} matched to clients`, 'success')
          BrainClients.render(_user)
        }
      } catch {
        _showStatus('Sync failed — check your connection', 'error')
      } finally {
        btn.disabled = false
        btn.classList.remove('brain-sync-btn--syncing')
      }
    })
  }

  return { init }
})()

BrainApp.init()
