-- ============================================================
-- HRMS Payroll Module
-- Paste 1 of 2 — Tables, triggers, payroll generation function
-- Paste 2 of 2 — RLS policies + pg_cron job
-- ============================================================

-- ── 0. Drop old salary_structures (confirmed empty) ──────────
DROP TABLE IF EXISTS salary_structures CASCADE;

-- ── 1. employees: add deactivated_at ─────────────────────────
ALTER TABLE employees ADD COLUMN IF NOT EXISTS deactivated_at DATE;

-- ── 2. leave_types: add is_deductible flag ───────────────────
--    Marks which leave types trigger salary deduction in payroll
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS is_deductible BOOLEAN NOT NULL DEFAULT false;

-- Auto-mark any existing "Unpaid Leave" type as deductible
UPDATE leave_types SET is_deductible = true WHERE name ILIKE 'unpaid%';

-- ── 3. salary_components (Settings) ──────────────────────────
CREATE TABLE salary_components (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT          NOT NULL,
  category      TEXT          NOT NULL CHECK (category IN ('fixed', 'variable')),
  is_active     BOOLEAN       NOT NULL DEFAULT true,
  display_order INT           NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── 4. employee_salary_components (Dashboard data) ───────────
CREATE TABLE employee_salary_components (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  UUID          NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  component_id UUID          NOT NULL REFERENCES salary_components(id) ON DELETE CASCADE,
  amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by   UUID          REFERENCES employees(id),
  UNIQUE (employee_id, component_id)
);

-- ── 5. payroll_runs (one record per month) ───────────────────
CREATE TABLE payroll_runs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  month        INT         NOT NULL CHECK (month BETWEEN 1 AND 12),
  year         INT         NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  generated_by UUID        REFERENCES employees(id),
  UNIQUE (month, year)
);

-- ── 6. payroll_records (one per employee per run) ────────────
CREATE TABLE payroll_records (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id    UUID          NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id       UUID          NOT NULL REFERENCES employees(id),
  employment_status TEXT          NOT NULL DEFAULT 'active',
  monthly_salary    NUMERIC(12,2) NOT NULL DEFAULT 0,
  days_payable      INT           NOT NULL DEFAULT 30,
  prorated_salary   NUMERIC(12,2) NOT NULL DEFAULT 0,
  unpaid_leave_days NUMERIC(4,1)  NOT NULL DEFAULT 0,
  deductions        NUMERIC(12,2) NOT NULL DEFAULT 0,
  adjustments       NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_pay           NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_status    TEXT          NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'hold')),
  payment_date      DATE,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (payroll_run_id, employee_id)
);

