-- ============================================================
-- Fix duplicate employee rows + prevent future duplicates
--
-- Root cause: HR submitted the Add Employee form more than once,
-- creating two auth.users entries AND two employees rows for the
-- same email. PostgREST's .single() returns 406 when it finds
-- multiple rows, causing getCurrentUser() to return null and
-- log the user out immediately.
--
-- Step 1: Review duplicates (run this first to see what exists)
-- Step 2: Delete the duplicate row(s), keeping the one whose
--         id matches the employee's Supabase Auth UID
-- Step 3: Add UNIQUE constraint on employees.email
--
-- Run in Supabase SQL Editor
-- ============================================================

-- ── STEP 1: See all duplicate emails ─────────────────────────
SELECT email, COUNT(*) AS row_count, array_agg(id) AS ids
FROM employees
GROUP BY email
HAVING COUNT(*) > 1;

-- ── STEP 2: Delete duplicate rows ────────────────────────────
-- Keeps the row with the LOWEST id (the first insert).
-- If you know the correct auth UID for the employee, replace
-- the subquery with that specific id to be safe.
DELETE FROM employees
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY email ORDER BY created_at ASC NULLS LAST, id ASC) AS rn
    FROM employees
  ) ranked
  WHERE rn > 1
);

-- ── STEP 3: Add unique constraint to prevent recurrence ──────
ALTER TABLE employees
  ADD CONSTRAINT employees_email_unique UNIQUE (email);
