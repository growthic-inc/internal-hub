-- Grant admin role visibility across Growthic One operational tables.
-- Previously admin was treated identically to employee at the DB level.
-- This migration fixes RLS on timesheets, attendance, portal_access,
-- and the shared _is_dept_admin() helper (which gates leave, WFH, client visits).

-- ── Helper: reusable admin check ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM employees
    WHERE email = auth.email()
    AND role IN ('super_admin', 'admin')
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── _is_dept_admin: add admin role ──────────────────────────────────────────
-- Used by: leave_requests, wfh_requests, client_visit_requests
CREATE OR REPLACE FUNCTION _is_dept_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM employees e
    LEFT JOIN departments d ON d.id = e.department_id
    WHERE e.email = (auth.jwt() ->> 'email')
      AND (e.role IN ('super_admin', 'admin') OR d.system_key = 'people_culture')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── timesheets ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "ts_select" ON timesheets;
CREATE POLICY "ts_select" ON timesheets
  FOR SELECT USING (
    employee_id = (SELECT e.id FROM employees e WHERE e.email = auth.email())
    OR
    employee_id IN (
      SELECT s.id FROM get_all_subordinates(
        (SELECT e.id FROM employees e WHERE e.email = auth.email())
      ) s
    )
    OR is_admin()
  );

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
    OR is_admin()
  );

-- ── employee_attendance ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "att_select_own" ON employee_attendance;
CREATE POLICY "att_select_own" ON employee_attendance
  FOR SELECT USING (
    employee_id = (SELECT id FROM employees WHERE email = auth.email())
    OR is_admin()
  );

-- ── portal_access ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "pa_select" ON portal_access;
CREATE POLICY "pa_select" ON portal_access
  FOR SELECT TO authenticated
  USING (
    employee_id = (SELECT id FROM employees WHERE email = (auth.jwt() ->> 'email'))
    OR is_admin()
  );
