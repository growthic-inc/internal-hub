-- ============================================================
-- Ensure profile_completed defaults to FALSE for new employees
-- so the onboarding wizard always triggers correctly.
--
-- Previously the column had no default (NULL), which caused the
-- JS check `profile_completed === false` to never match for
-- employees created via the create-employee Edge Function.
--
-- The JS check has been updated to `!profile_completed` (falsy),
-- but this migration also back-fills any existing NULL rows so
-- those employees are prompted to complete their profile too.
--
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Set column default to FALSE
ALTER TABLE employees
  ALTER COLUMN profile_completed SET DEFAULT FALSE;

-- 2. Back-fill NULL rows → FALSE so they're prompted on next login
UPDATE employees
  SET profile_completed = FALSE
  WHERE profile_completed IS NULL;
