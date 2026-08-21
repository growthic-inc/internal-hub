-- Admins (role='admin') already see every employee's timesheet (via
-- is_admin() in ts_select), but could previously only *approve* entries
-- belonging to their own reporting chain — the broad approval reach given
-- to super_admin was never extended to them. Adds that reach, with the
-- one carve-out requested: admins can approve anyone's timesheet except
-- their own, and except super_admin's (People & Culture already handles
-- approving super_admin's timesheet via the existing branch below, since
-- super_admin has no manager of their own to route through).

DROP POLICY IF EXISTS "ts_update" ON timesheets;
CREATE POLICY "ts_update" ON timesheets
  FOR UPDATE USING (
    (employee_id = (SELECT e.id FROM employees e WHERE e.email = auth.email()))
    OR (employee_id IN (
      SELECT s.id FROM get_all_subordinates(
        (SELECT e.id FROM employees e WHERE e.email = auth.email())
      ) AS s(id, name, department, profile_image_url)
    ))
    OR (
      (SELECT e.role FROM employees e WHERE e.email = auth.email()) = 'super_admin'
      AND employee_id <> (SELECT e.id FROM employees e WHERE e.email = auth.email())
    )
    OR (
      (SELECT e.role FROM employees e WHERE e.email = auth.email()) = 'admin'
      AND employee_id <> (SELECT e.id FROM employees e WHERE e.email = auth.email())
      AND NOT EXISTS (
        SELECT 1 FROM employees target
        WHERE target.id = timesheets.employee_id AND target.role = 'super_admin'
      )
    )
    OR (
      (SELECT e.department FROM employees e WHERE e.email = auth.email()) = 'people_culture'
      AND EXISTS (
        SELECT 1 FROM employees target
        WHERE target.id = timesheets.employee_id AND target.role = 'super_admin'
      )
    )
  );
