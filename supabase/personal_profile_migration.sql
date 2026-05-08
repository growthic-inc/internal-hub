-- ============================================================
-- Add profile_type to client_entities
-- Distinguishes company pages from personal LinkedIn profiles
-- so the dashboard can render the right view for each entity.
-- Run in Supabase SQL Editor
-- ============================================================

ALTER TABLE client_entities
  ADD COLUMN IF NOT EXISTS profile_type TEXT NOT NULL DEFAULT 'company_page'
  CONSTRAINT profile_type_values CHECK (profile_type IN ('company_page', 'personal_profile'));
