-- ═══════════════════════════════════════════════════════════════
--  Leave Auto-Credit Policy
--  Extends leave_types + leave_credits; installs pg_cron scheduler.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. leave_types: add policy columns ─────────────────────────
ALTER TABLE leave_types
  ADD COLUMN IF NOT EXISTS annual_days       NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS accrual_frequency TEXT
    CHECK (accrual_frequency IN ('monthly','quarterly','half_yearly','yearly'));

-- Seed defaults for existing leave types (safe to re-run: only fills NULLs)
UPDATE leave_types
SET annual_days = 12, accrual_frequency = 'monthly'
WHERE name ILIKE 'earned%' AND accrual_frequency IS NULL;

UPDATE leave_types
SET annual_days = 6, accrual_frequency = 'monthly'
WHERE name ILIKE 'casual%' AND accrual_frequency IS NULL;

UPDATE leave_types
SET annual_days = 5, accrual_frequency = 'yearly'
WHERE name ILIKE 'medical%' AND accrual_frequency IS NULL;

UPDATE leave_types
SET annual_days = 1, accrual_frequency = 'half_yearly'
WHERE name ILIKE 'mental health%' AND accrual_frequency IS NULL;

-- Compensatory and Unpaid leave intentionally have NULL accrual_frequency (no auto-credit)

-- ── 2. leave_credits: add auto-credit tracking columns ──────────
ALTER TABLE leave_credits
  ADD COLUMN IF NOT EXISTS is_auto      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS credit_month DATE;

-- Prevent duplicate auto-credits for the same employee + leave type + month
CREATE UNIQUE INDEX IF NOT EXISTS leave_credits_auto_unique
  ON leave_credits (employee_id, leave_type_id, credit_month)
  WHERE is_auto = true;

-- ── 3. Auto-credit function ─────────────────────────────────────
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
  -- Loop through all auto-creditable leave types
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
        -- Apr(4) and Oct(10)
        IF v_month IN (4, 10) THEN
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

    -- Credit every active full-time employee
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

-- ── 4. Schedule via pg_cron ─────────────────────────────────────
-- Runs on the 1st of every month at 00:00 UTC.
-- Remove the old job if it exists, then re-create it cleanly.
DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('leave-auto-credit');
  EXCEPTION WHEN others THEN NULL;
  END;
END;
$$;

SELECT cron.schedule(
  'leave-auto-credit',
  '0 0 1 * *',
  'SELECT run_leave_auto_credit()'
);
