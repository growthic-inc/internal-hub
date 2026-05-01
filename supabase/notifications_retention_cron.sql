-- ============================================================
-- Notifications: 30-day retention cron
-- Run once in Supabase SQL Editor to create the cron job.
-- Requires pg_cron extension (enabled by default on Supabase).
-- ============================================================

-- Enable pg_cron if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule: runs at 2am UTC every day
SELECT cron.schedule(
  'notifications-30d-cleanup',
  '0 2 * * *',
  $$
    DELETE FROM notifications
    WHERE created_at < now() - interval '30 days';
  $$
);

-- To verify the job was created:
-- SELECT * FROM cron.job WHERE jobname = 'notifications-30d-cleanup';

-- To remove the job later:
-- SELECT cron.unschedule('notifications-30d-cleanup');
