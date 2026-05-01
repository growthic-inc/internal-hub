-- ============================================================
-- WFH Work Plan Migration
-- Run in Supabase SQL Editor
-- ============================================================

ALTER TABLE wfh_requests
  ADD COLUMN IF NOT EXISTS work_plan text;
