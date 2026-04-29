-- ============================================================
-- GROWTHIC ONE — Database Tables
-- Run this first in Supabase SQL Editor
-- ============================================================

-- ── Helper: auto-update updated_at on any row change ────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Helper: get the current logged-in user's role ────────────
-- Used by RLS policies to check permissions
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT e.role
  FROM public.employees e
  JOIN auth.users u ON u.email = e.email
  WHERE u.id = auth.uid()
$$;

-- ── Helper: get the current logged-in user's employee ID ─────
CREATE OR REPLACE FUNCTION get_my_employee_id()
RETURNS UUID
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT e.id
  FROM public.employees e
  JOIN auth.users u ON u.email = e.email
  WHERE u.id = auth.uid()
$$;


-- ============================================================
-- 1. EMPLOYEES
-- Core user table. Links to Supabase Auth via email.
-- ============================================================
CREATE TABLE IF NOT EXISTS employees (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id       UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  role          TEXT NOT NULL CHECK (role IN (
                  'super_admin', 'founders_office', 'team_lead',
                  'bde', 'delivery', 'hr'
                )),
  department    TEXT,
  manager_id    UUID REFERENCES employees(id) ON DELETE SET NULL,
  joining_date  DATE,
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'inactive')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER employees_updated_at
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- 2. CLIENTS
-- Master client record. Project code is the spine of the system.
-- ============================================================
CREATE TABLE IF NOT EXISTS clients (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name             TEXT NOT NULL,
  project_code            TEXT UNIQUE NOT NULL,
  category                TEXT CHECK (category IN ('shark', 'dolphin', 'turtle', 'snail')),
  status                  TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'paused', 'inactive', 'archived')),
  overview                TEXT,
  brand_guidelines_url    TEXT,
  brand_guidelines_drive_id TEXT,
  agreement_start         DATE,
  agreement_end           DATE,
  assigned_am_id          UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_by              UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Commercial data lives in a separate table.
-- Only BDE and Founder's Office can read it.
CREATE TABLE IF NOT EXISTS client_commercial (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID UNIQUE NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  monthly_fee     NUMERIC(12,2),
  contract_value  NUMERIC(12,2),
  payment_terms   TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER client_commercial_updated_at
  BEFORE UPDATE ON client_commercial
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- 3. CLIENT ENTITIES
-- Multi-entity clients (e.g. Crystal Crop has 2 entities)
-- ============================================================
CREATE TABLE IF NOT EXISTS client_entities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  entity_name  TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 4. CLIENT PLATFORMS
-- Which platforms each client is active on
-- ============================================================
CREATE TABLE IF NOT EXISTS client_platforms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform    TEXT NOT NULL CHECK (platform IN ('linkedin', 'instagram')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id, platform)
);


-- ============================================================
-- 5. SCOPE OF WORK
-- Defines planned monthly deliverables per client per platform.
-- Feeds the SOW Progress section on the Client Dashboard.
-- ============================================================
CREATE TABLE IF NOT EXISTS scope_of_work (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform          TEXT NOT NULL CHECK (platform IN ('linkedin', 'instagram')),
  deliverable_type  TEXT NOT NULL CHECK (deliverable_type IN ('posts', 'reports', 'stories', 'reels')),
  planned_quantity  INTEGER NOT NULL DEFAULT 0 CHECK (planned_quantity >= 0),
  effective_from    DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by        UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id, platform, deliverable_type, effective_from)
);

CREATE TRIGGER scope_of_work_updated_at
  BEFORE UPDATE ON scope_of_work
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- 6. CLIENT ASSIGNMENTS
-- Which employees are assigned to which clients
-- ============================================================
CREATE TABLE IF NOT EXISTS client_assignments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  employee_id      UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  role_on_client   TEXT,
  assigned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id, employee_id)
);


-- ============================================================
-- 7. TIMESHEETS
-- Daily work logs linked to client and project code.
-- hours capped at 8 per entry; multiple entries allowed per day.
-- ============================================================
CREATE TABLE IF NOT EXISTS timesheets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  client_id           UUID REFERENCES clients(id) ON DELETE SET NULL,
  project_code        TEXT,
  task_description    TEXT NOT NULL,
  date                DATE NOT NULL,
  hours               NUMERIC(4,2) NOT NULL CHECK (hours > 0 AND hours <= 8),
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  approved_by         UUID REFERENCES employees(id) ON DELETE SET NULL,
  rejection_comment   TEXT,
  submitted_at        TIMESTAMPTZ,
  approved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER timesheets_updated_at
  BEFORE UPDATE ON timesheets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- 8. LEAVES
