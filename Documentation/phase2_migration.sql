-- ============================================================
-- GROWTHIC ONE — Phase 2 Migration
-- Run this AFTER database_setup.sql has been executed.
-- Paste into: Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================
-- Changes in this migration:
--   1. Add `finance` to employees role constraint
--   2. Add `finance` to employees RLS policy
--   3. Drop and recreate reimbursements table (full schema redesign)
--   4. Create tools, tool_access, tool_requests tables
--   5. RLS policies for new tables
--   6. Indexes for new tables
-- ============================================================


-- ============================================================
-- SECTION 1 — Add `finance` role to employees
-- ============================================================

ALTER TABLE public.employees
  DROP CONSTRAINT IF EXISTS employees_role_check;

ALTER TABLE public.employees
  ADD CONSTRAINT employees_role_check
  CHECK (role IN (
    'super_admin', 'founders_office', 'team_lead',
    'bde', 'delivery', 'hr', 'finance'
  ));

-- Allow finance to read employee names (needed for reimbursement display)
DROP POLICY IF EXISTS "emp_select" ON public.employees;

CREATE POLICY "emp_select" ON public.employees FOR SELECT USING (
  id = auth.uid()
  OR get_my_role() IN ('super_admin', 'founders_office', 'hr', 'finance')
  OR (get_my_role() = 'team_lead' AND manager_id = auth.uid())
);


-- ============================================================
-- SECTION 2 — Reimbursements: drop and recreate
-- ============================================================
-- NOTE: This drops all existing reimbursement data.
-- Run only when the table is empty or after a confirmed data backup.

DROP TABLE IF EXISTS public.reimbursements CASCADE;

CREATE TABLE public.reimbursements (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Submitter
  employee_id        UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,

  -- Stage: pre-approval request or actual expense claim
  type               TEXT NOT NULL CHECK (type IN ('pre_approval', 'claim')),

  -- Link actual claim to its pre-approval (optional — claims can exist without one)
  pre_approval_id    UUID REFERENCES public.reimbursements(id) ON DELETE SET NULL,

  -- Client context
  client_id          UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  project_code       TEXT,

  -- Expense classification
  expense_type       TEXT NOT NULL CHECK (expense_type IN (
                       'travel', 'food_meals', 'printing_stationery',
                       'internet_communication', 'photography_videography',
                       'event_venue', 'software_tools', 'courier_delivery',
                       'marketing_materials', 'accommodation', 'other'
                     )),

  -- Shared: reason / description
  reason             TEXT,

  -- Pre-approval stage fields
  estimated_amount   NUMERIC(10,2) CHECK (estimated_amount IS NULL OR estimated_amount > 0),
  expected_date      DATE,

  -- Actual claim stage fields
  amount             NUMERIC(10,2) CHECK (amount IS NULL OR amount > 0),
  expense_date       DATE,
  drive_receipt_url  TEXT,   -- populated after Google Drive upload

  -- Approval
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                       'pending', 'approved', 'rejected', 'paid'
                     )),
  approved_by        UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  hr_approved_amount NUMERIC(10,2),   -- HR may adjust the claimed amount
  hr_remarks         TEXT,            -- mandatory when HR adjusts amount
  rejection_comment  TEXT,

  -- Finance
  paid_by            UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  paid_at            TIMESTAMPTZ,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE public.reimbursements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reimb_select" ON public.reimbursements FOR SELECT USING (
  -- Own submissions
  employee_id = auth.uid()
  -- HR and admin see all non-Finance submissions
  OR get_my_role() IN ('super_admin', 'founders_office', 'hr')
  -- Finance sees only approved/paid claims (for payment processing)
  OR (
    get_my_role() = 'finance'
    AND type = 'claim'
    AND status IN ('approved', 'paid')
  )
);

CREATE POLICY "reimb_insert" ON public.reimbursements FOR INSERT WITH CHECK (
  employee_id = auth.uid()
);

