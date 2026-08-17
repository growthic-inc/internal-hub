-- ============================================================
-- Knowledge Labs — extend admin access to People & Culture
--
-- Matches the rest of /hrms: People & Culture already runs
-- everything else here (Policies, payroll, etc.) regardless of
-- individual role field. Knowledge Labs should follow the same
-- rule, using the existing _is_dept_admin() helper (defined in
-- 20260729000000_admin_role_rls.sql) instead of is_admin().
-- ============================================================

BEGIN;

-- ── knowledge_resources: read (admin branch widened) ─────────
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
        )
      )
    )
  );

-- ── knowledge_resources: write ────────────────────────────────
DROP POLICY IF EXISTS kr_insert ON knowledge_resources;
CREATE POLICY kr_insert ON knowledge_resources FOR INSERT TO authenticated
  WITH CHECK (_is_dept_admin());

DROP POLICY IF EXISTS kr_update ON knowledge_resources;
CREATE POLICY kr_update ON knowledge_resources FOR UPDATE TO authenticated
  USING (_is_dept_admin()) WITH CHECK (_is_dept_admin());

DROP POLICY IF EXISTS kr_delete ON knowledge_resources;
CREATE POLICY kr_delete ON knowledge_resources FOR DELETE TO authenticated
  USING (_is_dept_admin());

-- ── knowledge_access_grants: read (admin branch widened) ──────
DROP POLICY IF EXISTS kag_select ON knowledge_access_grants;
CREATE POLICY kag_select ON knowledge_access_grants FOR SELECT TO authenticated
  USING (
    employee_id = (SELECT id FROM employees WHERE email = auth.email())
    OR _is_dept_admin()
  );

-- ── knowledge_access_grants: write ────────────────────────────
DROP POLICY IF EXISTS kag_insert ON knowledge_access_grants;
CREATE POLICY kag_insert ON knowledge_access_grants FOR INSERT TO authenticated
  WITH CHECK (_is_dept_admin());

DROP POLICY IF EXISTS kag_delete ON knowledge_access_grants;
CREATE POLICY kag_delete ON knowledge_access_grants FOR DELETE TO authenticated
  USING (_is_dept_admin());

COMMIT;
