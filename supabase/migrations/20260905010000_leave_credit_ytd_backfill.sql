-- One-time backfill: brings every active full-time employee's 2026 YTD
-- credited total, for each auto-creditable leave type, up to what
-- leave_auto_credit_policy (20260901000000) would have produced had it
-- existed since January — computed generically from each type's own
-- annual_days/accrual_frequency, same schedule run_leave_auto_credit()
-- uses, and respecting each employee's own joining_date (a mid-year
-- joiner only gets credited for accrual events on/after they were
-- actually employed — matches how the real monthly cron would have
-- treated them had it been running the whole time).
--
-- Only tops up a shortfall; never reduces an existing credit that
-- already meets or exceeds the target (e.g. a generous manual entry).
-- Compensatory and Unpaid Leave have no accrual_frequency and are
-- correctly skipped — they were never part of this policy.

DO $$
DECLARE
  v_today   DATE := CURRENT_DATE;
  v_year    INT  := EXTRACT(YEAR FROM v_today)::INT;
  rec_lt    RECORD;
  rec_emp   RECORD;
  v_target  NUMERIC;
  v_current NUMERIC;
  v_topup   NUMERIC;
  v_events  INT;
  v_month   INT;
BEGIN
  FOR rec_lt IN
    SELECT id, annual_days, accrual_frequency
    FROM leave_types
    WHERE is_active         = true
      AND accrual_frequency IS NOT NULL
      AND annual_days       IS NOT NULL
      AND annual_days       > 0
  LOOP
    FOR rec_emp IN
      SELECT id, joining_date FROM employees
      WHERE status = 'active' AND employment_type = 'full_time'
    LOOP
      v_events := 0;

      CASE rec_lt.accrual_frequency
        WHEN 'monthly' THEN
          FOR v_month IN 1..EXTRACT(MONTH FROM v_today)::int LOOP
            IF rec_emp.joining_date <= make_date(v_year, v_month, 1) THEN
              v_events := v_events + 1;
            END IF;
          END LOOP;
          v_target := ROUND(rec_lt.annual_days / 12.0, 2) * v_events;

        WHEN 'quarterly' THEN -- Indian FY quarters: Apr, Jul, Oct, Jan
          FOREACH v_month IN ARRAY ARRAY[1,4,7,10] LOOP
            IF make_date(v_year, v_month, 1) <= v_today
               AND rec_emp.joining_date <= make_date(v_year, v_month, 1) THEN
              v_events := v_events + 1;
            END IF;
          END LOOP;
          v_target := ROUND(rec_lt.annual_days / 4.0, 2) * v_events;

        WHEN 'half_yearly' THEN -- Apr and Oct
          FOREACH v_month IN ARRAY ARRAY[4,10] LOOP
            IF make_date(v_year, v_month, 1) <= v_today
               AND rec_emp.joining_date <= make_date(v_year, v_month, 1) THEN
              v_events := v_events + 1;
            END IF;
          END LOOP;
          v_target := ROUND(rec_lt.annual_days / 2.0, 2) * v_events;

        WHEN 'yearly' THEN -- Apr only (Indian FY start)
          IF make_date(v_year, 4, 1) <= v_today
             AND rec_emp.joining_date <= make_date(v_year, 4, 1) THEN
            v_target := rec_lt.annual_days;
          ELSE
            v_target := 0;
          END IF;

        ELSE
          v_target := 0;
      END CASE;

      CONTINUE WHEN v_target <= 0;

      SELECT COALESCE(SUM(credited_days), 0) INTO v_current
      FROM leave_credits
      WHERE employee_id = rec_emp.id AND leave_type_id = rec_lt.id AND year = v_year;

      v_topup := v_target - v_current;

      IF v_topup > 0 THEN
        INSERT INTO leave_credits
          (employee_id, leave_type_id, year, credited_days, is_auto, credit_month)
        VALUES
          (rec_emp.id, rec_lt.id, v_year, v_topup, false, NULL);
      END IF;
    END LOOP;
  END LOOP;
END $$;
