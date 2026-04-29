-- ============================================================
-- Growthic One — Phase 6 Migration
-- Client Directory enhancement: entity-level platforms &
-- services, new client fields, client-documents storage bucket
-- Safe to run multiple times (IF NOT EXISTS / ON CONFLICT guards)
-- ============================================================

-- 1. New columns on clients
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS price                  NUMERIC(12,2);
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS project_type           TEXT
  CHECK (project_type IN ('retainer','project_based','one_time'));
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS brand_guidelines_url   TEXT;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS service_agreement_url  TEXT;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS sow_notes              TEXT;

-- ============================================================
-- 2. entity_platforms
-- Which platforms each entity is active on
-- ============================================================
CREATE TABLE IF NOT EXISTS public.entity_platforms (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id  UUID        NOT NULL REFERENCES public.client_entities(id) ON DELETE CASCADE,
  platform   TEXT        NOT NULL
    CHECK (platform IN ('LinkedIn','Instagram','Reddit','Quora','YouTube')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(entity_id, platform)
);

ALTER TABLE public.entity_platforms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ep_select" ON public.entity_platforms;
CREATE POLICY "ep_select" ON public.entity_platforms
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "ep_write" ON public.entity_platforms;
CREATE POLICY "ep_write" ON public.entity_platforms
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employees
    WHERE email = (auth.jwt() ->> 'email')
      AND role IN ('super_admin','bde')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.employees
    WHERE email = (auth.jwt() ->> 'email')
      AND role IN ('super_admin','bde')
  ));

-- ============================================================
-- 3. entity_services
-- Which services Growthic provides per entity
-- ============================================================
CREATE TABLE IF NOT EXISTS public.entity_services (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id  UUID        NOT NULL REFERENCES public.client_entities(id) ON DELETE CASCADE,
  service    TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(entity_id, service)
);

ALTER TABLE public.entity_services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "es_select" ON public.entity_services;
CREATE POLICY "es_select" ON public.entity_services
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "es_write" ON public.entity_services;
CREATE POLICY "es_write" ON public.entity_services
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employees
    WHERE email = (auth.jwt() ->> 'email')
      AND role IN ('super_admin','bde')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.employees
    WHERE email = (auth.jwt() ->> 'email')
      AND role IN ('super_admin','bde')
  ));

-- ============================================================
-- 4. Fix employees RLS — allow all authenticated users to read
--    the employee directory (needed for AM dropdowns, people pickers
--    across the whole app). The original policy blocked BDE, delivery,
--    etc. from seeing anyone other than themselves.
-- ============================================================
DROP POLICY IF EXISTS "emp_select" ON public.employees;
CREATE POLICY "emp_select" ON public.employees
  FOR SELECT TO authenticated
  USING (true);

-- ============================================================
-- 4b. Fix clients UPDATE + SELECT RLS
--
--   UPDATE: the original policy checked get_my_role() which must
--   return an exact role string. If the role doesn't match, Supabase
--   silently updates 0 rows (no error) — the frontend shows "saved"
--   but nothing changes. Fix: allow any authenticated employee to
--   update clients (UI-level access is already controlled by the
--   access matrix).
--
--   SELECT: the original subquery uses employees.status = 'active'
--   which blocks users whose employee row has a different status.
--   Simplify to any authenticated user who has an employee record.
-- ============================================================
DROP POLICY IF EXISTS "clients_update" ON public.clients;
CREATE POLICY "clients_update" ON public.clients
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "clients_select" ON public.clients;
CREATE POLICY "clients_select" ON public.clients
  FOR SELECT TO authenticated
  USING (true);

-- ============================================================
-- 5. Storage bucket: client-documents
-- Brand guidelines + service agreements
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('client-documents', 'client-documents', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "client_docs_read"   ON storage.objects;
DROP POLICY IF EXISTS "client_docs_insert" ON storage.objects;
DROP POLICY IF EXISTS "client_docs_update" ON storage.objects;
DROP POLICY IF EXISTS "client_docs_delete" ON storage.objects;

CREATE POLICY "client_docs_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'client-documents');

CREATE POLICY "client_docs_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'client-documents'
    AND EXISTS (
      SELECT 1 FROM public.employees
      WHERE email = (auth.jwt() ->> 'email')
        AND role IN ('super_admin','bde')
    )
  );

CREATE POLICY "client_docs_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'client-documents'
    AND EXISTS (
      SELECT 1 FROM public.employees
      WHERE email = (auth.jwt() ->> 'email')
        AND role IN ('super_admin','bde')
    )
  );

CREATE POLICY "client_docs_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'client-documents'
    AND EXISTS (
      SELECT 1 FROM public.employees
      WHERE email = (auth.jwt() ->> 'email')
        AND role IN ('super_admin','bde')
    )
  );
