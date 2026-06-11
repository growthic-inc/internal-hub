-- Privileged cross-user attendance write via SECURITY DEFINER RPC.
--
-- Root cause of the prior RLS failures: employee_attendance has a restrictive
-- SELECT policy (att_select_own — employees see only their own rows). HR uploads
-- OTHER employees' rows, and PostgREST's upsert (INSERT ... ON CONFLICT DO UPDATE)
-- requires the affected rows to be visible under the SELECT policy. They aren't,
-- so the write is rejected. Loosening SELECT would break privacy.
--
-- Solution: do the bulk upsert inside a SECURITY DEFINER function, which runs as
-- the function owner and bypasses RLS for the write, while the restrictive SELECT
-- policy continues to protect read access.

CREATE OR REPLACE FUNCTION upsert_employee_attendance(p_records jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec jsonb;
  cnt integer := 0;
BEGIN
  -- Must be an authenticated user
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  FOR rec IN SELECT * FROM jsonb_array_elements(p_records)
  LOOP
    INSERT INTO employee_attendance (
      employee_id, date, punch_in, punch_out,
      late_minutes, early_leave_minutes, is_absent, uploaded_by, uploaded_at
    ) VALUES (
      (rec->>'employee_id')::uuid,
      (rec->>'date')::date,
      NULLIF(rec->>'punch_in', '')::time,
      NULLIF(rec->>'punch_out', '')::time,
      COALESCE(NULLIF(rec->>'late_minutes', '')::int, 0),
      COALESCE(NULLIF(rec->>'early_leave_minutes', '')::int, 0),
      COALESCE((rec->>'is_absent')::boolean, false),
      NULLIF(rec->>'uploaded_by', '')::uuid,
      now()
    )
    ON CONFLICT (employee_id, date) DO UPDATE SET
      punch_in            = EXCLUDED.punch_in,
      punch_out           = EXCLUDED.punch_out,
      late_minutes        = EXCLUDED.late_minutes,
      early_leave_minutes = EXCLUDED.early_leave_minutes,
      is_absent           = EXCLUDED.is_absent,
      uploaded_by         = EXCLUDED.uploaded_by,
      uploaded_at         = now();
    cnt := cnt + 1;
  END LOOP;

  RETURN cnt;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_employee_attendance(jsonb) TO authenticated, anon;