-- ── 7. payroll_adjustments ───────────────────────────────────
CREATE TABLE payroll_adjustments (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_record_id UUID          NOT NULL REFERENCES payroll_records(id) ON DELETE CASCADE,
  type              TEXT          NOT NULL CHECK (type IN ('performance_bonus', 'incentive', 'others')),
  amount            NUMERIC(12,2) NOT NULL,
  remark            TEXT          NOT NULL,
  created_by        UUID          NOT NULL REFERENCES employees(id),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── 8. payroll_audit_log ─────────────────────────────────────
CREATE TABLE payroll_audit_log (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_record_id UUID        NOT NULL REFERENCES payroll_records(id) ON DELETE CASCADE,
  field_name        TEXT        NOT NULL,
  original_value    TEXT,
  updated_value     TEXT,
  remark            TEXT        NOT NULL,
  changed_by        UUID        NOT NULL REFERENCES employees(id),
  changed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 9. Trigger: new employee → seed component rows ───────────
CREATE OR REPLACE FUNCTION _payroll_on_employee_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO employee_salary_components (employee_id, component_id, amount)
  SELECT NEW.id, id, 0
  FROM salary_components
  WHERE is_active = true AND category = 'fixed'
  ON CONFLICT (employee_id, component_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payroll_employee_insert
  AFTER INSERT ON employees
  FOR EACH ROW EXECUTE FUNCTION _payroll_on_employee_insert();

-- ── 10. Trigger: new fixed component → seed employee rows ────
CREATE OR REPLACE FUNCTION _payroll_on_component_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.category = 'fixed' AND NEW.is_active = true THEN
    INSERT INTO employee_salary_components (employee_id, component_id, amount)
    SELECT id, NEW.id, 0
    FROM employees
    WHERE status = 'active'
    ON CONFLICT (employee_id, component_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payroll_component_insert
  AFTER INSERT ON salary_components
  FOR EACH ROW EXECUTE FUNCTION _payroll_on_component_insert();

-- ── 11. Payroll generation function ──────────────────────────
--    Called by cron on the 1st of each month (generates previous month).
--    Can also be called manually: SELECT generate_monthly_payroll(6, 2026);
--    Idempotent — safe to call multiple times for same month.
CREATE OR REPLACE FUNCTION generate_monthly_payroll(
  p_month INT DEFAULT NULL,
  p_year  INT DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_month          INT;
  v_year           INT;
  v_run_id         UUID;
  v_emp            RECORD;
  v_monthly_salary NUMERIC(12,2);
  v_days_payable   INT;
  v_prorated       NUMERIC(12,2);
  v_unpaid_days    NUMERIC(4,1);
  v_deductions     NUMERIC(12,2);
  v_net_pay        NUMERIC(12,2);
  v_emp_status     TEXT;
  v_payment_status TEXT;
  v_period_start   DATE;
  v_period_end     DATE;
  v_lwd            DATE;
BEGIN
  -- Default: previous calendar month
  IF p_month IS NULL THEN
    v_month := EXTRACT(MONTH FROM (now() - INTERVAL '1 month'))::INT;
    v_year  := EXTRACT(YEAR  FROM (now() - INTERVAL '1 month'))::INT;
  ELSE
    v_month := p_month;
    v_year  := p_year;
  END IF;

  v_period_start := make_date(v_year, v_month, 1);
  v_period_end   := (make_date(v_year, v_month, 1) + INTERVAL '1 month - 1 day')::DATE;

  -- Idempotent: return existing run ID if already generated
  IF EXISTS (SELECT 1 FROM payroll_runs WHERE month = v_month AND year = v_year) THEN
    SELECT id INTO v_run_id FROM payroll_runs WHERE month = v_month AND year = v_year;
    RETURN v_run_id;
  END IF;

  INSERT INTO payroll_runs (month, year, status)
  VALUES (v_month, v_year, 'draft')
  RETURNING id INTO v_run_id;

  -- Include: all active employees + employees deactivated within this month
  FOR v_emp IN
    SELECT e.id, e.status, e.deactivated_at
    FROM employees e
    WHERE
      e.status = 'active'
      OR (
        e.status = 'inactive'
        AND e.deactivated_at >= v_period_start
        AND e.deactivated_at <= v_period_end
      )
  LOOP
    -- Monthly salary = sum of all active fixed components for this employee
    SELECT COALESCE(SUM(esc.amount), 0)
    INTO v_monthly_salary
    FROM employee_salary_components esc
    JOIN salary_components sc ON sc.id = esc.component_id
    WHERE esc.employee_id = v_emp.id
      AND sc.category     = 'fixed'
      AND sc.is_active    = true;

    -- Days payable: 30 for active, actual days for mid-month exits
    IF v_emp.status = 'inactive' AND v_emp.deactivated_at IS NOT NULL THEN
      v_lwd            := v_emp.deactivated_at;
      v_days_payable   := GREATEST(1, (v_lwd - v_period_start + 1)::INT);
      v_emp_status     := 'inactive';
      v_payment_status := 'hold';
    ELSE
      v_lwd            := v_period_end;
      v_days_payable   := 30;
      v_emp_status     := 'active';
      v_payment_status := 'pending';
    END IF;

    v_prorated := ROUND((v_monthly_salary * v_days_payable / 30.0), 2);

    -- Unpaid leave days within the payable period (half-days count as 0.5)
    SELECT COALESCE(SUM(
      CASE
        WHEN lr.is_half_day THEN 0.5
        ELSE (LEAST(lr.end_date, v_lwd) - GREATEST(lr.start_date, v_period_start) + 1)::NUMERIC
      END
    ), 0)
    INTO v_unpaid_days
    FROM leave_requests lr
    JOIN leave_types lt ON lt.id = lr.leave_type_id
    WHERE lr.employee_id  = v_emp.id
      AND lr.status       = 'approved'
      AND lt.is_deductible = true
      AND lr.start_date   <= v_lwd
      AND lr.end_date     >= v_period_start;

    v_deductions := ROUND((v_monthly_salary / 30.0) * v_unpaid_days, 2);
    v_net_pay    := v_prorated - v_deductions;

    INSERT INTO payroll_records (
      payroll_run_id,    employee_id,       employment_status,
      monthly_salary,    days_payable,      prorated_salary,
      unpaid_leave_days, deductions,        adjustments,
      net_pay,           payment_status
    ) VALUES (
      v_run_id,          v_emp.id,          v_emp_status,
      v_monthly_salary,  v_days_payable,    v_prorated,
      v_unpaid_days,     v_deductions,      0,
      v_net_pay,         v_payment_status
    );
  END LOOP;

  RETURN v_run_id;
END;
$$;

-- ════════════════════════════════════════════════════════════
-- PASTE 2 — Run this separately after Paste 1 succeeds
-- RLS policies + pg_cron job
-- ════════════════════════════════════════════════════════════

-- Helper: true if caller is super_admin or people_culture HR
-- (reused inline in every policy below)

-- ── salary_components ─────────────────────────────────────────
ALTER TABLE salary_components ENABLE ROW LEVEL SECURITY;

-- HR / super_admin: full access
CREATE POLICY sc_select ON salary_components FOR SELECT TO authenticated
  USING (true);

CREATE POLICY sc_insert ON salary_components FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
  );

CREATE POLICY sc_update ON salary_components FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
  );

CREATE POLICY sc_delete ON salary_components FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
  );

-- ── employee_salary_components ────────────────────────────────
ALTER TABLE employee_salary_components ENABLE ROW LEVEL SECURITY;

-- Employees can read their own; HR/super_admin can read all
CREATE POLICY esc_select ON employee_salary_components FOR SELECT TO authenticated
  USING (
    employee_id = (SELECT id FROM employees WHERE email = (auth.jwt() ->> 'email'))
    OR EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
  );

CREATE POLICY esc_insert ON employee_salary_components FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
  );

CREATE POLICY esc_update ON employee_salary_components FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
  );

