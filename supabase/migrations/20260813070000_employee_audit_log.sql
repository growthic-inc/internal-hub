-- Logs sensitive employee field changes (starting with bank details) —
-- who changed what, from what value, to what value, and when. Mirrors
-- payroll_audit_log's shape. The emp_update RLS policy already permits
-- super_admin/people_culture to write these columns; this table adds the
-- audit trail that action deserves, given a wrong or malicious bank
-- detail change has real financial consequences.

CREATE TABLE employee_audit_log (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id    uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  field_name     text NOT NULL,
  original_value text,
  updated_value  text,
  changed_by     uuid REFERENCES employees(id),
  changed_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE employee_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "eal_select" ON employee_audit_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
        AND (role = 'super_admin' OR department = 'people_culture')
    )
  );

CREATE POLICY "eal_insert" ON employee_audit_log
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
        AND (role = 'super_admin' OR department = 'people_culture')
    )
  );
