-- ============================================================
-- Normalise employee emails to lowercase
--
-- Supabase Auth always stores emails in lowercase. If HR entered
-- an email with capitals (e.g. "Ananya@company.com"), the employees
-- table stored that casing while auth.users stored "ananya@company.com".
-- The case-sensitive .eq() in getCurrentUser() returned 0 rows → 406.
--
-- The JS query has been updated to use .ilike() (case-insensitive),
-- but we also normalise existing rows so email lookups, the UNIQUE
-- constraint, and future queries all behave consistently.
--
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Preview what will change
SELECT id, email, LOWER(email) AS normalised
FROM employees
WHERE email <> LOWER(email);

-- 2. Normalise all emails to lowercase
UPDATE employees
SET email = LOWER(email)
WHERE email <> LOWER(email);
