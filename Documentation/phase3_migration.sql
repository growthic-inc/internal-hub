/* ============================================================
   GROWTHIC ONE — Phase 3 Migration
   Run AFTER phase2_migration.sql.
   1. entity_id column on master_folder_files
   2. notification_preferences table
   ============================================================ */

-- ── 1. master_folder_files: add entity_id ────────────────────
ALTER TABLE public.master_folder_files
  ADD COLUMN IF NOT EXISTS entity_id UUID REFERENCES public.client_entities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mff_entity ON public.master_folder_files(entity_id);

-- ── 2. notification_preferences ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  employee_id UUID    NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  module      TEXT    NOT NULL CHECK (module IN (
                'timesheet', 'leave', 'wfh', 'reimbursements',
                'assets', 'tools', 'people'
              )),
  event_type  TEXT    NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (employee_id, module, event_type)
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notif_prefs_own" ON public.notification_preferences
  FOR ALL USING (employee_id = auth.uid());
