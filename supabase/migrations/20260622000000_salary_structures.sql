-- ============================================================
-- HRMS — Salary Structure
--
-- Stores per-employee salary breakdown (monthly components +
-- deductions). Multiple rows per employee are allowed to track
-- changes over time — effective_from determines which is active.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS salary_structures (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id                UUID        NOT NULL REFERENCES employees(id),
  effective_from             DATE        NOT NULL,

  -- Annual CTC (Cost to Company)
  ctc_annual                 NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- Monthly earnings
  basic_monthly              NUMERIC(10,2) NOT NULL DEFAULT 0,
  hra_monthly                NUMERIC(10,2) NOT NULL DEFAULT 0,
  special_allowance_monthly  NUMERIC(10,2) NOT NULL DEFAULT 0,
  other_allowances_monthly   NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Monthly deductions
  pf_employee_monthly        NUMERIC(10,2) NOT NULL DEFAULT 0,
  pf_employer_monthly        NUMERIC(10,2) NOT NULL DEFAULT 0,
  professional_tax_monthly   NUMERIC(10,2) NOT NULL DEFAULT 0,
  tds_monthly                NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Metadata
  notes                      TEXT,
  created_by                 UUID REFERENCES employees(id),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Only one structure per employee per effective date
  UNIQUE (employee_id, effective_from)
);

CREATE INDEX IF NOT EXISTS salary_structures_employee_idx
  ON salary_structures (employee_id, effective_from DESC);

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE salary_structures ENABLE ROW LEVEL SECURITY;

-- Only super_admin and HR can read salary data
CREATE POLICY salary_struct_select ON salary_structures
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
  );

-- Only super_admin and HR can insert
CREATE POLICY salary_struct_insert ON salary_structures
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
  );

-- Only super_admin and HR can update
CREATE POLICY salary_struct_update ON salary_structures
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
  );

COMMIT;
