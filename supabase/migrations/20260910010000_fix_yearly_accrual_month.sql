-- Fix yearly accrual: credit on Jan 1 (calendar year) instead of Apr 1 (Indian FY)

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
        -- Calendar year quarters: Jan(1), Apr(4), Jul(7), Oct(10)
        IF v_month IN (1, 4, 7, 10) THEN
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
        -- Jan(1) — calendar year start
        IF v_month = 1 THEN
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
