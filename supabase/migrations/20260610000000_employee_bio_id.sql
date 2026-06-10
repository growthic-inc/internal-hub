-- Add biometric system identifier to employees
-- Stores the numeric ID from the biometric attendance machine.
-- Used for future attendance data import and cross-referencing.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS bio_id integer;

-- Ensure no two employees share the same biometric ID
CREATE UNIQUE INDEX IF NOT EXISTS employees_bio_id_unique
  ON employees (bio_id)
  WHERE bio_id IS NOT NULL;
