-- Blocks a new leave request that would exceed the employee's remaining
-- balance for that leave type this year, for every leave type except
-- Unpaid Leave (which has no balance concept — is_unpaid = true).
--
-- The frontend already checks this and shows a friendly inline error
-- (see _openApplyLeaveModal in leave-tracker.js) — this trigger is the
-- backstop so the rule can't be bypassed by calling the API directly.
--
-- Only fires on INSERT: leave requests are never edited in place (only
-- created or moved to a new status via cancellation/approval), so there's
-- no UPDATE path that changes `days` or `leave_type_id` to also guard.

CREATE OR REPLACE FUNCTION check_leave_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_unpaid BOOLEAN;
  v_credited  NUMERIC;
  v_taken     NUMERIC;
  v_balance   NUMERIC;
BEGIN
  SELECT is_unpaid INTO v_is_unpaid
  FROM leave_types
  WHERE id = NEW.leave_type_id;

  IF v_is_unpaid THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(credited_days), 0) INTO v_credited
  FROM leave_credits
  WHERE employee_id   = NEW.employee_id
    AND leave_type_id = NEW.leave_type_id
    AND year          = EXTRACT(YEAR FROM NEW.start_date)::int;

  SELECT COALESCE(SUM(days), 0) INTO v_taken
  FROM leave_requests
  WHERE employee_id   = NEW.employee_id
    AND leave_type_id = NEW.leave_type_id
    AND status        = 'approved'
    AND EXTRACT(YEAR FROM start_date)::int = EXTRACT(YEAR FROM NEW.start_date)::int;

  v_balance := v_credited - v_taken;

  IF NEW.days > v_balance THEN
    RAISE EXCEPTION
      'Insufficient leave balance: % day(s) requested but only % day(s) remaining',
      NEW.days, v_balance;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_leave_balance ON leave_requests;
CREATE TRIGGER trg_check_leave_balance
  BEFORE INSERT ON leave_requests
  FOR EACH ROW
  EXECUTE FUNCTION check_leave_balance();
