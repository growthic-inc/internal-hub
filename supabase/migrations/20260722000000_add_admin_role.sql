-- Add 'admin' as a third valid value for employees.role, alongside
-- the existing 'super_admin' and 'employee'.
-- This is deliberately inert on its own: nothing in the app currently
-- writes or checks for 'admin', so no behavior changes until the rest
-- of the Admin role work (role-change lockdown, UI, Access Control
-- permission updates) is built on top of this.
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_role_check;
ALTER TABLE employees ADD CONSTRAINT employees_role_check
  CHECK (role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'employee'::text]));
