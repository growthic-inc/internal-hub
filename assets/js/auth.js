/* ============================================================
   GROWTHIC ONE — Authentication
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
  async function requireGuest() {
    const session = await getSession()
    if (session) {
      window.location.href = '/home'
    }
  }

  async function getCurrentUser() {
    const session = await getSession()
    if (!session) return null

    const { data, error } = await supabase
      .from('employees')
      .select('id, name, email, role, department, status')
      .eq('email', session.user.email)
      .single()

    if (error || !data) {
      console.error('[Auth] Could not fetch employee record:', error?.message)
      return null
    }

    if (data.status === 'inactive') {
      await signOut()
      window.location.href = '/?reason=deactivated'
      return null
    }

    return { ...data, authId: session.user.id }
  }

  return { signIn, signOut, getSession, requireAuth, requireGuest, getCurrentUser }
})()
