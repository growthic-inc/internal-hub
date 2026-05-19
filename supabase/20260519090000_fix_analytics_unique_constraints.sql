-- Fix: Include entity_id in analytics table unique constraints
--
-- The old constraints were on (client_id, platform, date) without entity_id.
-- When a client has multiple entities, uploading data for entity A would fail
-- because rows for entity B (or null-entity) sharing the same date already
-- satisfy the unique key.
--
-- Fix: replace each constraint with two partial unique indexes:
--   1. WHERE entity_id IS NULL  → unique on (client_id, platform, date)
--   2. WHERE entity_id IS NOT NULL → unique on (client_id, platform, date, entity_id)
--
-- This allows the same date to have one null-entity row AND one row per entity,
-- with no cross-entity conflicts.
--
-- Same treatment for social_posts (keyed on post_url instead of date),
-- social_followers_daily, and social_visitors_daily.

-- ── social_metrics_daily ─────────────────────────────────────
ALTER TABLE social_metrics_daily
  DROP CONSTRAINT IF EXISTS social_metrics_daily_client_id_platform_date_key;

CREATE UNIQUE INDEX IF NOT EXISTS social_metrics_daily_no_entity_key
  ON social_metrics_daily (client_id, platform, date)
  WHERE entity_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS social_metrics_daily_entity_key
  ON social_metrics_daily (client_id, platform, date, entity_id)
  WHERE entity_id IS NOT NULL;

-- ── social_posts ─────────────────────────────────────────────
ALTER TABLE social_posts
  DROP CONSTRAINT IF EXISTS social_posts_client_id_platform_post_url_key;

CREATE UNIQUE INDEX IF NOT EXISTS social_posts_no_entity_key
  ON social_posts (client_id, platform, post_url)
  WHERE entity_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS social_posts_entity_key
  ON social_posts (client_id, platform, post_url, entity_id)
  WHERE entity_id IS NOT NULL;

-- ── social_followers_daily ───────────────────────────────────
ALTER TABLE social_followers_daily
  DROP CONSTRAINT IF EXISTS social_followers_daily_client_id_platform_date_key;

CREATE UNIQUE INDEX IF NOT EXISTS social_followers_daily_no_entity_key
  ON social_followers_daily (client_id, platform, date)
  WHERE entity_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS social_followers_daily_entity_key
  ON social_followers_daily (client_id, platform, date, entity_id)
  WHERE entity_id IS NOT NULL;

-- ── social_visitors_daily ────────────────────────────────────
ALTER TABLE social_visitors_daily
  DROP CONSTRAINT IF EXISTS social_visitors_daily_client_id_platform_date_key;

CREATE UNIQUE INDEX IF NOT EXISTS social_visitors_daily_no_entity_key
  ON social_visitors_daily (client_id, platform, date)
  WHERE entity_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS social_visitors_daily_entity_key
  ON social_visitors_daily (client_id, platform, date, entity_id)
  WHERE entity_id IS NOT NULL;

-- ── Upload access: elevate business_development to can_upload ─
-- Previously set to view_only (level 1), blocking the Upload button
-- for BD team members who need to upload client performance data.
UPDATE access_matrix
SET    access_level = 'can_upload'
WHERE  module       = 'client_dashboard'
  AND  feature      = 'upload_performance_data'
  AND  department   = 'business_development';
