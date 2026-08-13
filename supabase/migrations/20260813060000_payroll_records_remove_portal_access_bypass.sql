-- payroll_records and payroll_runs SELECT policies included a blanket
-- "OR has ANY Portal Access grant to growthic-hrms" clause — meaning
-- anyone let into /hrms for an unrelated reason (e.g. a future Policies
-- grant) could already read every employee's payroll data, regardless of
-- role or department. The only current Portal Access holder (Radhika
-- Saini) already qualifies via people_culture anyway, so this clause was
-- protecting no real use case — pure unnecessary exposure.
--
-- Restrict both to match employee_compensation's already-correct rule:
-- super_admin or people_culture department, nothing else.

DROP POLICY IF EXISTS "prec_select" ON payroll_records;
CREATE POLICY "prec_select" ON payroll_records
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
  );

DROP POLICY IF EXISTS "pr_select" ON payroll_runs;
CREATE POLICY "pr_select" ON payroll_runs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
  );
