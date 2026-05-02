-- ============================================================
-- Asset Requests — Two-stage approval workflow
-- Stage 1: Reporting Manager   Stage 2: HR / Super Admin
-- Run in Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS asset_requests (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  asset_id            uuid        REFERENCES assets(id) ON DELETE SET NULL,
  requested_by        uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  manager_id          uuid        REFERENCES employees(id) ON DELETE SET NULL,
  reason              text,

  -- Overall status
  status              text        NOT NULL DEFAULT 'pending_manager'
                      CHECK (status IN ('pending_manager', 'pending_hr', 'approved', 'rejected')),

  -- Stage 1: Manager
  manager_status      text        CHECK (manager_status IN ('approved', 'rejected')),
  manager_note        text,
  manager_acted_at    timestamptz,

  -- Stage 2: HR
  hr_status           text        CHECK (hr_status IN ('approved', 'rejected')),
  hr_note             text,
  hr_acted_at         timestamptz,
  hr_acted_by         uuid        REFERENCES employees(id) ON DELETE SET NULL,

  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS asset_requests_requested_by_idx ON asset_requests(requested_by);
CREATE INDEX IF NOT EXISTS asset_requests_manager_id_idx   ON asset_requests(manager_id);
CREATE INDEX IF NOT EXISTS asset_requests_status_idx       ON asset_requests(status);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_asset_requests_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_asset_requests_updated_at ON asset_requests;
CREATE TRIGGER trg_asset_requests_updated_at
  BEFORE UPDATE ON asset_requests
  FOR EACH ROW EXECUTE FUNCTION update_asset_requests_updated_at();