-- ── payroll_runs ──────────────────────────────────────────────
ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY pr_select ON payroll_runs FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
  );

CREATE POLICY pr_insert ON payroll_runs FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
  );

CREATE POLICY pr_update ON payroll_runs FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
  );

-- ── payroll_records ───────────────────────────────────────────
ALTER TABLE payroll_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY prec_select ON payroll_records FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
  );

CREATE POLICY prec_insert ON payroll_records FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
  );

CREATE POLICY prec_update ON payroll_records FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
  );

-- ── payroll_adjustments ───────────────────────────────────────
ALTER TABLE payroll_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY padj_select ON payroll_adjustments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
  );

CREATE POLICY padj_insert ON payroll_adjustments FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
  );

CREATE POLICY padj_delete ON payroll_adjustments FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
  );

-- ── payroll_audit_log ─────────────────────────────────────────
ALTER TABLE payroll_audit_log ENABLE ROW LEVEL SECURITY;

-- super_admin can read all; HR can read all; no one can delete audit logs
CREATE POLICY pal_select ON payroll_audit_log FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
  );

CREATE POLICY pal_insert ON payroll_audit_log FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
  );

-- ── pg_cron: generate payroll on 1st of every month at 9 AM ──
SELECT cron.schedule(
  'hrms-generate-monthly-payroll',
  '0 9 1 * *',
  $$ SELECT generate_monthly_payroll() $$
);
