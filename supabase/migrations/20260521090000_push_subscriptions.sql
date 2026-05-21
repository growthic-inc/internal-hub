-- Web Push subscription store
-- Each row is one browser/device subscription for an employee.
-- Multiple rows per employee are normal (phone + laptop + multiple browsers).
-- Stale subscriptions (push server returns 410/404) are deleted by send-push.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  endpoint    text NOT NULL,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, endpoint)
);

-- Employees can only read/write their own subscriptions.
-- send-push edge function uses the service role key so it bypasses RLS.
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY push_subs_self ON push_subscriptions
  USING  (employee_id = auth.uid())
  WITH CHECK (employee_id = auth.uid());
