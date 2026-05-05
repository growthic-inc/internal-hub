-- ============================================================
-- Asset Return Requests — Table + RLS
-- Run in Supabase SQL Editor
-- ============================================================

-- ── Create table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS asset_return_requests (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id            UUID        NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  returned_by         UUID        NOT NULL REFERENCES employees(id),
  condition_on_return TEXT,
  notes               TEXT,
  status              TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'approved', 'rejected')),
  hr_acted_by         UUID        REFERENCES employees(id),
  hr_acted_at         TIMESTAMPTZ,
  hr_notes            TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Enable RLS ───────────────────────────────────────────────
ALTER TABLE asset_return_requests ENABLE ROW LEVEL SECURITY;

-- ── DROP existing policies (idempotent re-run) ────────────────
DROP POLICY IF EXISTS "return_requests_insert"  ON asset_return_requests;
DROP POLICY IF EXISTS "return_requests_select"  ON asset_return_requests;
DROP POLICY IF EXISTS "return_requests_update"  ON asset_return_requests;

-- ── INSERT: employee can only create a return for themselves ──
CREATE POLICY "return_requests_insert"
ON asset_return_requests
FOR INSERT
TO authenticated
WITH CHECK (returned_by = auth.uid());

-- ── SELECT: employee sees own returns; HR/Admin see all ───────
CREATE POLICY "return_requests_select"
ON asset_return_requests
FOR SELECT
TO authenticated
USING (
  returned_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM employees
    WHERE id = auth.uid()
      AND role IN ('super_admin', 'hr')
  )
);

-- ── UPDATE: only HR / Super Admin can approve or reject ───────
CREATE POLICY "return_requests_update"
ON asset_return_requests
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM employees
    WHERE id = auth.uid()
      AND role IN ('super_admin', 'hr')
  )
);
