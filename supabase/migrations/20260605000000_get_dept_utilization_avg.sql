-- get_dept_utilization_avg
-- Returns the average utilization % across all active employees in a department
-- for a given month range. Utilization = logged hours / expected hours * 100,
-- capped at 150%. Returns NULL if no qualifying employees.

CREATE OR REPLACE FUNCTION get_dept_utilization_avg(
  p_department text,
  p_month_start date,
  p_month_end date
) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r              RECORD;
  v_weekdays     numeric;
  v_full_leaves  numeric;
  v_half_leaves  numeric;
  v_working_days numeric;
  v_expected_hrs numeric;
  v_logged_hrs   numeric;
  v_util         numeric;
  v_total_util   numeric := 0;
  v_count        integer := 0;
BEGIN
  FOR r IN
    SELECT id
    FROM   employees
    WHERE  department = p_department
      AND  status     = 'active'
  LOOP
    -- Count weekdays in month
    SELECT COUNT(*)
    INTO   v_weekdays
    FROM   generate_series(p_month_start, p_month_end, interval '1 day') AS gs(d)
    WHERE  EXTRACT(isodow FROM gs.d) BETWEEN 1 AND 5;

    -- Count weekday overlap of approved full-day leaves with month
    SELECT COALESCE(SUM(
      (SELECT COUNT(*)
       FROM   generate_series(
                GREATEST(l.start_date, p_month_start),
                LEAST(l.end_date, p_month_end),
                interval '1 day'
              ) AS gs(d)
       WHERE  EXTRACT(isodow FROM gs.d) BETWEEN 1 AND 5)
    ), 0)
    INTO v_full_leaves
    FROM leave_requests l
    WHERE l.employee_id   = r.id
      AND l.status        = 'approved'
      AND l.is_half_day   = false
      AND l.end_date     >= p_month_start
      AND l.start_date   <= p_month_end;

    -- Count approved half-day leaves in month (each = 0.5 days)
    SELECT COALESCE(COUNT(*), 0)
    INTO   v_half_leaves
    FROM   leave_requests l
    WHERE  l.employee_id  = r.id
      AND  l.status       = 'approved'
      AND  l.is_half_day  = true
      AND  l.start_date  >= p_month_start
      AND  l.start_date  <= p_month_end
      AND  EXTRACT(isodow FROM l.start_date) BETWEEN 1 AND 5;

    v_working_days := v_weekdays - v_full_leaves - (v_half_leaves * 0.5);
    v_expected_hrs := v_working_days * 9;

    CONTINUE WHEN v_expected_hrs <= 0;

    -- Sum all timesheet hours for the employee in the month (no status filter)
    SELECT COALESCE(SUM(hours), 0)
    INTO   v_logged_hrs
    FROM   timesheets
    WHERE  employee_id = r.id
      AND  date       >= p_month_start
      AND  date       <= p_month_end;

    v_util       := LEAST((v_logged_hrs / v_expected_hrs) * 100, 150);
    v_total_util := v_total_util + v_util;
    v_count      := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN
    RETURN NULL;
  END IF;

  RETURN ROUND(v_total_util / v_count, 1);
END;
$$;
