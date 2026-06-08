-- Update get_dept_utilization_avg to use 7.5h/day instead of 9h/day
-- to match the corrected utilization formula (productive hours, not total hours)

CREATE OR REPLACE FUNCTION get_dept_utilization_avg(
  p_department   text,
  p_month_start  date,
  p_month_end    date
) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  total_util     numeric := 0;
  emp_count      integer := 0;
  weekday_count  integer;
  v_emp_id       uuid;
  leave_full_days integer;
  leave_half_count integer;
  working_days   numeric;
  logged_hours   numeric;
  expected_hours numeric;
BEGIN
  -- Weekdays in the month
  SELECT COUNT(*)::integer INTO weekday_count
  FROM generate_series(p_month_start, p_month_end, interval '1 day') AS d
  WHERE EXTRACT(isodow FROM d) <= 5;

  FOR v_emp_id IN
    SELECT e.id FROM employees e
    WHERE e.department = p_department AND e.status = 'active'
  LOOP
    -- Weekdays in approved full-day leaves overlapping this month
    SELECT COALESCE((
      SELECT SUM(
        (SELECT COUNT(*) FROM generate_series(
          GREATEST(lr.start_date, p_month_start),
          LEAST(lr.end_date, p_month_end),
          interval '1 day'
        ) AS ld WHERE EXTRACT(isodow FROM ld) <= 5)
      )
      FROM leave_requests lr
      WHERE lr.employee_id = v_emp_id
        AND lr.status = 'approved'
        AND lr.is_half_day = false
        AND lr.start_date <= p_month_end
        AND lr.end_date   >= p_month_start
    ), 0)::integer INTO leave_full_days;

    -- Approved half-day leaves in this month
    SELECT COALESCE(COUNT(*)::integer, 0) INTO leave_half_count
    FROM leave_requests lr
    WHERE lr.employee_id = v_emp_id
      AND lr.status = 'approved'
      AND lr.is_half_day = true
      AND lr.start_date >= p_month_start
      AND lr.start_date <= p_month_end;

    working_days   := weekday_count - leave_full_days - (leave_half_count * 0.5);
    IF working_days <= 0 THEN CONTINUE; END IF;

    expected_hours := working_days * 7.5;   -- 7.5 productive hours per day

    SELECT COALESCE(SUM(t.hours), 0) INTO logged_hours
    FROM timesheets t
    WHERE t.employee_id = v_emp_id
      AND t.date BETWEEN p_month_start AND p_month_end;

    total_util := total_util + LEAST((logged_hours / expected_hours) * 100, 150);
    emp_count  := emp_count + 1;
  END LOOP;

  IF emp_count = 0 THEN RETURN NULL; END IF;
  RETURN ROUND(total_util / emp_count, 1);
END;
$$;
