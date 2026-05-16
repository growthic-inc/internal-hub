-- ============================================================
-- Brain — Backfill migration
-- Adds per-employee backfill cursor so brain-sync can paginate
-- through Gmail history 100 threads at a time across multiple calls.
-- ============================================================

ALTER TABLE brain_sync_state
  ADD COLUMN IF NOT EXISTS backfill_cursor   text,      -- Gmail nextPageToken for backfill pagination
  ADD COLUMN IF NOT EXISTS backfill_complete boolean NOT NULL DEFAULT false;
