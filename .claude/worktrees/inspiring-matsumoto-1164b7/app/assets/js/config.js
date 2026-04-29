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
  const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY'

  if (SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY') {
    console.warn('[Growthic One] Supabase anon key not set. Open assets/js/config.js and add your key.')
  }

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

  return {
    supabase,
    SUPABASE_URL,
    APP_NAME: 'Growthic One',
    VERSION: '0.1.0',
  }
})()
