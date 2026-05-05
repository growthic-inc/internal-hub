/* ============================================================
   BADGES — One-time tenure cleanup
   Run this once after initial rollout.
   Keeps only the HIGHEST tenure badge per employee,
   removes all lower-tier ones that were inserted silently.
   ============================================================ */

WITH ranked AS (
  SELECT
    eb.id,
    eb.employee_id,
    b.name,
    b.criteria_months,
    ROW_NUMBER() OVER (
      PARTITION BY eb.employee_id
      ORDER BY b.criteria_months DESC NULLS LAST
    ) AS rn
  FROM employee_badges eb
  JOIN badges b ON b.id = eb.badge_id
  WHERE b.category = 'tenure'
)
DELETE FROM employee_badges
WHERE id IN (
  SELECT id FROM ranked WHERE rn > 1
);
