-- emp_update allowed self/super_admin/people_culture to write ANY column on
-- an employee row, with no WITH CHECK at all. Since RLS is row-level, not
-- column-level, this meant a plain 'people_culture' department employee
-- could set role='super_admin' on their own (or anyone's) record via a
-- direct API call — the only thing stopping it in practice was a disabled
-- <select> in the UI, which is not a security boundary.
--
-- This adds a WITH CHECK: role may only change if the caller is already
-- super_admin. Everyone else can still update every other column exactly
-- as before — only a role change specifically is now blocked unless the
-- new value matches what's already stored.

DROP POLICY IF EXISTS "emp_update" ON employees;
CREATE POLICY "emp_update" ON employees
  FOR UPDATE USING (
    (id = auth.uid())
    OR (get_my_role() = 'super_admin')
    OR (EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = auth.uid()
        AND e.department = 'people_culture'
        AND e.status = 'active'
    ))
  )
  WITH CHECK (
    role = (SELECT e2.role FROM employees e2 WHERE e2.id = employees.id)
    OR get_my_role() = 'super_admin'
  );
