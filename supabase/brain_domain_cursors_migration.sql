-- ============================================================
-- Brain — Domain cursors migration
-- Adds per-domain backfill cursor so brain-sync can paginate
-- through Gmail search results for a specific client domain
-- across multiple calls (e.g. dhoomimalgallery.com).
-- ============================================================

ALTER TABLE brain_sync_state
  ADD COLUMN IF NOT EXISTS domain_cursors JSONB DEFAULT '{}';
