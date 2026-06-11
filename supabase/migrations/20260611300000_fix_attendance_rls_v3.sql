-- Definitive attendance RLS fix (v3).
-- The "new row violates row-level security policy" error with a PERMISSIVE
-- WITH CHECK(true) policy means the request role did not match the policy's
-- target role (TO authenticated). The app's other working read policy on this
-- table uses TO public, so align the write policies to TO public as well and
-- gate on a present auth context.

-- ── employee_attendance ─────────────────────────────────────
DROP POLICY IF EXISTS "att_insert" ON employee_attendance;
DROP POLICY IF EXISTS "att_update" ON employee_attendance;

CREATE POLICY "att_insert" ON employee_attendance
  FOR INSERT TO public
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "att_update" ON employee_attendance
  FOR UPDATE TO public
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ── attendance_upload_log ───────────────────────────────────
DROP POLICY IF EXISTS "att_log_insert" ON attendance_upload_log;
DROP POLICY IF EXISTS "att_log_select" ON attendance_upload_log;

CREATE POLICY "att_log_insert" ON attendance_upload_log
  FOR INSERT TO public
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "att_log_select" ON attendance_upload_log
  FOR SELECT TO public
  USING (auth.uid() IS NOT NULL);
