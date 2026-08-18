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
      icon:        `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
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
      icon:        `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`,
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
      icon:        `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v6l-6 10a2 2 0 0 0 2 3h14a2 2 0 0 0 2-3l-6-10V2"/><line x1="9" y1="2" x2="15" y2="2"/></svg>`,
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
