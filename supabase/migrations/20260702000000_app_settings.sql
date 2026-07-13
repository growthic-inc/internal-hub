-- ── app_settings ─────────────────────────────────────────────
-- Global key-value config store for all modules.
-- Keys are namespaced by module: 'attendance.late_threshold', 'payroll.x', etc.
CREATE TABLE IF NOT EXISTS app_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  label      text,
  module     text NOT NULL,
  updated_by uuid REFERENCES employees(id),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read settings
CREATE POLICY "app_settings_select" ON app_settings
  FOR SELECT USING (auth.role() = 'authenticated');

-- Only super_admin or People & Culture (HR) can write
CREATE POLICY "app_settings_insert" ON app_settings
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
  );

CREATE POLICY "app_settings_update" ON app_settings
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.email = (auth.jwt() ->> 'email')
        AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
    )
  );

-- ── Seed defaults ─────────────────────────────────────────────
INSERT INTO app_settings (key, value, label, module) VALUES
  ('attendance.late_threshold',     '10:30', 'Late Arrival Threshold', 'attendance'),
  ('attendance.late_effective_from', '2026-07', 'Late Marking Effective From (YYYY-MM)', 'attendance')
ON CONFLICT (key) DO NOTHING;
