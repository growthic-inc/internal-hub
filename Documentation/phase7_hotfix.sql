-- ============================================================
-- Growthic One — Phase 7 Hotfix
-- Run in Supabase SQL Editor ONCE to patch missing columns
-- and reload the PostgREST schema cache.
-- Safe to run multiple times — all operations are idempotent.
-- ============================================================

-- ── 1. wfh_quotas: add columns that IF NOT EXISTS missed ──────
-- If the table existed before phase7_migration.sql ran,
-- CREATE TABLE IF NOT EXISTS silently skips it. We add any
-- missing columns manually.

ALTER TABLE public.wfh_quotas
  ADD COLUMN IF NOT EXISTS employee_id UUID REFERENCES public.employees(id);

ALTER TABLE public.wfh_quotas
  ADD COLUMN IF NOT EXISTS created_by  UUID REFERENCES public.employees(id);

-- Re-create partial unique indexes (safe — they use IF NOT EXISTS)
CREATE UNIQUE INDEX IF NOT EXISTS wfh_quota_dept_uidx
  ON public.wfh_quotas (department, month, year)
  WHERE department IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS wfh_quota_emp_uidx
  ON public.wfh_quotas (employee_id, month, year)
  WHERE employee_id IS NOT NULL;

-- ── 2. Reload PostgREST schema cache ─────────────────────────
-- Forces Supabase's API layer to re-read the DB schema so newly
-- added columns are immediately visible to the JS client.
SELECT pg_notify('pgrst', 'reload schema');

-- ── 3. Verify (optional — check output to confirm) ───────────
SELECT column_name, data_type
FROM   information_schema.columns
WHERE  table_name = 'wfh_quotas'
ORDER  BY ordinal_position;
