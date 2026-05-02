/* ============================================================
   MODULE REGISTRY
   Single source of truth for all routable, access-gated modules.

   Each page file calls ModuleRegistry.register({...}) at the
   bottom of its file. The access control panel and app router
   both read from this registry — so adding a new module only
   requires a single registration call in the page file.

   Registration shape:
   {
     key:       string  — access_matrix module key (e.g. 'timesheet')
     routeId:   string  — hash route id (e.g. 'timesheet')
     label:     string  — human-readable name
     icon:      string  — SVG string (16×16)
     order:     number  — sidebar display order (lower = higher up)
     getModule: fn      — returns the page module object (render/init)
     features:  object  — { featureKey: 'Feature Label', ... }
   }

   New module defaults to no_access for all departments until
   an admin explicitly configures it in the Access Control panel.
   ============================================================ */

;(function (global) {
  const _modules = []

  function register(config) {
    const idx = _modules.findIndex(m => m.key === config.key)
    if (idx >= 0) _modules[idx] = config
    else _modules.push(config)
    _modules.sort((a, b) => (a.order || 99) - (b.order || 99))
  }

  function getAll()              { return [..._modules] }
  function getByKey(key)         { return _modules.find(m => m.key     === key)     || null }
  function getByRouteId(routeId) { return _modules.find(m => m.routeId === routeId) || null }

  global.ModuleRegistry = { register, getAll, getByKey, getByRouteId }
})(window)
