-- Fix #12: self-approval RLS uses <> which evaluates to NULL (not FALSE)
-- when the subquery returns no row, potentially blocking HR approvals.
-- IS DISTINCT FROM correctly treats NULL comparisons (NULL IS DISTINCT FROM NULL = false).

DROP POLICY IF EXISTS "lr_update" ON leave_requests;
CREATE POLICY "lr_update" ON leave_requests
  FOR UPDATE USING (
    (employee_id = (SELECT id FROM employees WHERE email = (auth.jwt() ->> 'email')))
    OR (approver_id = (SELECT id FROM employees WHERE email = (auth.jwt() ->> 'email')))
    OR (
      EXISTS (
        SELECT 1 FROM employees
        WHERE email = (auth.jwt() ->> 'email')
          AND (role = 'super_admin' OR department = 'people_culture')
      )
      AND employee_id IS DISTINCT FROM (SELECT id FROM employees WHERE email = (auth.jwt() ->> 'email'))
    )
  );

DROP POLICY IF EXISTS "wfh_update" ON wfh_requests;
CREATE POLICY "wfh_update" ON wfh_requests
  FOR UPDATE USING (
    (employee_id = (SELECT id FROM employees WHERE email = (auth.jwt() ->> 'email')))
    OR (approver_id = (SELECT id FROM employees WHERE email = (auth.jwt() ->> 'email')))
    OR (
      EXISTS (
        SELECT 1 FROM employees
        WHERE email = (auth.jwt() ->> 'email')
          AND (role = 'super_admin' OR department = 'people_culture')
      )
      AND employee_id IS DISTINCT FROM (SELECT id FROM employees WHERE email = (auth.jwt() ->> 'email'))
    )
  );

DROP POLICY IF EXISTS "cv_update" ON client_visit_requests;
CREATE POLICY "cv_update" ON client_visit_requests
  FOR UPDATE USING (
    (employee_id = (SELECT id FROM employees WHERE email = (auth.jwt() ->> 'email')))
    OR (approver_id = (SELECT id FROM employees WHERE email = (auth.jwt() ->> 'email')))
    OR (
      EXISTS (
        SELECT 1 FROM employees
        WHERE email = (auth.jwt() ->> 'email')
          AND (role IN ('super_admin', 'admin') OR department = 'people_culture')
      )
      AND employee_id IS DISTINCT FROM (SELECT id FROM employees WHERE email = (auth.jwt() ->> 'email'))
    )
  );
