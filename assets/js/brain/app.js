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
    _route()
  }

  function _renderHeader() {
    const chip = document.getElementById('brain-user-chip')
    if (!chip) return
    chip.innerHTML = _user.profile_image_url
      ? `<img src="${Utils.escapeHtml(_user.profile_image_url)}" alt="" class="brain-user-avatar">`
      : `<span class="brain-user-avatar brain-user-avatar--initials">${Utils.getInitials(_user.name)}</span>`
  }

  function _route() {
    const params   = new URLSearchParams(window.location.search)
    const clientId = params.get('client')
    if (clientId) {
      BrainClientDetail.render(clientId, _user)
    } else {
      BrainClients.render(_user)
    }
  }

  return { init }
})()

BrainApp.init()
