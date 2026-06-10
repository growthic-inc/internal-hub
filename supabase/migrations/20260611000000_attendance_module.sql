-- ── employee_attendance ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_attendance (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id         uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date                date NOT NULL,
  punch_in            time,
  punch_out           time,
  late_minutes        integer DEFAULT 0,
  early_leave_minutes integer DEFAULT 0,
  is_absent           boolean DEFAULT false,
  uploaded_by         uuid REFERENCES employees(id),
  uploaded_at         timestamptz DEFAULT now(),
  UNIQUE(employee_id, date)
);

ALTER TABLE employee_attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "att_select_own" ON employee_attendance FOR SELECT USING (
  employee_id = (SELECT id FROM employees WHERE email = auth.email())
);
CREATE POLICY "att_insert" ON employee_attendance FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "att_update" ON employee_attendance FOR UPDATE USING (auth.role() = 'authenticated');

-- ── attendance_upload_log ───────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_upload_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by       uuid REFERENCES employees(id),
  file_name         text NOT NULL,
  uploaded_at       timestamptz DEFAULT now(),
  records_processed integer DEFAULT 0,
  records_matched   integer DEFAULT 0,
  records_skipped   integer DEFAULT 0,
  date_from         date,
  date_to           date,
  status            text DEFAULT 'success' CHECK (status IN ('success','partial','failed'))
);

ALTER TABLE attendance_upload_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "att_log_select" ON attendance_upload_log FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "att_log_insert" ON attendance_upload_log FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ── access_matrix: upload_attendance ────────────────────────
INSERT INTO access_matrix (department, module, feature, access_level) VALUES
('management',          'leave_tracker', 'upload_attendance', 'can_manage'),
('operations_growth',   'leave_tracker', 'upload_attendance', 'can_manage'),
('people_culture',      'leave_tracker', 'upload_attendance', 'can_manage'),
('business_development','leave_tracker', 'upload_attendance', 'no_access'),
('content_strategy',    'leave_tracker', 'upload_attendance', 'no_access'),
('creative',            'leave_tracker', 'upload_attendance', 'no_access'),
('creators',            'leave_tracker', 'upload_attendance', 'no_access'),
('finance',             'leave_tracker', 'upload_attendance', 'no_access')
ON CONFLICT (department, module, feature) DO UPDATE SET access_level = EXCLUDED.access_level;
