-- ============================================================
-- Growthic One — Birthday reminder (one email, 7 days before)
--
-- 1. birthday_reminder_log: guarantees one reminder per person per year.
-- 2. pg_cron job: 10:30 AM IST (05:00 UTC) daily -> birthday-reminders function.
--
-- Before running: replace REPLACE_WITH_SECRET below with the same value you
-- set as BIRTHDAY_CRON_SECRET on the function. Do not commit the real value.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS public.birthday_reminder_log (
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  year        INT  NOT NULL,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (employee_id, year)
);

-- Only the edge function (service role) touches this table.
ALTER TABLE public.birthday_reminder_log ENABLE ROW LEVEL SECURITY;

SELECT cron.unschedule('birthday-reminders') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'birthday-reminders'
);

SELECT cron.schedule(
  'birthday-reminders',
  '0 5 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://sagqqcctagolalfrezwg.supabase.co/functions/v1/birthday-reminders',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "REPLACE_WITH_SECRET"}'::jsonb,
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);
