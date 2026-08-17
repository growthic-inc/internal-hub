/* ============================================================
   Growthic Platform — Platform Manifest
   Single source of truth for all applications on the platform.
   Loaded by every app shell so each app knows its siblings.
   ============================================================ */

const PlatformConfig = (() => {

  const APPS = [
    {
      id:          'growthic-one',
      name:        'Growthic One',
      shortName:   'One',
      description: 'Internal operations hub — timesheets, leaves, reimbursements, client data.',
      category:    'core',
      path:        '/home',
      // Access rule: any authenticated employee
      access: (user) => !!user,
    },
    {
      id:          'growthic-hrms',
      name:        'Growthic HRMS',
      shortName:   'HRMS',
      description: 'HR & admin portal — payroll, employee records, compliance.',
      category:    'admin',
      path:        '/hrms',
      // Access rule: super_admin always bypasses; everyone else needs an
      // explicit Portal Access grant (see Access Control → Portal Access).
      access: (user) => user.role === 'super_admin' ||
        (user.portalAccess || []).includes('growthic-hrms'),
    },
    {
      id:          'knowledgelabs',
      name:        'Knowledge Labs',
      shortName:   'Labs',
      description: 'Department SOPs, templates, and guidelines.',
      category:    'core',
      path:        '/knowledgelabs',
      // Access rule: any authenticated employee — visibility of individual
      // resources is handled by RLS (own department + explicit grants),
      // not by a portal-level gate.
      access: (user) => !!user,
    },
  ]

  function getAll() {
    return APPS
  }

  // Returns only the apps this user can access — drives the App Switcher UI
  function getAccessible(user) {
    if (!user) return []
    return APPS.filter(app => {
      try { return app.access(user) } catch (_) { return false }
    })
  }

  function getById(id) {
    return APPS.find(app => app.id === id) || null
  }

  return { getAll, getAccessible, getById }
})()
