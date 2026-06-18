-- ============================================================
-- Department Management — Phase 2 (add / rename RPCs)
--
-- Provides atomic, permission-checked operations for managing
-- departments from the frontend:
--
--   create_department(name)        -> inserts the department AND
--                                     seeds the access matrix with
--                                     no_access for every known
--                                     (module, feature) pair.
--   rename_department(id, name)    -> updates name + regenerates
--                                     slug, and cascades the new
--                                     slug to the legacy slug columns
--                                     on employees + access_matrix.
--                                     system_key is NEVER changed.
--
-- Both are SECURITY DEFINER: they bypass RLS for the write (HR can
-- write `departments` but not `access_matrix`), while an internal
-- guard restricts callers to super_admin or People & Culture.
-- ============================================================

BEGIN;

-- ── slugify: lowercase, alphanumeric + underscore only ────────
-- "Operations & Growth" -> "operations_growth"
CREATE OR REPLACE FUNCTION slugify(txt TEXT)
RETURNS TEXT AS $$
  SELECT trim(both '_' from
    regexp_replace(lower(coalesce(trim(txt), '')), '[^a-z0-9]+', '_', 'g')
  );
$$ LANGUAGE sql IMMUTABLE;

-- ── authorization guard (mirrors dept_write: super_admin or HR) ─
CREATE OR REPLACE FUNCTION _is_dept_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM employees e
    LEFT JOIN departments d ON d.id = e.department_id
    WHERE e.email = (auth.jwt() ->> 'email')
      AND (e.role = 'super_admin' OR d.system_key = 'people_culture')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── create_department ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_department(p_name TEXT)
RETURNS departments AS $$
DECLARE
  v_slug TEXT;
  v_dept departments;
BEGIN
  IF NOT _is_dept_admin() THEN
    RAISE EXCEPTION 'Not authorised to manage departments';
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Department name is required';
  END IF;

  v_slug := slugify(p_name);
  IF v_slug = '' THEN
    RAISE EXCEPTION 'Department name must contain letters or numbers';
  END IF;

  IF EXISTS (SELECT 1 FROM departments WHERE slug = v_slug) THEN
    RAISE EXCEPTION 'A department with this name already exists';
  END IF;

  -- slug doubles as the immutable system_key for brand-new departments
  INSERT INTO departments (slug, name, system_key)
  VALUES (v_slug, trim(p_name), v_slug)
  RETURNING * INTO v_dept;

  -- Seed the access matrix: one no_access row per known (module, feature).
  INSERT INTO access_matrix (department, department_id, module, feature, access_level)
  SELECT v_slug, v_dept.id, m.module, m.feature, 'no_access'
  FROM (SELECT DISTINCT module, feature FROM access_matrix) m;

  RETURN v_dept;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── rename_department ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION rename_department(p_id UUID, p_name TEXT)
RETURNS departments AS $$
DECLARE
  v_slug TEXT;
  v_dept departments;
BEGIN
  IF NOT _is_dept_admin() THEN
    RAISE EXCEPTION 'Not authorised to manage departments';
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Department name is required';
  END IF;

  v_slug := slugify(p_name);
  IF v_slug = '' THEN
    RAISE EXCEPTION 'Department name must contain letters or numbers';
  END IF;

  -- slug must be unique across all OTHER departments
  IF EXISTS (SELECT 1 FROM departments WHERE slug = v_slug AND id <> p_id) THEN
    RAISE EXCEPTION 'A department with this name already exists';
  END IF;

  UPDATE departments
  SET name = trim(p_name), slug = v_slug
  WHERE id = p_id
  RETURNING * INTO v_dept;

  IF v_dept.id IS NULL THEN
    RAISE EXCEPTION 'Department not found';
  END IF;

  -- Cascade the new slug to the legacy slug columns so anything still
  -- reading them stays consistent (dropped in Phase 4). department_id
  -- and system_key are untouched, so all relationships survive.
  UPDATE employees     SET department = v_slug WHERE department_id = p_id;
  UPDATE access_matrix SET department = v_slug WHERE department_id = p_id;

  RETURN v_dept;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION create_department(TEXT)        TO authenticated;
GRANT EXECUTE ON FUNCTION rename_department(UUID, TEXT)  TO authenticated;

COMMIT;
