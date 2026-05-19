-- Fix: Allow all active employees to read APPROVED leave/WFH requests
--
-- Previously lr_select / wfh_select only exposed rows to:
--   • the employee themselves
--   • their approver
--   • super_admin / people_culture department
--
-- This blocked the "Out & WFH Today" home-screen widget for everyone
-- except HR and managers, because getWhoIsOutToday() / getWhoIsWfhToday()
-- queries approved requests for all employees.
--
-- Fix: add a branch that lets any active employee read approved rows
-- (the status = 'approved' guard ensures pending/rejected stay private).

-- ── leave_requests ───────────────────────────────────────────
DROP POLICY IF EXISTS lr_select ON leave_requests;
CREATE POLICY lr_select ON leave_requests FOR SELECT
  USING (
    -- Employee sees their own requests (any status)
    employee_id = (SELECT id FROM employees WHERE email = (auth.jwt() ->> 'email'))
    -- Approver sees requests assigned to them (any status)
    OR approver_id = (SELECT id FROM employees WHERE email = (auth.jwt() ->> 'email'))
    -- Any active employee can see APPROVED requests (powers the "Out Today" widget)
    OR (
      status = 'approved'
      AND auth.uid() IN (SELECT id FROM employees WHERE status = 'active')
    )
    -- HR / super_admin see everything
    OR EXISTS (
      SELECT 1 FROM employees
      WHERE email = (auth.jwt() ->> 'email')
        AND (role = 'super_admin' OR department = 'people_culture')
    )
  );

-- ── wfh_requests ─────────────────────────────────────────────
DROP POLICY IF EXISTS wfh_select ON wfh_requests;
CREATE POLICY wfh_select ON wfh_requests FOR SELECT
  USING (
    employee_id = (SELECT id FROM employees WHERE email = (auth.jwt() ->> 'email'))
    OR approver_id = (SELECT id FROM employees WHERE email = (auth.jwt() ->> 'email'))
    OR (
      status = 'approved'
      AND auth.uid() IN (SELECT id FROM employees WHERE status = 'active')
    )
    OR EXISTS (
      SELECT 1 FROM employees
      WHERE email = (auth.jwt() ->> 'email')
        AND (role = 'super_admin' OR department = 'people_culture')
    )
  );
