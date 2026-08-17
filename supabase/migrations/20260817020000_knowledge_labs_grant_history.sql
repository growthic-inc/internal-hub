-- ============================================================
-- Knowledge Labs — track grant/revoke history instead of
-- hard-deleting on revoke.
--
-- Adds revoked_at/revoked_by so the Access Control screen can
-- show when access was granted and when it was revoked, and so
-- the row survives as an audit trail instead of disappearing.
-- "Active" access = revoked_at IS NULL.
-- ============================================================

BEGIN;

ALTER TABLE knowledge_access_grants
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_by UUID REFERENCES employees(id);

-- ── knowledge_resources: only ACTIVE grants unlock a department ──
DROP POLICY IF EXISTS kr_select ON knowledge_resources;
CREATE POLICY kr_select ON knowledge_resources FOR SELECT TO authenticated
  USING (
    _is_dept_admin()
    OR (
      published
      AND (
        department_id = (SELECT department_id FROM employees WHERE email = auth.email())
        OR department_id IN (
          SELECT department_id FROM knowledge_access_grants
          WHERE employee_id = (SELECT id FROM employees WHERE email = auth.email())
            AND revoked_at IS NULL
        )
      )
    )
  );

-- ── knowledge_access_grants: allow UPDATE (revoke sets revoked_at) ──
DROP POLICY IF EXISTS kag_update ON knowledge_access_grants;
CREATE POLICY kag_update ON knowledge_access_grants FOR UPDATE TO authenticated
  USING (_is_dept_admin()) WITH CHECK (_is_dept_admin());

COMMIT;
