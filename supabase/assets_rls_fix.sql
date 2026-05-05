-- ============================================================
-- RLS Fix — Security-definer role helper + corrected policies
-- for assets, asset_requests, and asset_return_requests tables.
--
-- Root cause: the subquery  SELECT 1 FROM employees WHERE id = auth.uid()
-- inside asset policies is itself blocked by RLS on the employees table,
-- so it always returns 0 rows and every write is denied.
--
-- Fix: a SECURITY DEFINER function that reads the employees table
-- with elevated privileges, bypassing its own RLS.
-- ============================================================

-- ── 1. Helper function ────────────────────────────────────────
-- Returns the role of the currently authenticated user.
-- SECURITY DEFINER = runs as the function owner (postgres),
-- so it can always read employees regardless of that table's RLS.
CREATE OR REPLACE FUNCTION auth_employee_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM employees WHERE id = auth.uid()
$$;


-- ════════════════════════════════════════════════════════════
-- 2. ASSETS table policies
-- ════════════════════════════════════════════════════════════
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "assets_select" ON assets;
DROP POLICY IF EXISTS "assets_insert" ON assets;
DROP POLICY IF EXISTS "assets_update" ON assets;
DROP POLICY IF EXISTS "assets_delete" ON assets;

-- All authenticated users can read assets
CREATE POLICY "assets_select"
ON assets FOR SELECT TO authenticated
USING (true);

-- HR / Super Admin can add new assets
CREATE POLICY "assets_insert"
ON assets FOR INSERT TO authenticated
WITH CHECK (auth_employee_role() IN ('super_admin', 'hr'));

-- HR / Super Admin can update any asset
CREATE POLICY "assets_update"
ON assets FOR UPDATE TO authenticated
USING (auth_employee_role() IN ('super_admin', 'hr'));

-- HR / Super Admin can delete assets
CREATE POLICY "assets_delete"
ON assets FOR DELETE TO authenticated
USING (auth_employee_role() IN ('super_admin', 'hr'));


-- ════════════════════════════════════════════════════════════
-- 3. ASSET_REQUESTS table policies
-- ════════════════════════════════════════════════════════════
ALTER TABLE asset_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "insert_own_requests"         ON asset_requests;
DROP POLICY IF EXISTS "select_own_or_managed_or_hr" ON asset_requests;
DROP POLICY IF EXISTS "update_manager_or_hr"        ON asset_requests;

-- Any employee can submit a request for themselves
CREATE POLICY "insert_own_requests"
ON asset_requests FOR INSERT TO authenticated
WITH CHECK (requested_by = auth.uid());

-- Employee sees own; manager sees team's; HR/Admin see all
CREATE POLICY "select_own_or_managed_or_hr"
ON asset_requests FOR SELECT TO authenticated
USING (
  requested_by = auth.uid()
  OR manager_id = auth.uid()
  OR auth_employee_role() IN ('super_admin', 'hr')
);

-- Manager can update requests for their team; HR/Admin can update any
CREATE POLICY "update_manager_or_hr"
ON asset_requests FOR UPDATE TO authenticated
USING (
  manager_id = auth.uid()
  OR auth_employee_role() IN ('super_admin', 'hr')
);


-- ════════════════════════════════════════════════════════════
-- 4. ASSET_RETURN_REQUESTS table policies
-- ════════════════════════════════════════════════════════════
ALTER TABLE asset_return_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "return_requests_insert" ON asset_return_requests;
DROP POLICY IF EXISTS "return_requests_select" ON asset_return_requests;
DROP POLICY IF EXISTS "return_requests_update" ON asset_return_requests;

-- Employee can only submit a return for themselves
CREATE POLICY "return_requests_insert"
ON asset_return_requests FOR INSERT TO authenticated
WITH CHECK (returned_by = auth.uid());

-- Employee sees own; HR/Admin see all
CREATE POLICY "return_requests_select"
ON asset_return_requests FOR SELECT TO authenticated
USING (
  returned_by = auth.uid()
  OR auth_employee_role() IN ('super_admin', 'hr')
);

-- Only HR / Super Admin can approve or reject
CREATE POLICY "return_requests_update"
ON asset_return_requests FOR UPDATE TO authenticated
USING (auth_employee_role() IN ('super_admin', 'hr'));
