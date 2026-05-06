-- Fix: Extend write policies on client child tables to include business_development department
--
-- Previously, writes on client_entities, client_platforms, entity_platforms, and entity_services
-- were restricted to role IN ('super_admin', 'founders_office', 'bde').
-- Employees with role = 'employee' but department = 'business_development' were silently blocked,
-- causing platforms and entities to appear missing after client creation/edit.

-- ── client_entities ────────────────────────────────────────────
DROP POLICY IF EXISTS entities_write ON client_entities;
CREATE POLICY entities_write ON client_entities FOR ALL
  USING (
    get_my_role() = ANY (ARRAY['super_admin','founders_office','bde'])
    OR auth.uid() IN (
      SELECT id FROM employees
      WHERE department = 'business_development' AND status = 'active'
    )
  );

-- ── client_platforms ───────────────────────────────────────────
DROP POLICY IF EXISTS platforms_write ON client_platforms;
CREATE POLICY platforms_write ON client_platforms FOR ALL
  USING (
    get_my_role() = ANY (ARRAY['super_admin','founders_office','bde'])
    OR auth.uid() IN (
      SELECT id FROM employees
      WHERE department = 'business_development' AND status = 'active'
    )
  );

-- ── entity_platforms ───────────────────────────────────────────
DROP POLICY IF EXISTS ep_write ON entity_platforms;
CREATE POLICY ep_write ON entity_platforms FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE email = (auth.jwt() ->> 'email')
        AND (
          role = ANY (ARRAY['super_admin','bde'])
          OR department = 'business_development'
        )
    )
  );

-- ── entity_services ────────────────────────────────────────────
DROP POLICY IF EXISTS es_write ON entity_services;
CREATE POLICY es_write ON entity_services FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE email = (auth.jwt() ->> 'email')
        AND (
          role = ANY (ARRAY['super_admin','bde'])
          OR department = 'business_development'
        )
    )
  );
