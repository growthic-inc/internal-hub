/* ============================================================
   GROWTHIC ONE — Authentication
   Handles sign-in, sign-out, session guard, and user profile fetch.
   ============================================================ */

const Auth = (() => {
  const { supabase } = Config

  /* ── Sign in ──────────────────────────────────────────────── */
  async function signIn(email, password) {
    return supabase.auth.signInWithPassword({ email, password })
  }

  /* ── Sign out ─────────────────────────────────────────────── */
  async function signOut() {
    return supabase.auth.signOut()
  }

  /* ── Get current session ──────────────────────────────────── */
  async function getSession() {
    const { data: { session } } = await supabase.auth.getSession()
    return session
  }

  /* ── Session guard (use on app.html) ─────────────────────── */
  /* Redirects to login if no active session. Returns session if valid. */
  async function requireAuth() {
    const session = await getSession()
    if (!session) {
      window.location.href = 'index.html'
      return null
    }
    return session
  }

  /* ── Guest guard (use on index.html) ─────────────────────── */
  /* Redirects to app if already logged in. */
  async function requireGuest() {
    const session = await getSession()
    if (session) {
      window.location.href = 'app.html'
    }
  }

  /* ── Get full user profile from employees table ───────────── */
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
      window.location.href = 'index.html?reason=deactivated'
      return null
    }

    return { ...data, authId: session.user.id }
  }

  return { signIn, signOut, getSession, requireAuth, requireGuest, getCurrentUser }
})()
