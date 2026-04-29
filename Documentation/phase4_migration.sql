/* ============================================================
   GROWTHIC ONE — Phase 4 Migration
   Run AFTER phase3_migration.sql.
   1. Client status tracking (On Track / At Risk / Off Track)
   ============================================================ */

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS client_status TEXT NOT NULL DEFAULT 'on_track'
    CHECK (client_status IN ('on_track', 'at_risk', 'off_track')),
  ADD COLUMN IF NOT EXISTS client_status_updated_by UUID
    REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_status_updated_at TIMESTAMPTZ;
