-- ============================================================
-- Knowledge Labs — remove the People & Culture carve-out
--
-- Reverting the department-wide bypass added in
-- 20260817010000. Inside Knowledge Labs specifically, HR gets
-- no special treatment: own department automatic, everything
-- else needs an explicit resource-level grant, same as any
-- employee. This does not touch _is_dept_admin() itself or any
-- other module that still relies on it (Policies, payroll, etc.)
-- — only these eight Knowledge Labs policies go back to plain
-- is_admin() (super_admin/admin only).
-- ============================================================

BEGIN;

-- ── knowledge_resources: read ────────────────────────────────
DROP POLICY IF EXISTS kr_select ON knowledge_resources;
CREATE POLICY kr_select ON knowledge_resources FOR SELECT TO authenticated
  USING (
    is_admin()
    OR (
      published
      AND (
        department_id = (SELECT department_id FROM employees WHERE email = auth.email())
        OR id IN (
          SELECT resource_id FROM knowledge_access_grants
          WHERE employee_id = (SELECT id FROM employees WHERE email = auth.email())
            AND revoked_at IS NULL
        )
      )
    )
  );

-- ── knowledge_resources: write ────────────────────────────────
DROP POLICY IF EXISTS kr_insert ON knowledge_resources;
CREATE POLICY kr_insert ON knowledge_resources FOR INSERT TO authenticated
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS kr_update ON knowledge_resources;
CREATE POLICY kr_update ON knowledge_resources FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS kr_delete ON knowledge_resources;
CREATE POLICY kr_delete ON knowledge_resources FOR DELETE TO authenticated
  USING (is_admin());

-- ── knowledge_access_grants: read ────────────────────────────
DROP POLICY IF EXISTS kag_select ON knowledge_access_grants;
CREATE POLICY kag_select ON knowledge_access_grants FOR SELECT TO authenticated
  USING (
    employee_id = (SELECT id FROM employees WHERE email = auth.email())
    OR is_admin()
  );

-- ── knowledge_access_grants: write ────────────────────────────
DROP POLICY IF EXISTS kag_insert ON knowledge_access_grants;
CREATE POLICY kag_insert ON knowledge_access_grants FOR INSERT TO authenticated
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS kag_update ON knowledge_access_grants;
CREATE POLICY kag_update ON knowledge_access_grants FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS kag_delete ON knowledge_access_grants;
CREATE POLICY kag_delete ON knowledge_access_grants FOR DELETE TO authenticated
  USING (is_admin());

COMMIT;
