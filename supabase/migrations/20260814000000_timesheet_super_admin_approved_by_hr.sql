-- ts_update let super_admin approve ANY timesheet including their own
-- (no self-exclusion). Closing that the same way as the emp_update/
-- leave_requests fixes: super_admin can no longer approve their own
-- timesheet. Scoped narrowly per instruction — rather than a general
-- "no manager assigned" fallback, HR (people_culture) is specifically
-- granted approval rights over timesheets belonging to super_admin
-- employees only, not a blanket override for everyone.

DROP POLICY IF EXISTS "ts_update" ON timesheets;
CREATE POLICY "ts_update" ON timesheets
  FOR UPDATE USING (
    employee_id = (SELECT e.id FROM employees e WHERE e.email = auth.email())
    OR employee_id IN (
      SELECT s.id FROM get_all_subordinates(
        (SELECT e.id FROM employees e WHERE e.email = auth.email())
      ) s
    )
    OR (
      (SELECT e.role FROM employees e WHERE e.email = auth.email()) = 'super_admin'
      AND employee_id <> (SELECT e.id FROM employees e WHERE e.email = auth.email())
    )
    OR (
      (SELECT e.department FROM employees e WHERE e.email = auth.email()) = 'people_culture'
      AND EXISTS (
        SELECT 1 FROM employees target
        WHERE target.id = timesheets.employee_id AND target.role = 'super_admin'
      )
    )
  );
