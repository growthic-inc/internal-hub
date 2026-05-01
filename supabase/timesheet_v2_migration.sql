-- ============================================================
-- TIMESHEET v2 Migration
-- Adds entity_id, activity_type, work_description columns
-- Run in Supabase SQL editor
-- ============================================================

ALTER TABLE timesheets
  ADD COLUMN IF NOT EXISTS entity_id        uuid REFERENCES client_entities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS activity_type    text,
  ADD COLUMN IF NOT EXISTS work_description text,
  ADD COLUMN IF NOT EXISTS acted_at         timestamptz;

-- Index for entity lookups
CREATE INDEX IF NOT EXISTS idx_timesheets_entity_id ON timesheets(entity_id);
