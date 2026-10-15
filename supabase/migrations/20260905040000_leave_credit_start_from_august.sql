-- Reverses today's earlier January-based backfill and reconciliation
-- (20260905010000, 20260905030000). Decision: whatever's already
-- credited through July (the original manual entries from May 6 -
-- July 7) is considered settled by the process that existed before
-- this automation — no January-onward reconstruction. The automated
-- system instead takes over cleanly from August 1, 2026 onward.
--
-- Step 1: remove everything inserted today (both January-based
-- migrations ran in this single session, both dated 2026-09-05).
-- Use explicit month condition (not created_at) so this is safe to re-run:
-- only removes auto credits before August 2026 (the ones the earlier same-day
-- migrations inserted), never touching August/September/later real credits.
DELETE FROM leave_credits
WHERE is_auto = true
  AND credit_month < '2026-08-01'::date;

-- Step 2: credit August 1 and September 1 — the two monthly accrual
-- events that have actually occurred since the "start from August"
-- cutoff — for Casual Leave and Earned Leave (the only monthly types).
-- Medical Leave (yearly, Jan) and Mental Health Leave (half-yearly,
-- Jan/Jul) have no scheduled event between Aug 1 and today, so they
-- correctly get nothing added here; their next event is naturally
-- handled by the corrected run_leave_auto_credit() when it arrives
-- (Jan 2027 for both).
--
-- Tagged is_auto = true with a real credit_month, exactly like the
-- real cron would — so when it runs for real on October 1, its own
-- ON CONFLICT (employee_id, leave_type_id, credit_month) guard sees
-- August/September as already handled and just adds October cleanly,
-- with no gap and no double-credit.
DO $$
DECLARE
  rec_lt  RECORD;
  rec_emp RECORD;
  v_month DATE;
BEGIN
  FOR rec_lt IN
    SELECT id, annual_days
    FROM leave_types
    WHERE is_active = true AND accrual_frequency = 'monthly' AND annual_days > 0
  LOOP
    FOREACH v_month IN ARRAY ARRAY['2026-08-01'::date, '2026-09-01'::date] LOOP
      FOR rec_emp IN
        SELECT id FROM employees
        WHERE status = 'active' AND employment_type = 'full_time'
      LOOP
        INSERT INTO leave_credits
          (employee_id, leave_type_id, year, credited_days, is_auto, credit_month)
        VALUES
          (rec_emp.id, rec_lt.id, 2026, ROUND(rec_lt.annual_days / 12.0, 2), true, v_month)
        ON CONFLICT (employee_id, leave_type_id, credit_month) WHERE is_auto = true
        DO NOTHING;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;
