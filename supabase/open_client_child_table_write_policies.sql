-- Fix: Open write policies on client child tables to all active employees
--
-- Previously restricted to specific roles/departments (super_admin, bde,
-- founders_office, business_development). But clients_update is open to
-- everyone, so entity/platform management should be too.
-- Any active employee can now insert/update/delete entities, platforms,
-- entity_platforms and entity_services — matching clients_update behaviour.

DROP POLICY IF EXISTS entities_write  ON client_entities;
DROP POLICY IF EXISTS platforms_write ON client_platforms;
DROP POLICY IF EXISTS ep_write        ON entity_platforms;
DROP POLICY IF EXISTS es_write        ON entity_services;

CREATE POLICY entities_write ON client_entities FOR ALL
  USING (auth.uid() IN (
    SELECT id FROM employees WHERE status = 'active'
  ));

CREATE POLICY platforms_write ON client_platforms FOR ALL
  USING (auth.uid() IN (
    SELECT id FROM employees WHERE status = 'active'
  ));

CREATE POLICY ep_write ON entity_platforms FOR ALL
  USING (auth.uid() IN (
    SELECT id FROM employees WHERE status = 'active'
  ));

CREATE POLICY es_write ON entity_services FOR ALL
  USING (auth.uid() IN (
    SELECT id FROM employees WHERE status = 'active'
  ));