-- Leave and WFH requests. Approved leaves block timesheet
-- submission for the same date (enforced at app level).
-- ============================================================
CREATE TABLE IF NOT EXISTS leaves (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type    TEXT NOT NULL CHECK (leave_type IN (
                  'casual', 'sick', 'earned', 'wfh', 'half_day'
                )),
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL CHECK (end_date >= start_date),
  reason        TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected')),
  team_lead_id  UUID REFERENCES employees(id) ON DELETE SET NULL,
  approved_by   UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER leaves_updated_at
  BEFORE UPDATE ON leaves
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- 9. MASTER FOLDER FILES
-- Metadata for files stored in Google Drive.
-- The file itself lives in Drive; only metadata lives here.
-- deleted_at is set for soft deletes — never hard delete.
-- ============================================================
CREATE TABLE IF NOT EXISTS master_folder_files (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  month            TEXT NOT NULL,  -- 'YYYY-MM' e.g. '2026-04'
  folder_type      TEXT NOT NULL CHECK (folder_type IN (
                     'approved_content', 'creatives', 'reports'
                   )),
  file_name        TEXT NOT NULL,
  file_type        TEXT,
  drive_file_id    TEXT NOT NULL,
  drive_url        TEXT NOT NULL,
  title            TEXT,
  description      TEXT,
  version          INTEGER NOT NULL DEFAULT 1,
  uploaded_by      UUID REFERENCES employees(id) ON DELETE SET NULL,
  uploaded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  deleted_by       UUID REFERENCES employees(id) ON DELETE SET NULL
);


-- ============================================================
-- 10. PERFORMANCE DATA
-- Analytics data uploaded from LinkedIn / Instagram exports.
-- Superseded flag is set when a re-upload replaces previous data.
-- top_posts stored as JSONB array of post objects.
-- ============================================================
CREATE TABLE IF NOT EXISTS performance_data (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  entity_id           UUID REFERENCES client_entities(id) ON DELETE SET NULL,
  platform            TEXT NOT NULL CHECK (platform IN ('linkedin', 'instagram')),
  data_date           DATE NOT NULL,
  impressions         INTEGER,
  engagements         INTEGER,
  followers_gained    INTEGER,
  search_discovery    INTEGER,
  engagement_rate     NUMERIC(8,4),
  top_posts           JSONB,
  period_start        DATE,
  period_end          DATE,
  superseded          BOOLEAN NOT NULL DEFAULT FALSE,
  uploaded_by         UUID REFERENCES employees(id) ON DELETE SET NULL,
  uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 11. ASSETS
-- Physical company assets (laptops, phones, equipment, etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS assets (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT NOT NULL,
  asset_type           TEXT NOT NULL,
  serial_number        TEXT,
  status               TEXT NOT NULL DEFAULT 'available'
                         CHECK (status IN (
                           'available', 'in_use', 'pending', 'overdue', 'retired'
                         )),
  assigned_to          UUID REFERENCES employees(id) ON DELETE SET NULL,
  assigned_at          TIMESTAMPTZ,
  expected_return_date DATE,
  condition            TEXT CHECK (condition IN ('excellent', 'good', 'fair', 'poor')),
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER assets_updated_at
  BEFORE UPDATE ON assets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- 12. REIMBURSEMENTS
-- Expense claims with two-step approval (TL then HR).
-- ============================================================
CREATE TABLE IF NOT EXISTS reimbursements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  client_id         UUID REFERENCES clients(id) ON DELETE SET NULL,
  project_code      TEXT,
  expense_type      TEXT NOT NULL CHECK (expense_type IN (
                      'cab', 'food', 'printing', 'internet', 'other'
                    )),
  amount            NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  expense_date      DATE NOT NULL,
  description       TEXT,
  receipt_drive_url TEXT,
  receipt_drive_id  TEXT,
  team_lead_id      UUID REFERENCES employees(id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN (
                        'pending', 'tl_approved', 'hr_approved', 'rejected'
                      )),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER reimbursements_updated_at
  BEFORE UPDATE ON reimbursements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- 13. APPROVALS
-- Centralised approval log for all modules.
-- entity_type + entity_id acts as a polymorphic reference.
-- level: 1 = first approver, 2 = second approver (e.g. HR)
-- ============================================================
CREATE TABLE IF NOT EXISTS approvals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  TEXT NOT NULL CHECK (entity_type IN (
                 'timesheet', 'leave', 'reimbursement', 'asset', 'tool'
               )),
  entity_id    UUID NOT NULL,
  level        INTEGER NOT NULL DEFAULT 1,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'rejected')),
  approver_id  UUID REFERENCES employees(id) ON DELETE SET NULL,
  comment      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acted_at     TIMESTAMPTZ
);


-- ============================================================
-- 14. NOTIFICATIONS
-- In-app notifications. read = false until user opens it.
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type                  TEXT NOT NULL,
  message               TEXT NOT NULL,
  module                TEXT,
  record_id             UUID,
  read                  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 15. TOOLS
-- Tool catalogue (Canva, Adobe, Claude AI, etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS tools (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  purpose     TEXT,
  tool_url    TEXT,
  status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'inactive')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 16. TOOL REQUESTS
-- Access requests and new tool purchase requests
-- ============================================================
CREATE TABLE IF NOT EXISTS tool_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  tool_id       UUID REFERENCES tools(id) ON DELETE SET NULL,
  request_type  TEXT NOT NULL CHECK (request_type IN ('access', 'new_tool')),
  tool_name     TEXT,
  reason        TEXT NOT NULL,
  project_codes TEXT[],
  duration      TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER tool_requests_updated_at
  BEFORE UPDATE ON tool_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- INDEXES — speed up common lookups
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_timesheets_employee_id   ON timesheets(employee_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_date          ON timesheets(date);
CREATE INDEX IF NOT EXISTS idx_timesheets_status        ON timesheets(status);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient  ON notifications(recipient_employee_id, read);
CREATE INDEX IF NOT EXISTS idx_performance_client       ON performance_data(client_id, platform, data_date);
CREATE INDEX IF NOT EXISTS idx_master_files_client      ON master_folder_files(client_id, month, folder_type);
CREATE INDEX IF NOT EXISTS idx_master_files_deleted     ON master_folder_files(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_approvals_entity         ON approvals(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_reimbursements_employee  ON reimbursements(employee_id);
CREATE INDEX IF NOT EXISTS idx_leaves_employee          ON leaves(employee_id);
CREATE INDEX IF NOT EXISTS idx_client_assignments       ON client_assignments(employee_id);
