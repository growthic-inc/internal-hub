-- #3: Replace cancellation_dates date[] array with a dedicated table.
-- Each cancelled date is its own row — easier to query, audit, and navigate.
-- The existing date[] columns are kept for now (backward-compatible) and will
-- be ignored by new code in favour of this table.

CREATE TABLE IF NOT EXISTS leave_cancellation_dates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type      text NOT NULL CHECK (request_type IN ('leave', 'wfh')),
  request_id        uuid NOT NULL,
  cancelled_date    date NOT NULL,
  cancelled_by      uuid REFERENCES employees(id),
  cancellation_reason text,
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (request_type, request_id, cancelled_date)
);

-- Index for fast lookup by request
CREATE INDEX IF NOT EXISTS idx_lcd_request ON leave_cancellation_dates (request_type, request_id);
-- Index for lookup by employee (via request_id join) — skipped; join covers it.

-- RLS: employees can read their own; HR and approvers can read all; inserts via app
ALTER TABLE leave_cancellation_dates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lcd_select" ON leave_cancellation_dates FOR SELECT
  USING (
    -- HR can see all
    EXISTS (SELECT 1 FROM employees WHERE email = (auth.jwt() ->> 'email') AND department = 'people_culture')
    OR
    -- Anyone can see cancellations for their own requests (leave or wfh)
    EXISTS (
      SELECT 1 FROM leave_requests lr
      WHERE lr.id = leave_cancellation_dates.request_id
        AND request_type = 'leave'
        AND lr.employee_id = (SELECT id FROM employees WHERE email = (auth.jwt() ->> 'email'))
    )
    OR
    EXISTS (
      SELECT 1 FROM wfh_requests wr
      WHERE wr.id = leave_cancellation_dates.request_id
        AND request_type = 'wfh'
        AND wr.employee_id = (SELECT id FROM employees WHERE email = (auth.jwt() ->> 'email'))
    )
  );

CREATE POLICY "lcd_insert" ON leave_cancellation_dates FOR INSERT
  WITH CHECK (
    -- Employee can insert cancellations for their own pending requests
    EXISTS (
      SELECT 1 FROM leave_requests lr
      WHERE lr.id = leave_cancellation_dates.request_id
        AND request_type = 'leave'
        AND lr.employee_id = (SELECT id FROM employees WHERE email = (auth.jwt() ->> 'email'))
        AND lr.status = 'pending'
    )
    OR
    EXISTS (
      SELECT 1 FROM wfh_requests wr
      WHERE wr.id = leave_cancellation_dates.request_id
        AND request_type = 'wfh'
        AND wr.employee_id = (SELECT id FROM employees WHERE email = (auth.jwt() ->> 'email'))
        AND wr.status = 'pending'
    )
    OR
    -- HR can insert for any request (approved cancellations)
    EXISTS (SELECT 1 FROM employees WHERE email = (auth.jwt() ->> 'email') AND department = 'people_culture')
  );

CREATE POLICY "lcd_delete" ON leave_cancellation_dates FOR DELETE
  USING (
    -- Employee can remove (undo) their own pending cancellation requests
    EXISTS (
      SELECT 1 FROM leave_requests lr
      WHERE lr.id = leave_cancellation_dates.request_id
        AND request_type = 'leave'
        AND lr.employee_id = (SELECT id FROM employees WHERE email = (auth.jwt() ->> 'email'))
        AND lr.status IN ('pending', 'cancellation_pending')
    )
    OR
    EXISTS (
      SELECT 1 FROM wfh_requests wr
      WHERE wr.id = leave_cancellation_dates.request_id
        AND request_type = 'wfh'
        AND wr.employee_id = (SELECT id FROM employees WHERE email = (auth.jwt() ->> 'email'))
        AND wr.status IN ('pending', 'cancellation_pending')
    )
    OR
    -- HR can delete (when denying a cancellation request)
    EXISTS (SELECT 1 FROM employees WHERE email = (auth.jwt() ->> 'email') AND department = 'people_culture')
  );
