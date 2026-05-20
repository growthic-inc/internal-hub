-- Fix: Access Control write gate should check designation, not role
--
-- The Founder's Office user has role='employee', designation="Founder's Office".
-- Previous policy checked role='founders_office' which never matched anyone.
-- Now checks designation = "Founder's Office" instead.

DROP POLICY IF EXISTS access_control_write ON access_matrix;

CREATE POLICY access_control_write ON access_matrix
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE email = (auth.jwt() ->> 'email')
        AND (
          role = 'super_admin'
          OR designation = 'Founder''s Office'
        )
    )
  );
