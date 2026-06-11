-- Definitive fix for employee_attendance / attendance_upload_log RLS.
-- Match the proven pattern used by social_metrics_daily & analytics_upload_log:
--   policies explicitly target the `authenticated` role with WITH CHECK (true).
-- The previous policies defaulted to the `public` role, which fails for
-- cross-user bulk inserts done by HR during attendance upload.

-- ── employee_attendance ─────────────────────────────────────
DROP POLICY IF EXISTS "att_insert" ON employee_attendance;
DROP POLICY IF EXISTS "att_update" ON employee_attendance;

CREATE POLICY "att_insert" ON employee_attendance
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "att_update" ON employee_attendance
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

-- ── attendance_upload_log ───────────────────────────────────
DROP POLICY IF EXISTS "att_log_insert" ON attendance_upload_log;
DROP POLICY IF EXISTS "att_log_select" ON attendance_upload_log;

CREATE POLICY "att_log_insert" ON attendance_upload_log
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "att_log_select" ON attendance_upload_log
  FOR SELECT TO authenticated
  USING (true);
