-- att_update allowed ANY authenticated user to update ANY employee's
-- attendance record (USING/WITH CHECK were just "auth.uid() IS NOT NULL",
-- no ownership or role check at all). Restrict to the same pattern already
-- correctly used by leave_types/leave_credits/wfh_quotas/company_holidays
-- in this module: self, super_admin, or people_culture department.

DROP POLICY IF EXISTS "att_update" ON employee_attendance;
CREATE POLICY "att_update" ON employee_attendance
  FOR UPDATE USING (
    employee_id = (SELECT id FROM employees WHERE email = auth.email())
    OR EXISTS (
      SELECT 1 FROM employees
      WHERE email = auth.email()
        AND (role = 'super_admin' OR department = 'people_culture')
    )
  )
  WITH CHECK (
    employee_id = (SELECT id FROM employees WHERE email = auth.email())
    OR EXISTS (
      SELECT 1 FROM employees
      WHERE email = auth.email()
        AND (role = 'super_admin' OR department = 'people_culture')
    )
  );
