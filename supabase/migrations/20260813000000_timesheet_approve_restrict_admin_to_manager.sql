-- Timesheet approval (UPDATE) should require an actual manager relationship,
-- not just role = 'admin'. Visibility (SELECT) is unaffected — admins can
-- still see every timesheet; they just can no longer approve/edit ones for
-- people outside their own reporting chain. super_admin keeps full override.

DROP POLICY IF EXISTS "ts_update" ON timesheets;
CREATE POLICY "ts_update" ON timesheets
  FOR UPDATE USING (
    employee_id = (SELECT e.id FROM employees e WHERE e.email = auth.email())
    OR
    employee_id IN (
      SELECT s.id FROM get_all_subordinates(
        (SELECT e.id FROM employees e WHERE e.email = auth.email())
      ) s
    )
    OR
    (SELECT e.role FROM employees e WHERE e.email = auth.email()) = 'super_admin'
  );
