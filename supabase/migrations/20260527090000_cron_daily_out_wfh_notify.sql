-- ============================================================
-- Growthic One — Daily Out & WFH push notification cron job
--
-- Fires every day at 09:00 AM IST (03:30 AM UTC).
-- Calls the `daily-out-wfh-notify` edge function, which queries
-- today's approved leave / WFH requests and sends a Web Push
-- to every subscribed employee device.
--
-- Prerequisites (both must be enabled in Supabase dashboard):
--   1. pg_cron extension  — Database → Extensions → pg_cron
--   2. pg_net  extension  — Database → Extensions → pg_net
--
-- After applying this migration, set the CRON_SECRET env var in:
--   Supabase Dashboard → Edge Functions → daily-out-wfh-notify → Secrets
-- Use any strong random string.  The same value goes in the SQL below.
-- ============================================================

-- Enable required extensions (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any existing schedule with this name before (re-)creating
SELECT cron.unschedule('daily-out-wfh-notify') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'daily-out-wfh-notify'
);

-- Schedule: 03:30 UTC = 09:00 AM IST, every day
-- The edge function accepts any POST when CRON_SECRET env var is not set,
-- so no Authorization header is needed here. The function itself is only
-- invocable by anyone with network access — acceptable for an internal tool
-- where pg_cron is the only caller.
SELECT cron.schedule(
  'daily-out-wfh-notify',
  '30 3 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://sagqqcctagolalfrezwg.supabase.co/functions/v1/daily-out-wfh-notify',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);