CREATE POLICY "reimb_update" ON public.reimbursements FOR UPDATE USING (
  -- Owner can edit their own pending submissions
  (employee_id = auth.uid() AND status = 'pending')
  -- HR approves/rejects (not their own)
  OR (
    get_my_role() = 'hr'
    AND employee_id != auth.uid()
  )
  -- Super admin approves/rejects everything (including HR's own)
  OR get_my_role() = 'super_admin'
  -- Finance marks as paid
  OR (
    get_my_role() = 'finance'
    AND type = 'claim'
    AND status = 'approved'
  )
);

CREATE POLICY "reimb_delete" ON public.reimbursements FOR DELETE USING (
  employee_id = auth.uid() AND status = 'pending'
  OR get_my_role() = 'super_admin'
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_reimb_employee    ON public.reimbursements(employee_id, type, status);
CREATE INDEX IF NOT EXISTS idx_reimb_status      ON public.reimbursements(status, type);
CREATE INDEX IF NOT EXISTS idx_reimb_preapproval ON public.reimbursements(pre_approval_id);


-- ============================================================
-- SECTION 3 — Tools tables
-- ============================================================

-- Tool registry
CREATE TABLE IF NOT EXISTS public.tools (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN (
                  'design', 'project_management', 'communication',
                  'analytics', 'content', 'development', 'finance', 'other'
                )),
  cost          NUMERIC(10,2),
  billing_cycle TEXT CHECK (billing_cycle IN ('monthly', 'annual', 'one_time', 'free')),
  renewal_date  DATE,
  access_type   TEXT CHECK (access_type IN ('shared_login', 'individual_seat')),
  owner_id      UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  notes         TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  added_by      UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Who has access to each tool
CREATE TABLE IF NOT EXISTS public.tool_access (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tool_id     UUID NOT NULL REFERENCES public.tools(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by  UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  UNIQUE (tool_id, employee_id)
);

-- Tool requests (access to existing tool OR request for new tool)
CREATE TABLE IF NOT EXISTS public.tool_requests (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id      UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,

  -- 'access' = request access to existing tool
  -- 'new_tool' = request purchase of a new tool
  request_type     TEXT NOT NULL CHECK (request_type IN ('access', 'new_tool')),

  -- For access requests
  tool_id          UUID REFERENCES public.tools(id) ON DELETE SET NULL,

  -- For new tool requests
  tool_name        TEXT,
  estimated_cost   NUMERIC(10,2),
  client_ids       TEXT[],     -- array of client UUIDs (stored as text[])
  project_codes    TEXT[],     -- auto-filled from selected clients

  reason           TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                     'pending', 'approved', 'rejected'
                   )),
  approved_by      UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  approver_remarks TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS: tools
ALTER TABLE public.tools       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tools_select" ON public.tools FOR SELECT USING (
  auth.uid() IN (SELECT id FROM public.employees WHERE status = 'active')
);
CREATE POLICY "tools_write" ON public.tools FOR ALL USING (
  get_my_role() IN ('super_admin', 'founders_office', 'hr')
);

CREATE POLICY "taccess_select" ON public.tool_access FOR SELECT USING (
  employee_id = auth.uid()
  OR get_my_role() IN ('super_admin', 'hr', 'founders_office')
);
CREATE POLICY "taccess_write" ON public.tool_access FOR ALL USING (
  get_my_role() IN ('super_admin', 'hr', 'founders_office')
);

CREATE POLICY "treq_select" ON public.tool_requests FOR SELECT USING (
  employee_id = auth.uid()
  OR get_my_role() IN ('super_admin', 'hr', 'founders_office')
  OR (
    get_my_role() = 'team_lead'
    AND employee_id IN (SELECT id FROM public.employees WHERE manager_id = auth.uid())
  )
);
CREATE POLICY "treq_insert" ON public.tool_requests FOR INSERT WITH CHECK (
  employee_id = auth.uid()
);
CREATE POLICY "treq_update" ON public.tool_requests FOR UPDATE USING (
  get_my_role() IN ('super_admin', 'hr', 'founders_office')
);
CREATE POLICY "treq_delete" ON public.tool_requests FOR DELETE USING (
  employee_id = auth.uid() AND status = 'pending'
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tools_status        ON public.tools(status);
CREATE INDEX IF NOT EXISTS idx_tool_access_tool    ON public.tool_access(tool_id);
CREATE INDEX IF NOT EXISTS idx_tool_access_emp     ON public.tool_access(employee_id);
CREATE INDEX IF NOT EXISTS idx_tool_req_employee   ON public.tool_requests(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_tool_req_status     ON public.tool_requests(status, request_type);


-- ============================================================
-- DONE. Phase 2 migration complete.
-- ============================================================
-- Next steps:
--   1. Deploy the invite-employee Edge Function (see Deployment_guide.md)
--   2. Deploy updated frontend to Vercel
--   3. HR can now invite and manage employees from the People module
-- ============================================================
