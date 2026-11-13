-- ============================================================
-- Growthic One — Email everyone when HR schedules a company event
--
-- 0. company_events.notify_email: set to true by the app only when HR answers
--    "Yes, email everyone" in the popup shown before a NEW event is saved.
--    Defaults to false, so every existing event (and any event saved without
--    that answer) never sends an email.
-- 1. event_email_log: guarantees one announcement per event.
-- 2. Trigger on company_events (AFTER INSERT, only when notify_email is true):
--    calls the `event-announcements` edge function with the new event's id.
--    The trigger never blocks saving the event: any failure only
--    raises a warning.
--
-- The function itself skips events that already ended and emails
-- every active employee (own copy, greeted by first name).
--
-- Before running: replace REPLACE_WITH_SECRET below with the same value you
-- set as EVENT_WEBHOOK_SECRET on the function. Do not commit the real value.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_net;

-- Existing rows get false, so nothing already scheduled is ever emailed.
ALTER TABLE public.company_events
  ADD COLUMN IF NOT EXISTS notify_email BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.event_email_log (
  event_id   UUID PRIMARY KEY REFERENCES public.company_events(id) ON DELETE CASCADE,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recipients INT
);

-- Only the edge function (service role) touches this table.
ALTER TABLE public.event_email_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.notify_new_company_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM net.http_post(
      url     := 'https://sagqqcctagolalfrezwg.supabase.co/functions/v1/event-announcements',
      headers := jsonb_build_object(
                   'Content-Type',     'application/json',
                   'x-webhook-secret', 'REPLACE_WITH_SECRET'
                 ),
      body    := jsonb_build_object('event_id', NEW.id)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'event announcement email not queued: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_events_announce ON public.company_events;
CREATE TRIGGER company_events_announce
  AFTER INSERT ON public.company_events
  FOR EACH ROW
  WHEN (NEW.notify_email IS TRUE)
  EXECUTE FUNCTION public.notify_new_company_event();
