-- ============================================================
-- Portal Access
-- Per-employee grants controlling which departmental portals
-- (Growthic HRMS, and future portals) a user can open.
-- Independent of, and additive to, the existing department-level
-- access_matrix / department_permissions system — those are untouched.
-- ============================================================

CREATE TABLE IF NOT EXISTS portal_access (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  portal_id   TEXT        NOT NULL,
  granted_by  UUID        REFERENCES employees(id),
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, portal_id)
);

ALTER TABLE portal_access ENABLE ROW LEVEL SECURITY;

-- Employees can read their own grants (client needs this to know which
-- portals to show/allow); super_admin can read all.
CREATE POLICY pa_select ON portal_access FOR SELECT TO authenticated
  USING (
    employee_id = (SELECT id FROM employees WHERE email = (auth.jwt() ->> 'email'))
    OR EXISTS (
      SELECT 1 FROM employees e
      WHERE e.email = (auth.jwt() ->> 'email') AND e.role = 'super_admin'
    )
  );

-- Only super_admin can grant/revoke
CREATE POLICY pa_insert ON portal_access FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.email = (auth.jwt() ->> 'email') AND e.role = 'super_admin'
    )
  );

CREATE POLICY pa_delete ON portal_access FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.email = (auth.jwt() ->> 'email') AND e.role = 'super_admin'
    )
  );

-- ── Seed: preserve current HRMS access on cutover ────────────
-- Every current People & Culture member gets an explicit growthic-hrms
-- grant, so nobody loses access once platform-config.js's hardcoded
-- department rule is removed in favour of this table. Super Admins
-- don't need a row — they bypass the check in code.
INSERT INTO portal_access (employee_id, portal_id)
SELECT e.id, 'growthic-hrms'
FROM employees e
LEFT JOIN departments d ON d.id = e.department_id
WHERE d.system_key = 'people_culture'
ON CONFLICT (employee_id, portal_id) DO NOTHING;

-- ── Realtime: allow the HRMS shell to subscribe to revocations ──
-- Idempotent — skips if the table is already in the publication
-- (e.g. if the project publishes FOR ALL TABLES).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'portal_access'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE portal_access;
  END IF;
END $$;

-- ============================================================
-- Extend payroll RLS additively — a Portal Access grant gives
-- full functional access to HRMS data, not just a bare shell.
-- Every policy below keeps its original two conditions
-- (super_admin OR people_culture department) untouched, and adds
-- a third: an explicit portal_access row for 'growthic-hrms'.
-- Recreated here (DROP + CREATE) rather than editing the original
-- payroll_module.sql, since portal_access didn't exist yet at that
-- point in migration history.
-- ============================================================

-- salary_components
DROP POLICY IF EXISTS sc_insert ON salary_components;
CREATE POLICY sc_insert ON salary_components FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
    OR EXISTS (
      SELECT 1 FROM portal_access pa JOIN employees e2 ON e2.id = pa.employee_id
      WHERE e2.email = (auth.jwt() ->> 'email') AND pa.portal_id = 'growthic-hrms'
    )
  );

DROP POLICY IF EXISTS sc_update ON salary_components;
CREATE POLICY sc_update ON salary_components FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
    OR EXISTS (
      SELECT 1 FROM portal_access pa JOIN employees e2 ON e2.id = pa.employee_id
      WHERE e2.email = (auth.jwt() ->> 'email') AND pa.portal_id = 'growthic-hrms'
    )
  );

DROP POLICY IF EXISTS sc_delete ON salary_components;
CREATE POLICY sc_delete ON salary_components FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
    OR EXISTS (
      SELECT 1 FROM portal_access pa JOIN employees e2 ON e2.id = pa.employee_id
      WHERE e2.email = (auth.jwt() ->> 'email') AND pa.portal_id = 'growthic-hrms'
    )
  );

-- employee_salary_components
DROP POLICY IF EXISTS esc_select ON employee_salary_components;
CREATE POLICY esc_select ON employee_salary_components FOR SELECT TO authenticated
  USING (
    employee_id = (SELECT id FROM employees WHERE email = (auth.jwt() ->> 'email'))
    OR EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
    OR EXISTS (
      SELECT 1 FROM portal_access pa JOIN employees e2 ON e2.id = pa.employee_id
      WHERE e2.email = (auth.jwt() ->> 'email') AND pa.portal_id = 'growthic-hrms'
    )
  );

DROP POLICY IF EXISTS esc_insert ON employee_salary_components;
CREATE POLICY esc_insert ON employee_salary_components FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
    OR EXISTS (
      SELECT 1 FROM portal_access pa JOIN employees e2 ON e2.id = pa.employee_id
      WHERE e2.email = (auth.jwt() ->> 'email') AND pa.portal_id = 'growthic-hrms'
    )
  );

