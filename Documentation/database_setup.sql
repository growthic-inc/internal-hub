-- ============================================================
-- GROWTHIC ONE — Complete Database Setup
-- Paste this entire file into:
-- Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================
-- Sections:
--   1. Extensions
--   2. Tables + helper function (function placed after employees table)
--   3. Indexes
--   4. Row Level Security policies
--   5. Seed data (6 clients)
-- ============================================================


-- ============================================================
-- SECTION 1 — Extensions + Helper Function
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ============================================================
-- SECTION 2 — Tables
-- ============================================================

-- ── employees ────────────────────────────────────────────────
-- id must match the Supabase Auth user UUID for RLS to work.
CREATE TABLE IF NOT EXISTS public.employees (
  id            UUID PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  role          TEXT NOT NULL CHECK (role IN (
                  'super_admin', 'founders_office', 'team_lead',
                  'bde', 'delivery', 'hr'
                )),
  department    TEXT,
  manager_id    UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  joining_date  DATE,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- get_my_role() must come after employees table exists.
-- SECURITY DEFINER bypasses RLS when reading employees — intentional,
-- only returns the caller's own role.
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM public.employees WHERE id = auth.uid();
$$;

-- ── clients ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clients (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_code  TEXT NOT NULL UNIQUE,
  client_name   TEXT NOT NULL,
  category      TEXT CHECK (category IN ('Shark', 'Dolphin', 'Turtle', 'Snail')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
                  'active', 'paused', 'inactive', 'archived'
                )),
  overview      TEXT,
  am_id         UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  created_by    UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── client_entities ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_entities (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id     UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  entity_name   TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── client_platforms ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_platforms (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id     UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  platform_name TEXT NOT NULL CHECK (platform_name IN ('LinkedIn', 'Instagram')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── scope_of_work ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.scope_of_work (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id               UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  platform                TEXT NOT NULL,
  deliverable_type        TEXT NOT NULL,
  agreed_monthly_quantity INTEGER NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── client_assignments ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_assignments (
  employee_id   UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  client_id     UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (employee_id, client_id)
);

-- ── timesheets ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.timesheets (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id        UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  client_id          UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  project_code       TEXT,
  task_description   TEXT NOT NULL,
  date               DATE NOT NULL,
  hours              NUMERIC(4,2) NOT NULL CHECK (hours > 0 AND hours <= 8),
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                       'draft', 'submitted', 'approved', 'rejected'
                     )),
  approved_by        UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  rejection_comment  TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── leaves ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leaves (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id  UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('sick', 'casual', 'earned', 'wfh', 'other')),
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  reason       TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by  UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  team_lead_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── master_folder_files ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.master_folder_files (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id      UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  month          TEXT NOT NULL,    -- Format: YYYY-MM  (e.g. 2026-04)
  folder_type    TEXT NOT NULL CHECK (folder_type IN (
                   'approved_content', 'creatives', 'reports'
                 )),
  file_name      TEXT NOT NULL,
  file_type      TEXT,
  drive_file_id  TEXT NOT NULL,
  drive_url      TEXT NOT NULL,
  description    TEXT,
  uploaded_by    UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ,
  deleted_by     UUID REFERENCES public.employees(id) ON DELETE SET NULL
);

-- ── performance_data ─────────────────────────────────────────
-- metrics JSONB stores: impressions, engagements, likes,
-- followers_gained, search_and_discovery, top_posts (array)
CREATE TABLE IF NOT EXISTS public.performance_data (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id     UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  entity_id     UUID REFERENCES public.client_entities(id) ON DELETE SET NULL,
  platform      TEXT NOT NULL CHECK (platform IN ('LinkedIn', 'Instagram')),
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,
  metrics       JSONB NOT NULL DEFAULT '{}',
  superseded    BOOLEAN NOT NULL DEFAULT FALSE,
  uploaded_by   UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── assets ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.assets (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           TEXT NOT NULL,
  type           TEXT NOT NULL,
  serial_number  TEXT,
  status         TEXT NOT NULL DEFAULT 'available' CHECK (status IN (
                   'available', 'in_use', 'pending', 'overdue', 'retired'
                 )),
  assigned_to    UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  assigned_date  DATE,
  condition      TEXT,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── reimbursements ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reimbursements (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id       UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  client_id         UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  project_code      TEXT,
  expense_type      TEXT NOT NULL CHECK (expense_type IN (
                      'cab', 'food', 'printing', 'internet', 'other'
                    )),
  amount            NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  expense_date      DATE NOT NULL,
  description       TEXT,
  drive_receipt_url TEXT,
  team_lead_id      UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                      'pending', 'tl_approved', 'hr_approved', 'rejected'
                    )),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── approvals ────────────────────────────────────────────────
-- Centralised table for all approval flows.
-- entity_type + entity_id is a polymorphic reference.
-- level 1 = first approver (TL), level 2 = second approver (HR).
CREATE TABLE IF NOT EXISTS public.approvals (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type  TEXT NOT NULL CHECK (entity_type IN (
                 'timesheet', 'leave', 'reimbursement', 'asset', 'tool'
               )),
  entity_id    UUID NOT NULL,
  level        INTEGER NOT NULL DEFAULT 1,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                 'pending', 'approved', 'rejected'
               )),
  approver_id  UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  comment      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acted_at     TIMESTAMPTZ
);

-- ── notifications ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  type                  TEXT NOT NULL,
  message               TEXT NOT NULL,
  module                TEXT,
  record_id             UUID,
  read                  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- SECTION 3 — Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_employees_email        ON public.employees(email);
CREATE INDEX IF NOT EXISTS idx_employees_manager      ON public.employees(manager_id);
CREATE INDEX IF NOT EXISTS idx_clients_project_code   ON public.clients(project_code);
CREATE INDEX IF NOT EXISTS idx_clients_status         ON public.clients(status);
CREATE INDEX IF NOT EXISTS idx_entities_client        ON public.client_entities(client_id);
CREATE INDEX IF NOT EXISTS idx_platforms_client       ON public.client_platforms(client_id);
CREATE INDEX IF NOT EXISTS idx_sow_client             ON public.scope_of_work(client_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_employee    ON public.timesheets(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_timesheets_status      ON public.timesheets(status);
CREATE INDEX IF NOT EXISTS idx_timesheets_client      ON public.timesheets(client_id);
CREATE INDEX IF NOT EXISTS idx_leaves_employee        ON public.leaves(employee_id);
CREATE INDEX IF NOT EXISTS idx_master_files_lookup    ON public.master_folder_files(client_id, month, folder_type);
CREATE INDEX IF NOT EXISTS idx_master_files_deleted   ON public.master_folder_files(deleted_at);
CREATE INDEX IF NOT EXISTS idx_perf_data_lookup       ON public.performance_data(client_id, platform, superseded);
CREATE INDEX IF NOT EXISTS idx_assets_status          ON public.assets(status);
CREATE INDEX IF NOT EXISTS idx_reimbursements_emp     ON public.reimbursements(employee_id);
CREATE INDEX IF NOT EXISTS idx_reimbursements_tl      ON public.reimbursements(team_lead_id);
CREATE INDEX IF NOT EXISTS idx_approvals_entity       ON public.approvals(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_approvals_approver     ON public.approvals(approver_id, status);
CREATE INDEX IF NOT EXISTS idx_notifications_recip    ON public.notifications(recipient_employee_id, read);


-- ============================================================
-- SECTION 4 — Row Level Security
-- ============================================================

-- Enable RLS on every table
ALTER TABLE public.employees           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_entities     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_platforms    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scope_of_work       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_assignments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leaves              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_folder_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_data    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reimbursements      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approvals           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications       ENABLE ROW LEVEL SECURITY;


-- ── employees policies ────────────────────────────────────────
CREATE POLICY "emp_select" ON public.employees FOR SELECT USING (
  id = auth.uid()
  OR get_my_role() IN ('super_admin', 'founders_office', 'hr')
  OR (get_my_role() = 'team_lead' AND manager_id = auth.uid())
);

CREATE POLICY "emp_insert" ON public.employees FOR INSERT WITH CHECK (
  get_my_role() IN ('super_admin', 'hr')
);

CREATE POLICY "emp_update" ON public.employees FOR UPDATE USING (
  id = auth.uid()
  OR get_my_role() IN ('super_admin', 'hr')
);

CREATE POLICY "emp_delete" ON public.employees FOR DELETE USING (
  get_my_role() = 'super_admin'
);


-- ── clients policies ──────────────────────────────────────────
CREATE POLICY "clients_select" ON public.clients FOR SELECT USING (
  auth.uid() IN (SELECT id FROM public.employees WHERE status = 'active')
);

CREATE POLICY "clients_insert" ON public.clients FOR INSERT WITH CHECK (
  get_my_role() IN ('super_admin', 'founders_office', 'bde')
);

CREATE POLICY "clients_update" ON public.clients FOR UPDATE USING (
  get_my_role() IN ('super_admin', 'founders_office', 'bde')
);

CREATE POLICY "clients_delete" ON public.clients FOR DELETE USING (
  get_my_role() = 'super_admin'
);


-- ── client_entities, client_platforms, scope_of_work ─────────
-- Same access pattern: any active employee can read, BDE+ can write

CREATE POLICY "entities_select" ON public.client_entities FOR SELECT USING (
  auth.uid() IN (SELECT id FROM public.employees WHERE status = 'active')
);
CREATE POLICY "entities_write" ON public.client_entities FOR ALL USING (
  get_my_role() IN ('super_admin', 'founders_office', 'bde')
);

CREATE POLICY "platforms_select" ON public.client_platforms FOR SELECT USING (
  auth.uid() IN (SELECT id FROM public.employees WHERE status = 'active')
);
CREATE POLICY "platforms_write" ON public.client_platforms FOR ALL USING (
  get_my_role() IN ('super_admin', 'founders_office', 'bde')
);

CREATE POLICY "sow_select" ON public.scope_of_work FOR SELECT USING (
  auth.uid() IN (SELECT id FROM public.employees WHERE status = 'active')
);
CREATE POLICY "sow_write" ON public.scope_of_work FOR ALL USING (
  get_my_role() IN ('super_admin', 'founders_office', 'bde')
);

CREATE POLICY "assignments_select" ON public.client_assignments FOR SELECT USING (
  auth.uid() IN (SELECT id FROM public.employees WHERE status = 'active')
);
CREATE POLICY "assignments_write" ON public.client_assignments FOR ALL USING (
  get_my_role() IN ('super_admin', 'founders_office', 'bde', 'hr')
);


-- ── timesheets policies ───────────────────────────────────────
CREATE POLICY "ts_select" ON public.timesheets FOR SELECT USING (
  employee_id = auth.uid()
  OR get_my_role() IN ('super_admin', 'founders_office', 'hr')
  OR (
    get_my_role() = 'team_lead'
    AND employee_id IN (SELECT id FROM public.employees WHERE manager_id = auth.uid())
  )
);

CREATE POLICY "ts_insert" ON public.timesheets FOR INSERT WITH CHECK (
  employee_id = auth.uid()
);

CREATE POLICY "ts_update" ON public.timesheets FOR UPDATE USING (
  -- Owner can edit their own draft or rejected entries
  (employee_id = auth.uid() AND status IN ('draft', 'rejected'))
  -- Team lead can approve/reject submitted entries from their team
  OR (
    get_my_role() = 'team_lead'
    AND status = 'submitted'
    AND employee_id IN (SELECT id FROM public.employees WHERE manager_id = auth.uid())
  )
  -- Super admin can update anything
  OR get_my_role() = 'super_admin'
);

CREATE POLICY "ts_delete" ON public.timesheets FOR DELETE USING (
  get_my_role() = 'super_admin'
);


-- ── leaves policies ───────────────────────────────────────────
CREATE POLICY "leaves_select" ON public.leaves FOR SELECT USING (
  employee_id = auth.uid()
  OR team_lead_id = auth.uid()
  OR get_my_role() IN ('super_admin', 'founders_office', 'hr')
);

CREATE POLICY "leaves_insert" ON public.leaves FOR INSERT WITH CHECK (
  employee_id = auth.uid()
);

CREATE POLICY "leaves_update" ON public.leaves FOR UPDATE USING (
  employee_id = auth.uid()
  OR team_lead_id = auth.uid()
  OR get_my_role() IN ('super_admin', 'hr')
);

CREATE POLICY "leaves_delete" ON public.leaves FOR DELETE USING (
  employee_id = auth.uid() AND status = 'pending'
);


-- ── master_folder_files policies ─────────────────────────────
CREATE POLICY "mff_select" ON public.master_folder_files FOR SELECT USING (
  deleted_at IS NULL
  AND auth.uid() IN (SELECT id FROM public.employees WHERE status = 'active')
);

CREATE POLICY "mff_insert" ON public.master_folder_files FOR INSERT WITH CHECK (
  get_my_role() IN ('super_admin', 'founders_office', 'team_lead', 'delivery')
);

CREATE POLICY "mff_update" ON public.master_folder_files FOR UPDATE USING (
  -- Uploader can soft-delete within 24 hours
  (uploaded_by = auth.uid() AND uploaded_at > NOW() - INTERVAL '24 hours')
  OR get_my_role() IN ('super_admin', 'founders_office', 'team_lead')
);

-- Hard deletes blocked for everyone — soft delete only
CREATE POLICY "mff_delete" ON public.master_folder_files FOR DELETE USING (FALSE);


-- ── performance_data policies ─────────────────────────────────
CREATE POLICY "perf_select" ON public.performance_data FOR SELECT USING (
  get_my_role() IN ('super_admin', 'founders_office', 'team_lead', 'delivery')
);

CREATE POLICY "perf_insert" ON public.performance_data FOR INSERT WITH CHECK (
  get_my_role() IN ('super_admin', 'founders_office', 'team_lead', 'delivery')
);

CREATE POLICY "perf_update" ON public.performance_data FOR UPDATE USING (
  get_my_role() IN ('super_admin', 'founders_office', 'team_lead')
);

CREATE POLICY "perf_delete" ON public.performance_data FOR DELETE USING (FALSE);


-- ── assets policies ───────────────────────────────────────────
CREATE POLICY "assets_select" ON public.assets FOR SELECT USING (
  auth.uid() IN (SELECT id FROM public.employees WHERE status = 'active')
);

CREATE POLICY "assets_insert" ON public.assets FOR INSERT WITH CHECK (
  get_my_role() IN ('super_admin', 'hr')
);

CREATE POLICY "assets_update" ON public.assets FOR UPDATE USING (
  get_my_role() IN ('super_admin', 'hr')
);

CREATE POLICY "assets_delete" ON public.assets FOR DELETE USING (
  get_my_role() = 'super_admin'
);


-- ── reimbursements policies ───────────────────────────────────
CREATE POLICY "reimb_select" ON public.reimbursements FOR SELECT USING (
  employee_id = auth.uid()
  OR team_lead_id = auth.uid()
  OR get_my_role() IN ('super_admin', 'founders_office', 'hr')
);

CREATE POLICY "reimb_insert" ON public.reimbursements FOR INSERT WITH CHECK (
  employee_id = auth.uid()
);

CREATE POLICY "reimb_update" ON public.reimbursements FOR UPDATE USING (
  employee_id = auth.uid()
  OR team_lead_id = auth.uid()
  OR get_my_role() IN ('super_admin', 'founders_office', 'hr')
);

CREATE POLICY "reimb_delete" ON public.reimbursements FOR DELETE USING (
  get_my_role() = 'super_admin'
);


-- ── approvals policies ────────────────────────────────────────
CREATE POLICY "appr_select" ON public.approvals FOR SELECT USING (
  approver_id = auth.uid()
  OR get_my_role() IN ('super_admin', 'founders_office', 'hr')
);

CREATE POLICY "appr_insert" ON public.approvals FOR INSERT WITH CHECK (
  auth.uid() IN (SELECT id FROM public.employees WHERE status = 'active')
);

CREATE POLICY "appr_update" ON public.approvals FOR UPDATE USING (
  approver_id = auth.uid()
  OR get_my_role() = 'super_admin'
);

CREATE POLICY "appr_delete" ON public.approvals FOR DELETE USING (FALSE);


-- ── notifications policies ────────────────────────────────────
CREATE POLICY "notif_select" ON public.notifications FOR SELECT USING (
  recipient_employee_id = auth.uid()
);

CREATE POLICY "notif_insert" ON public.notifications FOR INSERT WITH CHECK (
  auth.uid() IN (SELECT id FROM public.employees WHERE status = 'active')
);

CREATE POLICY "notif_update" ON public.notifications FOR UPDATE USING (
  recipient_employee_id = auth.uid()
);

CREATE POLICY "notif_delete" ON public.notifications FOR DELETE USING (
  recipient_employee_id = auth.uid()
);


-- ============================================================
-- SECTION 5 — Seed Data: 6 Active Clients
-- ============================================================

WITH c AS (
  INSERT INTO public.clients (project_code, client_name, category, status)
  VALUES
    ('CRYSTA',  'Crystal Crop Protection',              'Shark',   'active'),
    ('GLOBAL',  'Global Dental Aids',                   'Shark',   'active'),
    ('DHOOMI',  'Dhoomimal Gallery',                    'Dolphin', 'active'),
    ('FAREEHA', 'Fareeha Amber Ansari',                 'Dolphin', 'active'),
    ('ACTION',  'Franchise India Knowledge Services',   'Dolphin', 'active'),
    ('INDRA',   'Indranil Mukherjee',                   'Turtle',  'active')
  RETURNING id, project_code
)

-- Entities (multi-entity clients only)
, e AS (
  INSERT INTO public.client_entities (client_id, entity_name)
  SELECT c.id, v.entity_name
  FROM c
  JOIN (VALUES
    ('CRYSTA',  'Crystal Crop Protection'),
    ('CRYSTA',  'Ankur Aggarwal'),
    ('GLOBAL',  'STIM'),
    ('GLOBAL',  'GDA'),
    ('GLOBAL',  'Viren Khullar'),
    ('GLOBAL',  'Vineet Khullar')
  ) AS v(project_code, entity_name) ON c.project_code = v.project_code
  RETURNING id
)

-- Platforms
INSERT INTO public.client_platforms (client_id, platform_name)
SELECT c.id, v.platform_name
FROM c
JOIN (VALUES
  ('CRYSTA',  'LinkedIn'),
  ('CRYSTA',  'Instagram'),
  ('GLOBAL',  'LinkedIn'),
  ('GLOBAL',  'Instagram'),
  ('DHOOMI',  'LinkedIn'),
  ('DHOOMI',  'Instagram'),
  ('FAREEHA', 'LinkedIn'),
  ('FAREEHA', 'Instagram'),
  ('ACTION',  'LinkedIn'),
  ('ACTION',  'Instagram'),
  ('INDRA',   'LinkedIn')
) AS v(project_code, platform_name) ON c.project_code = v.project_code;


-- ============================================================
-- DONE.
-- ============================================================
-- Next step: create your Super Admin user.
-- See documentation_setup_superadmin below.
-- ============================================================
