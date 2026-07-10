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
      // Access rule: super_admin or People & Culture department
      access: (user) => user.role === 'super_admin' ||
        Utils.getDeptSystemKey(user.department) === 'people_culture',
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
