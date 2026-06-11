-- Fix employee_attendance RLS policies
-- auth.role() can be unreliable; use auth.uid() IS NOT NULL instead

DROP POLICY IF EXISTS "att_insert" ON employee_attendance;
DROP POLICY IF EXISTS "att_update" ON employee_attendance;

CREATE POLICY "att_insert" ON employee_attendance
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "att_update" ON employee_attendance
  FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Fix attendance_upload_log policies too
DROP POLICY IF EXISTS "att_log_insert" ON attendance_upload_log;

CREATE POLICY "att_log_insert" ON attendance_upload_log
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
