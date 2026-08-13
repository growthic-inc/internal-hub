-- lr_update / wfh_update / cv_update let super_admin (and, via
-- _is_dept_admin(), plain 'admin' too on client visits) approve ANY
-- request via a blanket role/department check — with no exclusion for
-- their own request. In practice this meant Super Admin (who has no
-- manager, so his own requests get approver_id = null and land in the
-- general HR queue) could approve his own leave/WFH/client-visit
-- himself, same for any HR employee. Add employee_id <> self to each
-- blanket clause so the requester is never the one approving their own
-- request through this path — someone else (their real approver, or
-- HR/Super Admin acting on someone else's request) has to.

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
      AND employee_id <> (SELECT id FROM employees WHERE email = (auth.jwt() ->> 'email'))
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
      AND employee_id <> (SELECT id FROM employees WHERE email = (auth.jwt() ->> 'email'))
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
      AND employee_id <> (SELECT id FROM employees WHERE email = (auth.jwt() ->> 'email'))
    )
  );
