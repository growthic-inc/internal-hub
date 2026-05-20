-- Fix: emp_update RLS policy referenced a non-existent 'hr' role
--
-- The policy allowed updates if get_my_role() IN ('super_admin', 'hr').
-- But 'hr' is not a real role — the only roles are 'super_admin' and
-- 'employee'. HR staff have role='employee', department='people_culture'.
-- This meant every employee update by People & Culture was silently
-- blocked at the DB level, even though the access matrix granted them
-- can_manage on manage_employees.
--
-- Fix: replace the 'hr' role check with a department='people_culture'
-- check (active employees only), matching what the access matrix allows.

DROP POLICY IF EXISTS emp_update ON employees;

CREATE POLICY emp_update ON employees FOR UPDATE
  USING (
    -- Employee can update their own profile
    id = auth.uid()
    -- Super admin can update anyone
    OR get_my_role() = 'super_admin'
    -- People & Culture (HR) can update any employee record
    OR EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id    = auth.uid()
        AND e.department = 'people_culture'
        AND e.status     = 'active'
    )
  );
