-- ============================================================
-- Knowledge Labs — resource-level access grants + real owner FK
--
-- Grants now target one specific resource (a single SOP/Template),
-- not an entire department — department_id is dropped from the
-- grants table since it's derivable via resource_id. Only test
-- rows exist so far, safe to restructure cleanly.
--
-- knowledge_resources.owner becomes a real employee FK instead
-- of free text, to avoid typo drift.
-- ============================================================

BEGIN;

-- ── knowledge_access_grants: resource-level ──────────────────
-- Drop the old policy first — it reads department_id and would
-- otherwise block dropping that column.
DROP POLICY IF EXISTS kr_select ON knowledge_resources;

DELETE FROM knowledge_access_grants;

ALTER TABLE knowledge_access_grants
  DROP CONSTRAINT IF EXISTS knowledge_access_grants_employee_id_department_id_key;

ALTER TABLE knowledge_access_grants
  DROP COLUMN IF EXISTS department_id;

ALTER TABLE knowledge_access_grants
  ADD COLUMN resource_id UUID NOT NULL REFERENCES knowledge_resources(id) ON DELETE CASCADE;

ALTER TABLE knowledge_access_grants
  ADD CONSTRAINT knowledge_access_grants_employee_id_resource_id_key UNIQUE (employee_id, resource_id);

CREATE INDEX IF NOT EXISTS knowledge_access_grants_resource_id_idx
  ON knowledge_access_grants (resource_id);

-- ── knowledge_resources: read (grant branch now resource-level) ──
CREATE POLICY kr_select ON knowledge_resources FOR SELECT TO authenticated
  USING (
    _is_dept_admin()
    OR (
      published
      AND (
        department_id = (SELECT department_id FROM employees WHERE email = auth.email())
        OR id IN (
          SELECT resource_id FROM knowledge_access_grants
          WHERE employee_id = (SELECT id FROM employees WHERE email = auth.email())
            AND revoked_at IS NULL
        )
      )
    )
  );

-- ── knowledge_resources: owner becomes a real employee FK ────
ALTER TABLE knowledge_resources DROP COLUMN IF EXISTS owner;
ALTER TABLE knowledge_resources ADD COLUMN owner_id UUID REFERENCES employees(id);

COMMIT;
