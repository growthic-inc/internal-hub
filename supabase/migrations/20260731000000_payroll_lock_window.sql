-- Missed timesheet logic update:
-- Only days that are locked (> 7 days before CURRENT_DATE) can count as missed.
-- Draft timesheets no longer protect a day — employee must submit or get approved.
-- Open window days (within last 7 days) are never counted regardless of fill status.

CREATE OR REPLACE FUNCTION generate_monthly_payroll(
  p_month INT DEFAULT NULL,
  p_year  INT DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_month              INT;
  v_year               INT;
  v_run_id             UUID;
  v_emp                RECORD;
  v_monthly_salary     NUMERIC(12,2);
  v_days_payable       INT;
  v_prorated           NUMERIC(12,2);
  v_unpaid_days        NUMERIC(4,1);
  v_missed_ts_days     INT;
  v_deductions         NUMERIC(12,2);
  v_net_pay            NUMERIC(12,2);
  v_emp_status         TEXT;
  v_payment_status     TEXT;
  v_period_start       DATE;
  v_period_end         DATE;
  v_lock_cutoff        DATE;
  v_lwd                DATE;
BEGIN
  IF p_month IS NULL THEN
    v_month := EXTRACT(MONTH FROM (now() - INTERVAL '1 month'))::INT;
    v_year  := EXTRACT(YEAR  FROM (now() - INTERVAL '1 month'))::INT;
  ELSE
    v_month := p_month;
    v_year  := p_year;
  END IF;

  v_period_start := make_date(v_year, v_month, 1);
  v_period_end   := (make_date(v_year, v_month, 1) + INTERVAL '1 month - 1 day')::DATE;
  -- Only count days that are locked (beyond the 7-day editable window)
  v_lock_cutoff  := (CURRENT_DATE - INTERVAL '7 days')::DATE;

  IF EXISTS (SELECT 1 FROM payroll_runs WHERE month = v_month AND year = v_year) THEN
    SELECT id INTO v_run_id FROM payroll_runs WHERE month = v_month AND year = v_year;
    RETURN v_run_id;
  END IF;

  INSERT INTO payroll_runs (month, year, status)
  VALUES (v_month, v_year, 'draft')
  RETURNING id INTO v_run_id;

  FOR v_emp IN
    SELECT e.id, e.status, e.deactivated_at
    FROM employees e
    WHERE
      e.status = 'active'
      OR (
        e.status = 'inactive'
        AND e.deactivated_at >= v_period_start
        AND e.deactivated_at <= v_period_end
      )
  LOOP
    -- Annual amounts ÷ 12 = monthly salary
    SELECT ROUND(COALESCE(SUM(esc.amount), 0) / 12.0, 2)
    INTO v_monthly_salary
    FROM employee_salary_components esc
    JOIN salary_components sc ON sc.id = esc.component_id
    WHERE esc.employee_id = v_emp.id
      AND sc.category     = 'fixed'
      AND sc.is_active    = true;

    IF v_emp.status = 'inactive' AND v_emp.deactivated_at IS NOT NULL THEN
      v_lwd            := v_emp.deactivated_at;
      v_days_payable   := GREATEST(1, (v_lwd - v_period_start + 1)::INT);
      v_emp_status     := 'inactive';
      v_payment_status := 'hold';
    ELSE
      v_lwd            := v_period_end;
      v_days_payable   := 30;
      v_emp_status     := 'active';
      v_payment_status := 'pending';
    END IF;

    v_prorated := ROUND((v_monthly_salary * v_days_payable / 30.0), 2);

    -- Approved deductible leave days only
    SELECT COALESCE(SUM(
      CASE
        WHEN lr.is_half_day THEN 0.5
        ELSE (LEAST(lr.end_date, v_lwd) - GREATEST(lr.start_date, v_period_start) + 1)::NUMERIC
      END
    ), 0)
    INTO v_unpaid_days
    FROM leave_requests lr
    JOIN leave_types lt ON lt.id = lr.leave_type_id
    WHERE lr.employee_id   = v_emp.id
      AND lr.status        = 'approved'
      AND lt.is_deductible = true
      AND lr.start_date    <= v_lwd
      AND lr.end_date      >= v_period_start;

    -- Missed timesheet days:
    -- Working days (Mon–Sat, not holiday, not on approved full-day leave)
    -- that are locked (> 7 days before today) AND have no submitted/approved entry.
    -- Draft entries do NOT protect a day — employee must submit.
    SELECT COUNT(*)::INT
    INTO v_missed_ts_days
    FROM generate_series(v_period_start, LEAST(v_lwd, v_period_end), '1 day'::interval) d(day)
    WHERE
      d.day::date < v_lock_cutoff
      AND EXTRACT(DOW FROM d.day) != 0
      AND NOT EXISTS (
        SELECT 1 FROM company_holidays ch WHERE ch.date = d.day::date
      )
      AND NOT EXISTS (
        SELECT 1 FROM leave_requests lr
        WHERE lr.employee_id = v_emp.id
          AND lr.status      = 'approved'
          AND lr.is_half_day = false
          AND d.day::date BETWEEN lr.start_date AND lr.end_date
      )
      AND NOT EXISTS (
        SELECT 1 FROM timesheets t
        WHERE t.employee_id = v_emp.id
          AND t.date        = d.day::date
          AND t.status      IN ('submitted', 'approved')
      );

    v_deductions := ROUND((v_monthly_salary / 30.0) * (v_unpaid_days + v_missed_ts_days), 2);
    v_net_pay    := v_prorated - v_deductions;

    INSERT INTO payroll_records (
      payroll_run_id,      employee_id,         employment_status,
      monthly_salary,      days_payable,        prorated_salary,
      unpaid_leave_days,   missed_timesheet_days, deductions,
      adjustments,         net_pay,             payment_status
    ) VALUES (
      v_run_id,            v_emp.id,            v_emp_status,
      v_monthly_salary,    v_days_payable,      v_prorated,
      v_unpaid_days,       v_missed_ts_days,    v_deductions,
      0,                   v_net_pay,           v_payment_status
    );
  END LOOP;

  RETURN v_run_id;
END;
$$;
