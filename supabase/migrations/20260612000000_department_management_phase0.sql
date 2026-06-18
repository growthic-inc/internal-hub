-- ============================================================
-- Department Management — Phase 0 (DB foundation)
--
-- Goal: make departments renameable from the frontend without
-- breaking access control or employee records.
--
-- Strategy:
--   * id (UUID)      -> the immutable DATA key. Employees and the
--                       access matrix reference departments by id,
--                       so renames never break relationships.
--   * system_key     -> immutable, human-readable SEMANTIC marker
--                       on every department. Privilege checks in JS
--                       use this (replacing hardcoded slug literals).
--                       Frozen at creation = current slug value.
--   * slug / name    -> editable, user-facing. Auto-generated from
--                       name in later phases.
--
-- This migration is NON-BREAKING: it ADDS columns, backfills them,
-- and installs sync triggers so existing writers (which still set
-- the legacy text `department` slug) keep working. The old slug
-- columns are retained as a safety net and dropped in Phase 4.
-- ============================================================

BEGIN;

-- ── 1. departments.system_key (immutable semantic marker) ─────
ALTER TABLE departments ADD COLUMN IF NOT EXISTS system_key TEXT;

-- Freeze the CURRENT slug as the system_key for every department.
-- This preserves the exact literals the 13 hardcoded checks rely on
-- ('people_culture', 'finance', 'business_development', ...).
UPDATE departments SET system_key = slug WHERE system_key IS NULL;

-- Enforce: every department has a unique, permanent system_key.
ALTER TABLE departments ALTER COLUMN system_key SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS departments_system_key_key
  ON departments (system_key);

-- Safety net: if any future insert omits system_key, default it
-- from the slug so the NOT NULL constraint never blocks a write.
CREATE OR REPLACE FUNCTION departments_default_system_key()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.system_key IS NULL THEN
    NEW.system_key := NEW.slug;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_departments_default_system_key ON departments;
CREATE TRIGGER trg_departments_default_system_key
  BEFORE INSERT ON departments
  FOR EACH ROW EXECUTE FUNCTION departments_default_system_key();

-- ── 2. employees.department_id (UUID FK) ──────────────────────
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id);

UPDATE employees e
  SET department_id = d.id
  FROM departments d
  WHERE d.slug = e.department
    AND e.department_id IS NULL;

CREATE INDEX IF NOT EXISTS employees_department_id_idx
  ON employees (department_id);

-- ── 3. access_matrix.department_id (UUID FK) ──────────────────
ALTER TABLE access_matrix
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id);

UPDATE access_matrix am
  SET department_id = d.id
  FROM departments d
  WHERE d.slug = am.department
    AND am.department_id IS NULL;

CREATE INDEX IF NOT EXISTS access_matrix_department_id_idx
  ON access_matrix (department_id);

-- ── 4. Sync triggers (keep slug <-> id consistent on write) ───
-- During the transition, some writers set the legacy text slug and
-- some will set department_id. These triggers keep both columns in
-- sync no matter which one is provided, preferring department_id as
-- the canonical key when present.

CREATE OR REPLACE FUNCTION sync_employee_department()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.department_id IS NOT NULL THEN
    SELECT slug INTO NEW.department FROM departments WHERE id = NEW.department_id;
  ELSIF NEW.department IS NOT NULL THEN
    SELECT id INTO NEW.department_id FROM departments WHERE slug = NEW.department;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_employee_department ON employees;
CREATE TRIGGER trg_sync_employee_department
  BEFORE INSERT OR UPDATE OF department, department_id ON employees
  FOR EACH ROW EXECUTE FUNCTION sync_employee_department();

CREATE OR REPLACE FUNCTION sync_access_matrix_department()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.department_id IS NOT NULL THEN
    SELECT slug INTO NEW.department FROM departments WHERE id = NEW.department_id;
  ELSIF NEW.department IS NOT NULL THEN
    SELECT id INTO NEW.department_id FROM departments WHERE slug = NEW.department;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_access_matrix_department ON access_matrix;
CREATE TRIGGER trg_sync_access_matrix_department
  BEFORE INSERT OR UPDATE OF department, department_id ON access_matrix
  FOR EACH ROW EXECUTE FUNCTION sync_access_matrix_department();

COMMIT;
