-- HR (people_culture dept) and admins could not insert leave_requests on
-- behalf of another employee — the INSERT policy only allowed self-inserts.
-- UPDATE already permitted _is_dept_admin(); this brings INSERT in line.

DROP POLICY IF EXISTS "lr_insert" ON leave_requests;
CREATE POLICY "lr_insert" ON leave_requests
  FOR INSERT WITH CHECK (
    employee_id = (SELECT id FROM employees WHERE email = (auth.jwt() ->> 'email'))
    OR _is_dept_admin()
  );
