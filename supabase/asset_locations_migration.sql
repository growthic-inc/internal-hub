-- ============================================================
-- Asset Locations — manageable location list for Asset Management
-- Run in Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS asset_locations (
  id         uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  name       text    NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

-- Seed some sensible defaults
INSERT INTO asset_locations (name) VALUES
  ('Head Office'),
  ('Remote / Work From Home'),
  ('Warehouse'),
  ('Employee Home')
ON CONFLICT (name) DO NOTHING;
