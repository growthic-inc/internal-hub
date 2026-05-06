-- ============================================================
-- Asset Requests & Return Requests — RLS Policy Fix
-- Run in Supabase SQL Editor
--
-- Problem: original policies granted HR-level access via
--   role IN ('super_admin', 'hr')
-- but the app assigns every employee role = 'employee' and uses
-- department = 'people_culture' for the HR function.
-- The 'hr' role was never assigned, so People & Culture employees
-- were silently blocked from seeing any requests other than their own.
--
-- Fix: replace the role check with
--   role = 'super_admin' OR department = 'people_culture'
-- which matches how the rest of the app (access_matrix) works.
-- ============================================================

-- ── asset_requests ───────────────────────────────────────────

DROP POLICY IF EXISTS "select_own_or_managed_or_hr" ON asset_requests;
DROP POLICY IF EXISTS "update_manager_or_hr"        ON asset_requests;

CREATE POLICY "select_own_or_managed_or_hr"
ON asset_requests
FOR SELECT
TO authenticated
USING (
  requested_by = auth.uid()
  OR manager_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM employees
    WHERE id = auth.uid()
      AND (role = 'super_admin' OR department = 'people_culture')
  )
);

CREATE POLICY "update_manager_or_hr"
ON asset_requests
FOR UPDATE
TO authenticated
USING (
  manager_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM employees
    WHERE id = auth.uid()
      AND (role = 'super_admin' OR department = 'people_culture')
  )
);

-- ── asset_return_requests ────────────────────────────────────

DROP POLICY IF EXISTS "return_requests_select" ON asset_return_requests;
DROP POLICY IF EXISTS "return_requests_update" ON asset_return_requests;

CREATE POLICY "return_requests_select"
ON asset_return_requests
FOR SELECT
TO authenticated
USING (
  returned_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM employees
    WHERE id = auth.uid()
      AND (role = 'super_admin' OR department = 'people_culture')
  )
);

CREATE POLICY "return_requests_update"
ON asset_return_requests
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM employees
    WHERE id = auth.uid()
      AND (role = 'super_admin' OR department = 'people_culture')
  )
);
