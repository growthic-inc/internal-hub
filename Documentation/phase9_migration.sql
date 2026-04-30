-- ============================================================
-- Growthic One — Phase 9 Migration
-- Social Analytics: client performance data ingestion
-- Run in Supabase SQL Editor ONCE. All operations are idempotent.
-- ============================================================

-- ============================================================
-- 1. social_metrics_daily
--    One row per client + platform + date.
--    Common columns populated for both LinkedIn and Instagram.
--    Platform-specific columns are nullable.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.social_metrics_daily (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  platform    TEXT NOT NULL CHECK (platform IN ('linkedin', 'instagram')),
  date        DATE NOT NULL,

  -- ── Common / normalised columns (both platforms) ──────────
  impressions       INT  NOT NULL DEFAULT 0,
  reach             INT  NOT NULL DEFAULT 0,  -- unique viewers
  clicks            INT  NOT NULL DEFAULT 0,
  reactions         INT  NOT NULL DEFAULT 0,  -- likes / reactions
  comments          INT  NOT NULL DEFAULT 0,
  reposts_shares    INT  NOT NULL DEFAULT 0,
  follows           INT  NOT NULL DEFAULT 0,  -- new followers that day
  engagement_rate   NUMERIC(10,8) NOT NULL DEFAULT 0,  -- 0–1 decimal

  -- ── LinkedIn-specific: organic vs sponsored split ─────────
  impressions_organic         INT,
  impressions_sponsored       INT,
  unique_impressions_organic  INT,
  clicks_organic              INT,
  clicks_sponsored            INT,
  reactions_organic           INT,
  reactions_sponsored         INT,
  comments_organic            INT,
  comments_sponsored          INT,
  reposts_organic             INT,
  reposts_sponsored           INT,
  engagement_rate_organic     NUMERIC(10,8),
  engagement_rate_sponsored   NUMERIC(10,8),

  -- ── Instagram-specific ───────────────────────────────────
  profile_visits   INT,
  website_clicks   INT,
  saves            INT,

  -- ── Upload metadata ───────────────────────────────────────
  uploaded_by  UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (client_id, platform, date)
);

-- ============================================================
-- 2. social_posts
--    One row per client + platform + post URL.
--    Covers both LinkedIn and Instagram post-level metrics.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.social_posts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  platform    TEXT NOT NULL CHECK (platform IN ('linkedin', 'instagram')),

  post_url            TEXT,
  post_title          TEXT,
  post_type           TEXT,    -- Organic / Sponsored / Reel / Story
  content_type        TEXT,    -- Video / Image / Carousel / Text
  campaign_name       TEXT,
  posted_by           TEXT,
  created_date        DATE,
  campaign_start_date DATE,
  campaign_end_date   DATE,
  audience            TEXT,

  -- ── Engagement metrics (common) ───────────────────────────
  impressions     INT  NOT NULL DEFAULT 0,
  views           INT  NOT NULL DEFAULT 0,
  offsite_views   INT  NOT NULL DEFAULT 0,
  clicks          INT  NOT NULL DEFAULT 0,
  ctr             NUMERIC(10,8) NOT NULL DEFAULT 0,  -- 0–1 decimal
  likes           INT  NOT NULL DEFAULT 0,
  comments        INT  NOT NULL DEFAULT 0,
  reposts_shares  INT  NOT NULL DEFAULT 0,
  follows         INT  NOT NULL DEFAULT 0,
  saves           INT  NOT NULL DEFAULT 0,  -- Instagram saves
  engagement_rate NUMERIC(10,8) NOT NULL DEFAULT 0,

  -- ── Upload metadata ───────────────────────────────────────
  uploaded_by  UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (client_id, platform, post_url)
);

-- ============================================================
-- 3. analytics_upload_log
--    Audit trail of every upload (who, when, what date range).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.analytics_upload_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  platform       TEXT NOT NULL,
  metrics_from   DATE,
  metrics_to     DATE,
  posts_from     DATE,
  posts_to       DATE,
  metrics_count  INT NOT NULL DEFAULT 0,
  posts_count    INT NOT NULL DEFAULT 0,
  uploaded_by    UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 4. Row Level Security
-- ============================================================
ALTER TABLE public.social_metrics_daily  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_posts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_upload_log  ENABLE ROW LEVEL SECURITY;

-- Drop and recreate to ensure idempotency
DROP POLICY IF EXISTS "smd_select"  ON public.social_metrics_daily;
DROP POLICY IF EXISTS "smd_insert"  ON public.social_metrics_daily;
DROP POLICY IF EXISTS "smd_delete"  ON public.social_metrics_daily;

DROP POLICY IF EXISTS "sp_select"   ON public.social_posts;
DROP POLICY IF EXISTS "sp_insert"   ON public.social_posts;
DROP POLICY IF EXISTS "sp_delete"   ON public.social_posts;

DROP POLICY IF EXISTS "aul_select"  ON public.analytics_upload_log;
DROP POLICY IF EXISTS "aul_insert"  ON public.analytics_upload_log;

-- SELECT: all authenticated employees can read analytics
CREATE POLICY "smd_select" ON public.social_metrics_daily
  FOR SELECT TO authenticated USING (true);

-- INSERT / DELETE: authenticated (access enforcement happens in the Edge Function
-- which uses the service role key after verifying the caller's role)
CREATE POLICY "smd_insert" ON public.social_metrics_daily
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "smd_delete" ON public.social_metrics_daily
  FOR DELETE TO authenticated USING (true);

CREATE POLICY "sp_select" ON public.social_posts
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "sp_insert" ON public.social_posts
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "sp_delete" ON public.social_posts
  FOR DELETE TO authenticated USING (true);

CREATE POLICY "aul_select" ON public.analytics_upload_log
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "aul_insert" ON public.analytics_upload_log
  FOR INSERT TO authenticated WITH CHECK (true);

-- ============================================================
-- 5. Indexes for common query patterns
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_smd_client_platform_date
  ON public.social_metrics_daily (client_id, platform, date);

CREATE INDEX IF NOT EXISTS idx_sp_client_platform_date
  ON public.social_posts (client_id, platform, created_date);

CREATE INDEX IF NOT EXISTS idx_sp_engagement_rate
  ON public.social_posts (client_id, platform, engagement_rate DESC);

-- ============================================================
-- 6. Reload PostgREST schema cache
-- ============================================================
SELECT pg_notify('pgrst', 'reload schema');

-- ============================================================
-- 7. Verify
-- ============================================================
SELECT table_name, COUNT(*) AS columns
FROM information_schema.columns
WHERE table_name IN ('social_metrics_daily', 'social_posts', 'analytics_upload_log')
  AND table_schema = 'public'
GROUP BY table_name
ORDER BY table_name;
