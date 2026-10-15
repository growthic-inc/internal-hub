-- #17: Allow super_admin to give the final management approval
-- when the designated Management-department approver is unavailable
-- (on leave, left the company, etc.), preventing appraisals from
-- getting permanently stuck.
--
-- Modifies approve_appraisal_management() to accept the caller when
-- they are super_admin, even if not in the Management department.

CREATE OR REPLACE FUNCTION approve_appraisal_management(
  p_compensation_id uuid,
  p_approver_id     uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_comp        RECORD;
  v_caller_emp  RECORD;
BEGIN
  SELECT * INTO v_comp FROM employee_compensation WHERE id = p_compensation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compensation record not found.'; END IF;
  IF v_comp.status <> 'pending_management' THEN
    RAISE EXCEPTION 'This appraisal is not awaiting management approval.';
  END IF;

  SELECT id, role, department FROM employees WHERE id = p_approver_id INTO v_caller_emp;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approver employee record not found.'; END IF;

  -- Allow super_admin OR anyone in the Management department
  IF v_caller_emp.role <> 'super_admin' THEN
    IF NOT EXISTS (
      SELECT 1 FROM departments d
      WHERE d.id = (SELECT department_id FROM employees WHERE id = p_approver_id)
        AND d.system_key = 'management'
    ) THEN
      RAISE EXCEPTION 'Only a Management department member or super_admin can give the final approval.';
    END IF;
  END IF;

  -- Close the currently active compensation row
  UPDATE employee_compensation
  SET status = 'superseded', updated_at = NOW()
  WHERE employee_id = v_comp.employee_id AND status = 'active';

  -- Activate this appraisal
  UPDATE employee_compensation
  SET status = 'active',
      management_approver_id = p_approver_id,
      management_approved_at = NOW(),
      effective_from = COALESCE(v_comp.effective_from, CURRENT_DATE),
      updated_at = NOW()
  WHERE id = p_compensation_id;
END;
$$;
