-- Fix: Drop incorrect entity_id triggers on all analytics tables
--
-- The trigger function set_entity_id_from_client_id() was setting
-- entity_id = client_id when entity_id IS NULL on insert/update.
-- client_id is a UUID from the 'clients' table, not 'client_entities',
-- so it always violated the social_metrics_daily_entity_id_fkey constraint
-- for any client without entities, blocking all analytics uploads.
--
-- The upload code (ingest-analytics edge function) already handles entity_id
-- correctly (null for no entity, or a real client_entities.id when selected),
-- so these triggers are unnecessary and harmful.

DROP TRIGGER IF EXISTS trg_entity_id_social_metrics_daily         ON social_metrics_daily;
DROP TRIGGER IF EXISTS trg_entity_id_social_posts                 ON social_posts;
DROP TRIGGER IF EXISTS trg_entity_id_social_followers_daily       ON social_followers_daily;
DROP TRIGGER IF EXISTS trg_entity_id_social_visitors_daily        ON social_visitors_daily;
DROP TRIGGER IF EXISTS trg_entity_id_social_audience_demographics ON social_audience_demographics;
DROP FUNCTION IF EXISTS set_entity_id_from_client_id();
