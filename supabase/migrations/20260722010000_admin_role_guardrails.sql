-- ============================================================
-- Admin role — guardrails
-- 1. Lock down who can change an employee's role (super_admin only,
--    enforced at the database level so it can't be bypassed by
--    calling the API directly, only the People page's UI hiding it).
-- 2. Extend Access Control's write permission to include the new
--    'admin' role, additive to the existing super_admin / Founder's
--    Office designation check — nothing existing is removed.
-- ============================================================

-- ── 1. Role-change lockdown ──────────────────────────────────
-- Exempts:
--   - the actual database owner (Supabase dashboard / direct SQL,
--     which always connects as the literal 'postgres' role) —
--     preserves that as the standing "outside the app" override.
--   - service_role (trusted backend/Edge Function automation).
-- Restricts:
--   - normal authenticated app traffic (PostgREST, using an
--     employee's own login) to super_admin only, for role changes.
CREATE OR REPLACE FUNCTION _guard_employee_role_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF current_user IN ('postgres', 'service_role') OR auth.role() = 'service_role' THEN
      RETURN NEW;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM employees
      WHERE email = (auth.jwt() ->> 'email') AND role = 'super_admin'
    ) THEN
      RAISE EXCEPTION 'Only Super Admin can change an employee''s role.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_employee_role_change ON employees;
CREATE TRIGGER trg_guard_employee_role_change
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION _guard_employee_role_change();

-- ── 2. Access Control write permission — add admin ───────────
DROP POLICY IF EXISTS access_control_write ON access_matrix;
CREATE POLICY access_control_write ON access_matrix
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE email = (auth.jwt() ->> 'email')
        AND (
          role = 'super_admin'
          OR role = 'admin'
          OR designation = 'Founder''s Office'
        )
    )
  );
