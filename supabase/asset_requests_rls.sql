-- ============================================================
-- Asset Requests — Row Level Security Policies
-- Run in Supabase SQL Editor AFTER asset_requests_migration.sql
-- ============================================================

-- Enable RLS (idempotent — safe to re-run)
ALTER TABLE asset_requests ENABLE ROW LEVEL SECURITY;

-- ── DROP existing policies so this script is re-runnable ──────
DROP POLICY IF EXISTS "insert_own_requests"          ON asset_requests;
DROP POLICY IF EXISTS "select_own_or_managed_or_hr"  ON asset_requests;
DROP POLICY IF EXISTS "update_manager_or_hr"         ON asset_requests;

-- ── INSERT ───────────────────────────────────────────────────
-- Any authenticated employee can create a request, provided the
-- requested_by field matches their own employee ID (= auth.uid()).
CREATE POLICY "insert_own_requests"
ON asset_requests
FOR INSERT
TO authenticated
WITH CHECK (requested_by = auth.uid());

-- ── SELECT ───────────────────────────────────────────────────
-- An employee can see:
--   • their own requests (requested_by = me)
--   • requests they are the reporting manager for (manager_id = me)
--   • all requests if they are super_admin or hr
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
      AND role IN ('super_admin', 'hr')
  )
);

-- ── UPDATE ───────────────────────────────────────────────────
-- A manager can update requests assigned to them for Stage 1 approval.
-- HR / super_admin can update any request (Stage 2 approval).
CREATE POLICY "update_manager_or_hr"
ON asset_requests
FOR UPDATE
TO authenticated
USING (
  manager_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM employees
    WHERE id = auth.uid()
      AND role IN ('super_admin', 'hr')
  )
);
