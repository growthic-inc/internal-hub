/* ============================================================
   Growthic Platform — Authentication
   ============================================================ */

const Auth = (() => {
  const { supabase } = Config

  async function signIn(email, password) {
    return supabase.auth.signInWithPassword({ email, password })
  }

  async function signOut() {
    return supabase.auth.signOut()
  }

  async function getSession() {
    const { data: { session } } = await supabase.auth.getSession()
    return session
  }

  /* Called from app/home/index.html — redirects to login */
  async function requireAuth() {
    const session = await getSession()
    if (!session) {
      window.location.href = '/'
      return null
    }
    return session
  }

  /* Called from app/index.html — redirects to app shell if already signed in */
  async function requireGuest(redirectTo = '/home') {
    const session = await getSession()
    if (session) {
      window.location.href = redirectTo
    }
  }

  async function getCurrentUser() {
    const session = await getSession()
    if (!session) return null

    // Use eq + limit(1) instead of .single() so duplicate employee rows
    // (caused by HR submitting the add-employee form more than once) don't
    // produce a 406 "Cannot coerce to single JSON object" error and log the
    // user out. The row whose id matches auth.uid() is preferred; if not
    // found first, we fall back to whichever row the DB returns.
    // ilike = case-insensitive match. Supabase Auth lowercases all emails
    // (e.g. "Ananya@company.com" → "ananya@company.com"), but HR may have
    // entered the email with capitals in the employees table. A plain .eq()
    // is case-sensitive in PostgreSQL, so it returns 0 rows → 406 error.
    const { data: rows, error } = await supabase
      .from('employees')
      .select('id, name, email, role, department, department_id, status, manager_id, profile_completed, profile_image_url, joining_date, date_of_birth, policy_acknowledged_at')
      .ilike('email', session.user.email)
      .order('id', { ascending: true })
      .limit(1)

    const data = rows?.[0] ?? null

    if (error || !data) {
      console.error('[Auth] Could not fetch employee record:', error?.message)
      return null
    }

    if (data.status === 'inactive') {
      await signOut()
      window.location.href = '/?reason=deactivated'
      return null
    }

    if (window.Sentry) Sentry.setUser({ id: String(data.id), email: data.email, username: data.name })

    // Portal Access — which departmental portals (HRMS, and future ones)
    // this employee has been explicitly granted, independent of department.
    const { data: grants } = await supabase
      .from('portal_access')
      .select('portal_id')
      .eq('employee_id', data.id)
    data.portalAccess = (grants || []).map(g => g.portal_id)

    return { ...data, authId: session.user.id }
  }

  return { signIn, signOut, getSession, requireAuth, requireGuest, getCurrentUser }
})()
