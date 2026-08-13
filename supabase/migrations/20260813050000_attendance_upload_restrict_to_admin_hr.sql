-- Attendance upload (bulk insert into employee_attendance, and the
-- matching attendance_upload_log entry) was wide open — both insert
-- policies only checked auth.uid() IS NOT NULL, so any authenticated
-- employee could bulk-insert fake attendance data for the company.
--
-- Restrict to the intended actors: super_admin, admin, or People & Culture.

DROP POLICY IF EXISTS "att_insert" ON employee_attendance;
CREATE POLICY "att_insert" ON employee_attendance
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE email = auth.email()
        AND (role IN ('super_admin', 'admin') OR department = 'people_culture')
    )
  );

DROP POLICY IF EXISTS "att_log_insert" ON attendance_upload_log;
CREATE POLICY "att_log_insert" ON attendance_upload_log
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE email = auth.email()
        AND (role IN ('super_admin', 'admin') OR department = 'people_culture')
    )
  );

-- Bring access_matrix in line with the same rule: upload_attendance should
-- not be a blanket department grant for Operations & Growth or Management —
-- the admins who happen to sit there are already covered by the role check
-- above. Narrow those two department-wide grants to no_access; People &
-- Culture keeps can_manage since that's the department-based path.
UPDATE access_matrix
SET access_level = 'no_access'
WHERE module = 'leave_tracker'
  AND feature = 'upload_attendance'
  AND department IN ('operations_growth', 'management');
