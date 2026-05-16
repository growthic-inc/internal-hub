/* ============================================================
   BRAIN — Client Intelligence (Growthic One integrated module)
   Registers with ModuleRegistry so Brain appears in the sidebar
   and renders inside the main app shell.
   ============================================================ */

const BrainPage = (() => {

  let _user = null

  const ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/></svg>`

  function render(user) {
    _user = user
    _showList()
  }

  function _container() {
    return document.getElementById('page-content')
  }

  function _showList() {
    BrainClients.render(_user, _container(), _showDetail)
  }

  function _showDetail(clientId) {
    BrainClientDetail.render(clientId, _user, _container(), _showList)
  }

  ModuleRegistry.register({
    key:       'brain',
    routeId:   'brain',
    label:     'Brain',
    icon:      ICON,
    order:     15,
    universal: true,
    getModule: () => ({ render }),
    features:  { view: 'View Brain' },
  })

  return { render }

})()
