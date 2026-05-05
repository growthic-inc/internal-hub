-- ============================================================
-- Assets Table — Row Level Security Policies
-- Run in Supabase SQL Editor
-- ============================================================

-- Enable RLS (idempotent — safe to re-run)
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;

-- ── DROP existing policies so this script is re-runnable ──────
DROP POLICY IF EXISTS "assets_select"  ON assets;
DROP POLICY IF EXISTS "assets_insert"  ON assets;
DROP POLICY IF EXISTS "assets_update"  ON assets;
DROP POLICY IF EXISTS "assets_delete"  ON assets;

-- ── SELECT ───────────────────────────────────────────────────
-- All authenticated employees can read assets
-- (app-level access control handles what each role sees)
CREATE POLICY "assets_select"
ON assets
FOR SELECT
TO authenticated
USING (true);

-- ── INSERT ───────────────────────────────────────────────────
-- Only HR and Super Admin can add new assets
CREATE POLICY "assets_insert"
ON assets
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM employees
    WHERE id = auth.uid()
      AND role IN ('super_admin', 'hr')
  )
);

-- ── UPDATE ───────────────────────────────────────────────────
-- HR and Super Admin can update any asset
-- (covers assign, return, status change, edit, retire)
CREATE POLICY "assets_update"
ON assets
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM employees
    WHERE id = auth.uid()
      AND role IN ('super_admin', 'hr')
  )
);

-- ── DELETE ───────────────────────────────────────────────────
-- Only Super Admin can permanently delete assets
CREATE POLICY "assets_delete"
ON assets
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM employees
    WHERE id = auth.uid()
      AND role IN ('super_admin', 'hr')
  )
);
