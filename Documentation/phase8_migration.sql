-- ============================================================
-- Growthic One — Phase 8 Migration
-- Home Dashboard, Employee Creation Flow, Profile Completion
-- Run in Supabase SQL Editor ONCE. All operations are idempotent.
-- ============================================================

-- ============================================================
-- 1. EMPLOYEES — add profile completion + personal detail cols
-- ============================================================

-- Profile completion gate: false until the employee fills in their
-- personal details on first login. App blocks access until true.
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS profile_completed BOOLEAN NOT NULL DEFAULT false;

-- Profile detail fields filled during first-login wizard
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS profile_image_url   TEXT;
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS date_of_birth       DATE;
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS personal_email      TEXT;
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS phone               TEXT;
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS address             TEXT;
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS blood_group         TEXT
    CHECK (blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-'));
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS bank_account_number TEXT;
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS bank_ifsc           TEXT;
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS linkedin_url        TEXT;
-- Emergency contact (single record stored inline on the employee row)
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS emergency_contact_name         TEXT;
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS emergency_contact_phone        TEXT;
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS emergency_contact_relationship TEXT;

-- ============================================================
-- 2. RLS — allow employees to update their own record
-- (needed for profile completion wizard to save data)
-- ============================================================

-- Drop any existing self-update policy
DROP POLICY IF EXISTS "employees_self_update" ON public.employees;

-- Allow every authenticated employee to UPDATE their own row.
-- HR / Super Admin updates continue to be covered by any broader
-- admin policies set up during earlier migrations.
CREATE POLICY "employees_self_update" ON public.employees
  FOR UPDATE TO authenticated
  USING (
    email = (auth.jwt() ->> 'email')
  )
  WITH CHECK (
    email = (auth.jwt() ->> 'email')
  );

-- ============================================================
-- 3. Supabase Storage — ensure employee-avatars bucket exists
-- (created in phase7 but idempotent here as a safety check)
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('employee-avatars', 'employee-avatars', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "avatars_public_read"   ON storage.objects;
DROP POLICY IF EXISTS "avatars_auth_upload"   ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_delete"  ON storage.objects;

CREATE POLICY "avatars_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'employee-avatars');

CREATE POLICY "avatars_auth_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'employee-avatars');

CREATE POLICY "avatars_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'employee-avatars');

-- ============================================================
-- 4. Reload PostgREST schema cache
-- ============================================================
SELECT pg_notify('pgrst', 'reload schema');

-- ============================================================
-- 5. Verify (optional — check output)
-- ============================================================
SELECT column_name, data_type, column_default
FROM   information_schema.columns
WHERE  table_name = 'employees'
  AND  column_name IN (
    'profile_completed','profile_image_url',
    'date_of_birth','personal_email','phone',
    'address','blood_group',
    'bank_account_number','bank_ifsc','linkedin_url',
    'emergency_contact_name','emergency_contact_phone','emergency_contact_relationship'
  )
ORDER  BY column_name;
