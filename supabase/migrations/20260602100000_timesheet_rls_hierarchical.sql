-- Fix timesheet RLS to allow hierarchical visibility
-- Previously: managers could only SELECT/UPDATE entries for their *direct* reports
--             (employees.manager_id = auth user).
-- Now: managers can SELECT/UPDATE entries for their entire reporting subtree
--      (direct + indirect reports) via the recursive get_all_subordinates() CTE.

-- Helper: resolve the employee id for the current auth user
-- Used inline below so we don't need a separate function.

-- ── SELECT ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "ts_select" ON timesheets;

CREATE POLICY "ts_select" ON timesheets
  FOR SELECT USING (
    -- own entries
    employee_id = (SELECT e.id FROM employees e WHERE e.email = auth.email())
    OR
    -- full reporting subtree (direct + indirect reports)
    employee_id IN (
      SELECT s.id
      FROM get_all_subordinates(
        (SELECT e.id FROM employees e WHERE e.email = auth.email())
      ) s
    )
  );

-- ── UPDATE (approve / reject / edit) ───────────────────────────────────────
DROP POLICY IF EXISTS "ts_update" ON timesheets;

CREATE POLICY "ts_update" ON timesheets
  FOR UPDATE USING (
    -- own entries
    employee_id = (SELECT e.id FROM employees e WHERE e.email = auth.email())
    OR
    -- full reporting subtree
    employee_id IN (
      SELECT s.id
      FROM get_all_subordinates(
        (SELECT e.id FROM employees e WHERE e.email = auth.email())
      ) s
    )
  );
