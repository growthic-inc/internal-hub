-- ============================================================
-- Knowledge Labs — company-wide resources ("Growthic") + Guide category
--
-- department_id becomes optional: NULL means the resource applies
-- to everyone, not one department ("Growthic" in the UI — a
-- synthetic option, not a real departments row, so it can never
-- drift if departments get renamed/reorganized).
--
-- category widens to also accept 'Guide', for reference/culture
-- material that isn't a step-by-step SOP or a fill-in Template.
--
-- GOTCHA for future code: any query joining knowledge_resources to
-- departments must use a LEFT JOIN, not an inner join — an inner
-- join silently drops every company-wide (NULL department) row.
-- ============================================================

BEGIN;

ALTER TABLE knowledge_resources ALTER COLUMN department_id DROP NOT NULL;

ALTER TABLE knowledge_resources DROP CONSTRAINT IF EXISTS knowledge_resources_category_check;
ALTER TABLE knowledge_resources ADD CONSTRAINT knowledge_resources_category_check
  CHECK (category = ANY (ARRAY['SOP'::text, 'Template'::text, 'Guide'::text]));

-- ── knowledge_resources: read (company-wide branch added) ────
DROP POLICY IF EXISTS kr_select ON knowledge_resources;
CREATE POLICY kr_select ON knowledge_resources FOR SELECT TO authenticated
  USING (
    is_admin()
    OR (
      published
      AND (
        department_id IS NULL
        OR department_id = (SELECT department_id FROM employees WHERE email = auth.email())
        OR id IN (
          SELECT resource_id FROM knowledge_access_grants
          WHERE employee_id = (SELECT id FROM employees WHERE email = auth.email())
            AND revoked_at IS NULL
        )
      )
    )
  );

COMMIT;
