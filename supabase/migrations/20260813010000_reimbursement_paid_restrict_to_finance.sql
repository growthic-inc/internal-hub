-- Marking a reimbursement as 'paid' should be reserved for finance/super_admin
-- (finance is dormant today, so super_admin is the effective actor) — HR can
-- review and approve claims, but should not be able to push them to 'paid'.
-- The UI already gates this (canPayment = isFinance || isSuperAdmin), but the
-- database previously allowed HR/people_culture to write any status via two
-- unrestricted UPDATE policies. Adding a WITH CHECK closes that gap without
-- touching HR's existing ability to approve/reject.

DROP POLICY IF EXISTS "reimb_update" ON reimbursements;
CREATE POLICY "reimb_update" ON reimbursements
  FOR UPDATE USING (
    (employee_id = auth.uid() AND status = 'pending')
    OR (get_my_role() = 'hr' AND employee_id <> auth.uid())
    OR (get_my_role() = 'super_admin')
    OR (get_my_role() = 'finance' AND type = 'claim' AND status = 'approved')
  )
  WITH CHECK (
    status <> 'paid' OR get_my_role() IN ('finance', 'super_admin')
  );

DROP POLICY IF EXISTS "people_culture_can_update_reimbursements" ON reimbursements;
CREATE POLICY "people_culture_can_update_reimbursements" ON reimbursements
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
        AND employees.department = 'people_culture'
        AND employees.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
        AND employees.department = 'people_culture'
        AND employees.status = 'active'
    )
    AND (status <> 'paid' OR get_my_role() IN ('finance', 'super_admin'))
  );
