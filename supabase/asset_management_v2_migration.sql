-- ============================================================
-- ASSET MANAGEMENT v2 Migration
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Add new columns to existing assets table
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS asset_tag      text,
  ADD COLUMN IF NOT EXISTS location       text,
  ADD COLUMN IF NOT EXISTS purchase_date  date,
  ADD COLUMN IF NOT EXISTS purchase_price numeric,
  ADD COLUMN IF NOT EXISTS vendor         text;

-- 2. Asset types (admin-configurable)
CREATE TABLE IF NOT EXISTS asset_types (
  id         uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text    NOT NULL UNIQUE,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

INSERT INTO asset_types (name, is_default) VALUES
  ('Laptop',   true), ('Phone',   true), ('Monitor',  true),
  ('Keyboard', true), ('Mouse',   true), ('Headset',  true),
  ('Camera',   true), ('Other',   true)
ON CONFLICT (name) DO NOTHING;

-- 3. Asset history log
CREATE TABLE IF NOT EXISTS asset_history (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id         uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  action           text NOT NULL,
  -- created | assigned | returned | condition_updated | photo_added | lost | retired | repair_logged | repair_resolved
  from_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  to_employee_id   uuid REFERENCES employees(id) ON DELETE SET NULL,
  condition_before text,
  condition_after  text,
  notes            text,
  photo_url        text,   -- Google Drive link
  performed_by     uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_history_asset_id   ON asset_history(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_history_created_at ON asset_history(created_at DESC);

-- 4. Asset repairs & issues
CREATE TABLE IF NOT EXISTS asset_repairs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id         uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  reported_by      uuid REFERENCES employees(id) ON DELETE SET NULL,
  type             text NOT NULL DEFAULT 'issue',   -- 'issue' | 'repair'
  description      text NOT NULL,
  status           text NOT NULL DEFAULT 'open',    -- 'open' | 'in_progress' | 'resolved'
  cost             numeric,
  vendor           text,
  photo_url        text,
  resolution_notes text,
  resolved_at      timestamptz,
  resolved_by      uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_repairs_asset_id ON asset_repairs(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_repairs_status   ON asset_repairs(status);

-- 5. Enable RLS
ALTER TABLE asset_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_repairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_types   ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies (access control enforced in app layer)
-- asset_history
DROP POLICY IF EXISTS ah_select ON asset_history;
DROP POLICY IF EXISTS ah_insert ON asset_history;
CREATE POLICY ah_select ON asset_history FOR SELECT TO authenticated USING (true);
CREATE POLICY ah_insert ON asset_history FOR INSERT TO authenticated WITH CHECK (true);

-- asset_repairs
DROP POLICY IF EXISTS ar_select ON asset_repairs;
DROP POLICY IF EXISTS ar_insert ON asset_repairs;
DROP POLICY IF EXISTS ar_update ON asset_repairs;
CREATE POLICY ar_select ON asset_repairs FOR SELECT TO authenticated USING (true);
CREATE POLICY ar_insert ON asset_repairs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY ar_update ON asset_repairs FOR UPDATE TO authenticated USING (true);

-- asset_types
DROP POLICY IF EXISTS at_select ON asset_types;
DROP POLICY IF EXISTS at_insert ON asset_types;
DROP POLICY IF EXISTS at_delete ON asset_types;
CREATE POLICY at_select ON asset_types FOR SELECT TO authenticated USING (true);
CREATE POLICY at_insert ON asset_types FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY at_delete ON asset_types FOR DELETE TO authenticated USING (true);
