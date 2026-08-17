-- ============================================================
-- Knowledge Labs — core tables
--
-- Department-wise SOPs/Templates, browsable in /knowledgelabs,
-- managed from /hrms. Actual content stays in Google Docs — this
-- only stores the index (title, description, doc link) plus
-- per-person cross-department access grants.
--
-- Reuses departments/employees as-is. Independent of, and not
-- touching, access_matrix / department_permissions / portal_access.
-- ============================================================

BEGIN;

-- ── knowledge_resources ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS knowledge_resources (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID        NOT NULL REFERENCES departments(id),
  title         TEXT        NOT NULL,
  description   TEXT,
  category      TEXT        NOT NULL CHECK (category IN ('SOP', 'Template')),
  doc_url       TEXT        NOT NULL,
  owner         TEXT,
  published     BOOLEAN     NOT NULL DEFAULT false,
  created_by    UUID        REFERENCES employees(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_resources_department_id_idx
  ON knowledge_resources (department_id);

-- ── knowledge_access_grants ──────────────────────────────────
CREATE TABLE IF NOT EXISTS knowledge_access_grants (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  department_id UUID        NOT NULL REFERENCES departments(id),
  granted_by    UUID        REFERENCES employees(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, department_id)
);

CREATE INDEX IF NOT EXISTS knowledge_access_grants_employee_id_idx
  ON knowledge_access_grants (employee_id);

ALTER TABLE knowledge_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_access_grants ENABLE ROW LEVEL SECURITY;

-- ── knowledge_resources: read ────────────────────────────────
-- Published rows in your own department, or a department you've
-- been granted into. Admins (is_admin(), defined in
-- 20260729000000_admin_role_rls.sql) see everything, including drafts.
DROP POLICY IF EXISTS kr_select ON knowledge_resources;
CREATE POLICY kr_select ON knowledge_resources FOR SELECT TO authenticated
  USING (
    is_admin()
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

-- ── knowledge_resources: write, admin only ───────────────────
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
-- An employee reads their own grants (so their own department
-- selector knows what to show); admins read all (Access control page).
DROP POLICY IF EXISTS kag_select ON knowledge_access_grants;
CREATE POLICY kag_select ON knowledge_access_grants FOR SELECT TO authenticated
  USING (
    employee_id = (SELECT id FROM employees WHERE email = auth.email())
    OR is_admin()
  );

-- ── knowledge_access_grants: write, admin only ───────────────
DROP POLICY IF EXISTS kag_insert ON knowledge_access_grants;
CREATE POLICY kag_insert ON knowledge_access_grants FOR INSERT TO authenticated
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS kag_delete ON knowledge_access_grants;
CREATE POLICY kag_delete ON knowledge_access_grants FOR DELETE TO authenticated
  USING (is_admin());

COMMIT;