DROP POLICY IF EXISTS esc_update ON employee_salary_components;
CREATE POLICY esc_update ON employee_salary_components FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
    OR EXISTS (
      SELECT 1 FROM portal_access pa JOIN employees e2 ON e2.id = pa.employee_id
      WHERE e2.email = (auth.jwt() ->> 'email') AND pa.portal_id = 'growthic-hrms'
    )
  );

-- payroll_runs
DROP POLICY IF EXISTS pr_select ON payroll_runs;
CREATE POLICY pr_select ON payroll_runs FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
    OR EXISTS (
      SELECT 1 FROM portal_access pa JOIN employees e2 ON e2.id = pa.employee_id
      WHERE e2.email = (auth.jwt() ->> 'email') AND pa.portal_id = 'growthic-hrms'
    )
  );

DROP POLICY IF EXISTS pr_insert ON payroll_runs;
CREATE POLICY pr_insert ON payroll_runs FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
    OR EXISTS (
      SELECT 1 FROM portal_access pa JOIN employees e2 ON e2.id = pa.employee_id
      WHERE e2.email = (auth.jwt() ->> 'email') AND pa.portal_id = 'growthic-hrms'
    )
  );

DROP POLICY IF EXISTS pr_update ON payroll_runs;
CREATE POLICY pr_update ON payroll_runs FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
    OR EXISTS (
      SELECT 1 FROM portal_access pa JOIN employees e2 ON e2.id = pa.employee_id
      WHERE e2.email = (auth.jwt() ->> 'email') AND pa.portal_id = 'growthic-hrms'
    )
  );

-- payroll_records
DROP POLICY IF EXISTS prec_select ON payroll_records;
CREATE POLICY prec_select ON payroll_records FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
    OR EXISTS (
      SELECT 1 FROM portal_access pa JOIN employees e2 ON e2.id = pa.employee_id
      WHERE e2.email = (auth.jwt() ->> 'email') AND pa.portal_id = 'growthic-hrms'
    )
  );

DROP POLICY IF EXISTS prec_insert ON payroll_records;
CREATE POLICY prec_insert ON payroll_records FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
    OR EXISTS (
      SELECT 1 FROM portal_access pa JOIN employees e2 ON e2.id = pa.employee_id
      WHERE e2.email = (auth.jwt() ->> 'email') AND pa.portal_id = 'growthic-hrms'
    )
  );

DROP POLICY IF EXISTS prec_update ON payroll_records;
CREATE POLICY prec_update ON payroll_records FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
    OR EXISTS (
      SELECT 1 FROM portal_access pa JOIN employees e2 ON e2.id = pa.employee_id
      WHERE e2.email = (auth.jwt() ->> 'email') AND pa.portal_id = 'growthic-hrms'
    )
  );

-- payroll_adjustments
DROP POLICY IF EXISTS padj_select ON payroll_adjustments;
CREATE POLICY padj_select ON payroll_adjustments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
    OR EXISTS (
      SELECT 1 FROM portal_access pa JOIN employees e2 ON e2.id = pa.employee_id
      WHERE e2.email = (auth.jwt() ->> 'email') AND pa.portal_id = 'growthic-hrms'
    )
  );

DROP POLICY IF EXISTS padj_insert ON payroll_adjustments;
CREATE POLICY padj_insert ON payroll_adjustments FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
    OR EXISTS (
      SELECT 1 FROM portal_access pa JOIN employees e2 ON e2.id = pa.employee_id
      WHERE e2.email = (auth.jwt() ->> 'email') AND pa.portal_id = 'growthic-hrms'
    )
  );

DROP POLICY IF EXISTS padj_delete ON payroll_adjustments;
CREATE POLICY padj_delete ON payroll_adjustments FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
    OR EXISTS (
      SELECT 1 FROM portal_access pa JOIN employees e2 ON e2.id = pa.employee_id
      WHERE e2.email = (auth.jwt() ->> 'email') AND pa.portal_id = 'growthic-hrms'
    )
  );

-- payroll_audit_log
DROP POLICY IF EXISTS pal_select ON payroll_audit_log;
CREATE POLICY pal_select ON payroll_audit_log FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
    OR EXISTS (
      SELECT 1 FROM portal_access pa JOIN employees e2 ON e2.id = pa.employee_id
      WHERE e2.email = (auth.jwt() ->> 'email') AND pa.portal_id = 'growthic-hrms'
    )
  );

DROP POLICY IF EXISTS pal_insert ON payroll_audit_log;
CREATE POLICY pal_insert ON payroll_audit_log FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
    OR EXISTS (
      SELECT 1 FROM portal_access pa JOIN employees e2 ON e2.id = pa.employee_id
      WHERE e2.email = (auth.jwt() ->> 'email') AND pa.portal_id = 'growthic-hrms'
    )
  );
