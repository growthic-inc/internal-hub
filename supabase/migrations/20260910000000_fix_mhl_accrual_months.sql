-- Fix MHL accrual months: calendar year (Jan + Jul) instead of Indian FY (Apr + Oct)
-- Also backfills Jul 1 2026 credit for employees who only received 0.5 MHL (Jan half only)

-- ── 1. Update the auto-credit function ─────────────────────────────
CREATE OR REPLACE FUNCTION run_leave_auto_credit()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_today         DATE    := CURRENT_DATE;
  v_month         INT     := EXTRACT(MONTH FROM v_today)::INT;
  v_year          INT     := EXTRACT(YEAR FROM v_today)::INT;
  v_credit_date   DATE    := DATE_TRUNC('month', v_today)::DATE;
  rec_lt          RECORD;
  rec_emp         RECORD;
  v_amount        NUMERIC;
  v_should_credit BOOLEAN;
BEGIN
  FOR rec_lt IN
    SELECT id, annual_days, accrual_frequency
    FROM   leave_types
    WHERE  is_active          = true
      AND  accrual_frequency  IS NOT NULL
      AND  annual_days        IS NOT NULL
      AND  annual_days        > 0
  LOOP
    v_should_credit := false;
    v_amount        := 0;

    CASE rec_lt.accrual_frequency
      WHEN 'monthly' THEN
        v_should_credit := true;
        v_amount := ROUND(rec_lt.annual_days / 12.0, 2);

      WHEN 'quarterly' THEN
        -- Indian FY quarters: Apr(4), Jul(7), Oct(10), Jan(1)
        IF v_month IN (4, 7, 10, 1) THEN
          v_should_credit := true;
          v_amount := ROUND(rec_lt.annual_days / 4.0, 2);
        END IF;

      WHEN 'half_yearly' THEN
        -- Calendar year halves: Jan(1) and Jul(7)
        IF v_month IN (1, 7) THEN
          v_should_credit := true;
          v_amount := ROUND(rec_lt.annual_days / 2.0, 2);
        END IF;

      WHEN 'yearly' THEN
        -- Apr(4) only — Indian financial year start
        IF v_month = 4 THEN
          v_should_credit := true;
          v_amount := rec_lt.annual_days;
        END IF;
    END CASE;

    CONTINUE WHEN NOT v_should_credit OR v_amount <= 0;

    FOR rec_emp IN
      SELECT id
      FROM   employees
      WHERE  status          = 'active'
        AND  employment_type = 'full_time'
    LOOP
      INSERT INTO leave_credits
        (employee_id, leave_type_id, year, credited_days, is_auto, credit_month)
      VALUES
        (rec_emp.id, rec_lt.id, v_year, v_amount, true, v_credit_date)
      ON CONFLICT (employee_id, leave_type_id, credit_month) WHERE is_auto = true
      DO NOTHING;
    END LOOP;
  END LOOP;
END;
$$;

-- ── 2. Backfill Jul 1 2026 MHL for employees who only got 0.5 ──────
-- Targets anyone whose total 2026 MHL credits sum to less than 1.0
-- (i.e. received the Jan half but not the Jul half)
INSERT INTO leave_credits (employee_id, leave_type_id, year, credited_days, is_auto, credit_month)
SELECT e.id, lt.id, 2026, 0.50, true, '2026-07-01'
FROM employees e
CROSS JOIN leave_types lt
WHERE e.status = 'active'
  AND e.employment_type = 'full_time'
  AND lt.name ILIKE 'mental%'
  AND lt.is_active = true
  AND e.id IN (
    SELECT lc.employee_id
    FROM   leave_credits lc
    JOIN   leave_types lt2 ON lt2.id = lc.leave_type_id
    WHERE  lt2.name ILIKE 'mental%'
      AND  lc.year = 2026
    GROUP BY lc.employee_id
    HAVING SUM(lc.credited_days) < 1.0
  )
ON CONFLICT (employee_id, leave_type_id, credit_month) WHERE is_auto = true
DO NOTHING;
