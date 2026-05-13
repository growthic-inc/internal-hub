/* ============================================================
   GROWTHIC ONE — Supabase Configuration
   ============================================================
   SETUP INSTRUCTIONS:
   1. Go to supabase.com and open your project
   2. Navigate to: Project Settings → API
   3. Under "Project API keys", copy the "anon public" key
   4. Paste it below as SUPABASE_ANON_KEY
   ============================================================ */

const Config = (() => {
  const SUPABASE_URL     = 'https://sagqqcctagolalfrezwg.supabase.co'
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhZ3FxY2N0YWdvbGFsZnJlendnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NTExNjIsImV4cCI6MjA5MjMyNzE2Mn0.I6Z_XsCB9kB9XRn8ux4uP4hXQsq_WoMf9wd33vPkdFM'

  if (SUPABASE_ANON_KEY === 'YOUR_SUPABASE_KEY') {
    console.warn('[Growthic One] Supabase anon key not set. Open assets/js/config.js and add your key.')
  }

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

  // ClickUp OAuth — CLIENT_ID is public (safe in frontend).
  // Set this to the Client ID from your ClickUp OAuth app
  // (ClickUp Settings → Apps → your OAuth app → Client ID).
  // The Client Secret stays in Supabase as CLICKUP_CLIENT_SECRET_ID.
  const CLICKUP_CLIENT_ID = ''   // ← paste your ClickUp OAuth Client ID here

  return {
    supabase,
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    APP_NAME: 'Growthic One',
    VERSION: '0.1.0',
    CLICKUP_CLIENT_ID,
  }
})()
