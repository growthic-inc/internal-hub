-- Grant Founders Office role write access to the access_matrix table
--
-- Previously only super_admin could INSERT/UPDATE/DELETE rows.
-- founders_office users can now also manage the access matrix,
-- matching the nav-level visibility granted in the frontend.

DROP POLICY IF EXISTS super_admin_write_access_matrix ON access_matrix;

CREATE POLICY access_control_write ON access_matrix
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE email = (auth.jwt() ->> 'email')
        AND role IN ('super_admin', 'founders_office')
    )
  );
