-- Remove the daily Out & WFH push-notification cron job.
-- Safe to run even if the job was never scheduled (condition guards the call).
SELECT cron.unschedule('daily-out-wfh-notify')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'daily-out-wfh-notify'
);
