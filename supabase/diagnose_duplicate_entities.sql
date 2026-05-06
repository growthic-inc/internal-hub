-- ============================================================
-- Diagnose duplicate client_entities rows
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. See all entity rows for each client — spot duplicates
SELECT
  c.client_name,
  c.project_code,
  ce.entity_name,
  ce.id         AS entity_id,
  ce.created_at
FROM client_entities ce
JOIN clients c ON c.id = ce.client_id
ORDER BY c.client_name, ce.entity_name, ce.created_at;

-- 2. Count duplicates per client — any count > expected = problem
SELECT
  c.client_name,
  c.project_code,
  ce.entity_name,
  COUNT(*)      AS row_count
FROM client_entities ce
JOIN clients c ON c.id = ce.client_id
GROUP BY c.client_name, c.project_code, ce.entity_name
HAVING COUNT(*) > 1
ORDER BY row_count DESC;

-- 3. Clean up: keep the OLDEST row per (client_id, entity_name),
--    delete all newer duplicates.
--    ⚠️  Review results from queries 1 & 2 first before running this.
/*
DELETE FROM client_entities
WHERE id IN (
  SELECT id FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY client_id, entity_name
        ORDER BY created_at ASC   -- keep the oldest
      ) AS rn
    FROM client_entities
  ) ranked
  WHERE rn > 1
);
*/
