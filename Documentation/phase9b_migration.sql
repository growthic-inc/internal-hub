-- ============================================================
-- Growthic One — Phase 9b Migration
-- Social Analytics: Followers, Visitors, Audience Demographics
-- Run in Supabase SQL Editor ONCE after phase9_migration.sql.
-- ============================================================

-- ============================================================
-- 1. social_followers_daily
--    One row per client + platform + date.
--    Source: LinkedIn "New followers" sheet / Instagram equivalent.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.social_followers_daily (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  platform    TEXT NOT NULL CHECK (platform IN ('linkedin', 'instagram')),
  date        DATE NOT NULL,

  sponsored_followers     INT NOT NULL DEFAULT 0,
  organic_followers       INT NOT NULL DEFAULT 0,
  auto_invited_followers  INT NOT NULL DEFAULT 0,  -- LinkedIn specific
  total_new_followers     INT NOT NULL DEFAULT 0,

  uploaded_by  UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (client_id, platform, date)
);

-- ============================================================
-- 2. social_visitors_daily
--    One row per client + platform + date.
--    Source: LinkedIn "Visitor metrics" sheet (25 columns).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.social_visitors_daily (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  platform    TEXT NOT NULL CHECK (platform IN ('linkedin', 'instagram')),
  date        DATE NOT NULL,

  -- Overview page (company home tab)
  overview_views_desktop   INT NOT NULL DEFAULT 0,
  overview_views_mobile    INT NOT NULL DEFAULT 0,
  overview_views_total     INT NOT NULL DEFAULT 0,
  overview_unique_desktop  INT NOT NULL DEFAULT 0,
  overview_unique_mobile   INT NOT NULL DEFAULT 0,
  overview_unique_total    INT NOT NULL DEFAULT 0,

  -- Life page (culture tab)
  life_views_desktop   INT NOT NULL DEFAULT 0,
  life_views_mobile    INT NOT NULL DEFAULT 0,
  life_views_total     INT NOT NULL DEFAULT 0,
  life_unique_desktop  INT NOT NULL DEFAULT 0,
  life_unique_mobile   INT NOT NULL DEFAULT 0,
  life_unique_total    INT NOT NULL DEFAULT 0,

  -- Jobs page
  jobs_views_desktop   INT NOT NULL DEFAULT 0,
  jobs_views_mobile    INT NOT NULL DEFAULT 0,
  jobs_views_total     INT NOT NULL DEFAULT 0,
  jobs_unique_desktop  INT NOT NULL DEFAULT 0,
  jobs_unique_mobile   INT NOT NULL DEFAULT 0,
  jobs_unique_total    INT NOT NULL DEFAULT 0,

  -- Combined total across all sections
  total_views_desktop   INT NOT NULL DEFAULT 0,
  total_views_mobile    INT NOT NULL DEFAULT 0,
  total_views_total     INT NOT NULL DEFAULT 0,
  total_unique_desktop  INT NOT NULL DEFAULT 0,
  total_unique_mobile   INT NOT NULL DEFAULT 0,
  total_unique_total    INT NOT NULL DEFAULT 0,

  uploaded_by  UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (client_id, platform, date)
);

-- ============================================================
-- 3. social_audience_demographics
--    Snapshot (not timeseries) — replaces entirely on each upload.
--    EAV model: one row per client + platform + export_type + dimension + label.
--    Covers both followers file and visitors file demographic breakdowns.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.social_audience_demographics (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  platform     TEXT NOT NULL CHECK (platform IN ('linkedin', 'instagram')),
  export_type  TEXT NOT NULL CHECK (export_type IN ('followers', 'visitors')),
  dimension    TEXT NOT NULL CHECK (dimension IN (
                 'location', 'job_function', 'seniority', 'industry', 'company_size'
               )),
  label        TEXT NOT NULL,   -- e.g. 'Greater Delhi Area, India'
  value        INT  NOT NULL DEFAULT 0,   -- total count for this label

  uploaded_by  UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 4. Extend analytics_upload_log with new columns
-- ============================================================
ALTER TABLE public.analytics_upload_log
  ADD COLUMN IF NOT EXISTS data_type TEXT,     -- 'content' | 'followers' | 'visitors'
  ADD COLUMN IF NOT EXISTS drive_url TEXT;     -- Google Drive URL of the raw uploaded file

-- ============================================================
-- 5. Row Level Security
-- ============================================================
ALTER TABLE public.social_followers_daily     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_visitors_daily      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_audience_demographics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sfd_select"  ON public.social_followers_daily;
DROP POLICY IF EXISTS "sfd_insert"  ON public.social_followers_daily;
DROP POLICY IF EXISTS "sfd_delete"  ON public.social_followers_daily;

DROP POLICY IF EXISTS "svd_select"  ON public.social_visitors_daily;
DROP POLICY IF EXISTS "svd_insert"  ON public.social_visitors_daily;
DROP POLICY IF EXISTS "svd_delete"  ON public.social_visitors_daily;

DROP POLICY IF EXISTS "sad_select"  ON public.social_audience_demographics;
DROP POLICY IF EXISTS "sad_insert"  ON public.social_audience_demographics;
DROP POLICY IF EXISTS "sad_delete"  ON public.social_audience_demographics;

CREATE POLICY "sfd_select" ON public.social_followers_daily FOR SELECT TO authenticated USING (true);
CREATE POLICY "sfd_insert" ON public.social_followers_daily FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "sfd_delete" ON public.social_followers_daily FOR DELETE TO authenticated USING (true);

CREATE POLICY "svd_select" ON public.social_visitors_daily FOR SELECT TO authenticated USING (true);
CREATE POLICY "svd_insert" ON public.social_visitors_daily FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "svd_delete" ON public.social_visitors_daily FOR DELETE TO authenticated USING (true);

CREATE POLICY "sad_select" ON public.social_audience_demographics FOR SELECT TO authenticated USING (true);
CREATE POLICY "sad_insert" ON public.social_audience_demographics FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "sad_delete" ON public.social_audience_demographics FOR DELETE TO authenticated USING (true);

-- ============================================================
-- 6. Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_sfd_client_platform_date
  ON public.social_followers_daily (client_id, platform, date);

CREATE INDEX IF NOT EXISTS idx_svd_client_platform_date
  ON public.social_visitors_daily (client_id, platform, date);

CREATE INDEX IF NOT EXISTS idx_sad_client_platform_type_dim
  ON public.social_audience_demographics (client_id, platform, export_type, dimension);

-- ============================================================
-- 7. Reload PostgREST schema cache
-- ============================================================
SELECT pg_notify('pgrst', 'reload schema');

-- ============================================================
-- 8. Verify
-- ============================================================
SELECT table_name, COUNT(*) AS columns
FROM information_schema.columns
WHERE table_name IN (
  'social_followers_daily', 'social_visitors_daily', 'social_audience_demographics'
)
  AND table_schema = 'public'
GROUP BY table_name
ORDER BY table_name;
