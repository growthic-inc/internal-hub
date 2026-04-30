-- ============================================================
-- Growthic One — Phase 7 Migration
-- People Module rebuild, Leave Tracker, Announcements,
-- Policies & Documents, Org Chart / Hierarchy Engine
--
-- Safe to run multiple times (IF NOT EXISTS / ON CONFLICT guards)
--
-- Run order matters — execute top to bottom in one pass.
-- ============================================================


-- ============================================================
-- 1. EMPLOYEES — New Columns
-- ============================================================

ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS employee_id                      TEXT UNIQUE;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS personal_email                   TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS phone_number                     TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS date_of_birth                    DATE;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS designation                      TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS employment_type                  TEXT
  CHECK (employment_type IN ('full_time','part_time','freelancer','intern','probation'));
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS work_location                    TEXT
  CHECK (work_location IN ('office','remote','hybrid'));
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS profile_image_url               TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS emergency_contact_name          TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS emergency_contact_relationship  TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS emergency_contact_phone         TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS probation_completed             BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS probation_completed_date        DATE;

-- ── Auto-generate GRW-XXX employee IDs ───────────────────────
-- Sequence starts at 1; backfill assigns IDs to existing rows
-- in join order (oldest first). New inserts auto-pick next value.

CREATE SEQUENCE IF NOT EXISTS employee_id_seq START 1;

CREATE OR REPLACE FUNCTION public.generate_employee_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.employee_id IS NULL THEN
    NEW.employee_id := 'GRW-' || LPAD(NEXTVAL('employee_id_seq')::TEXT, 3, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_employee_id ON public.employees;
CREATE TRIGGER trg_set_employee_id
  BEFORE INSERT ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.generate_employee_id();

-- Backfill existing employees (ordered by joining_date so IDs feel chronological)
DO $$
DECLARE rec RECORD;
BEGIN
  FOR rec IN
    SELECT id FROM public.employees
    WHERE employee_id IS NULL
    ORDER BY joining_date ASC NULLS LAST, name ASC
  LOOP
    UPDATE public.employees
    SET employee_id = 'GRW-' || LPAD(NEXTVAL('employee_id_seq')::TEXT, 3, '0')
    WHERE id = rec.id;
  END LOOP;
END;
$$;


-- ============================================================
-- 2. DEPARTMENTS — Dynamic registry
-- Slugs must match the `department` column values already in
-- employees and access_matrix (see utils.js DEPT_LABELS).
-- HR can add new departments from the UI; new slugs are
-- inserted here and the access matrix panel picks them up.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.departments (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       TEXT        UNIQUE NOT NULL,
  name       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dept_select" ON public.departments;
CREATE POLICY "dept_select" ON public.departments
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "dept_write" ON public.departments;
CREATE POLICY "dept_write" ON public.departments
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employees
    WHERE email = (auth.jwt() ->> 'email')
      AND (role = 'super_admin' OR department = 'people_culture')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.employees
    WHERE email = (auth.jwt() ->> 'email')
      AND (role = 'super_admin' OR department = 'people_culture')
  ));

-- Seed with existing slugs — DO NOT change these slugs or the
-- access matrix and employee records will stop matching.
INSERT INTO public.departments (slug, name) VALUES
  ('management',           'Management'),
  ('content_strategy',     'Content'),
  ('creative',             'Creative'),
  ('creators',             'Creators'),
  ('operations_growth',    'Operations & Growth'),
  ('people_culture',       'People & Culture'),
  ('business_development', 'Business Development'),
  ('finance',              'Finance')
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name;


-- ============================================================
-- 3. LEAVE TYPES
-- HR creates and manages these. Default three are seeded.
-- HR can add custom types and delete/deactivate unused ones.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.leave_types (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL UNIQUE,
  is_active  BOOLEAN     NOT NULL DEFAULT true,
  created_by UUID        REFERENCES public.employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.leave_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lt_select" ON public.leave_types;
CREATE POLICY "lt_select" ON public.leave_types
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "lt_write" ON public.leave_types;
CREATE POLICY "lt_write" ON public.leave_types
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employees
    WHERE email = (auth.jwt() ->> 'email')
      AND (role = 'super_admin' OR department = 'people_culture')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.employees
    WHERE email = (auth.jwt() ->> 'email')
      AND (role = 'super_admin' OR department = 'people_culture')
  ));

INSERT INTO public.leave_types (name) VALUES
  ('Casual Leave'),
  ('Sick Leave'),
  ('Unpaid Leave')
ON CONFLICT (name) DO NOTHING;


-- ============================================================
-- 4. LEAVE CREDITS
-- HR manually credits leave days to an employee post-probation.
-- Balance = SUM(credited_days for type/year) - SUM(approved
-- leave_requests.days for same type/year).
-- Supports corrections (negative credited_days for reversals).
-- Balance CAN go negative — highlighted in UI, not blocked.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.leave_credits (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID          NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  leave_type_id UUID          NOT NULL REFERENCES public.leave_types(id),
  year          INT           NOT NULL,
  credited_days NUMERIC(5,1)  NOT NULL,   -- negative = correction/reversal
  notes         TEXT,
  credited_by   UUID          REFERENCES public.employees(id),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

ALTER TABLE public.leave_credits ENABLE ROW LEVEL SECURITY;

-- Employees see their own; HR and super_admin see all
DROP POLICY IF EXISTS "lc_select" ON public.leave_credits;
CREATE POLICY "lc_select" ON public.leave_credits
  FOR SELECT TO authenticated
  USING (
    employee_id = (SELECT id FROM public.employees WHERE email = (auth.jwt() ->> 'email'))
    OR EXISTS (
      SELECT 1 FROM public.employees
      WHERE email = (auth.jwt() ->> 'email')
        AND (role = 'super_admin' OR department = 'people_culture')
    )
  );

-- Only HR / super_admin can credit or adjust
DROP POLICY IF EXISTS "lc_write" ON public.leave_credits;
CREATE POLICY "lc_write" ON public.leave_credits
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employees
    WHERE email = (auth.jwt() ->> 'email')
      AND (role = 'super_admin' OR department = 'people_culture')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.employees
    WHERE email = (auth.jwt() ->> 'email')
      AND (role = 'super_admin' OR department = 'people_culture')
  ));


-- ============================================================
-- 5. LEAVE REQUESTS
--
-- Status flow:
--   pending → approved | rejected
--   pending → cancelled                    (employee cancels before manager acts)
--   approved → cancellation_pending        (employee requests cancellation)
--   cancellation_pending → cancelled       (manager approves cancellation)
--   cancellation_pending → approved        (manager rejects cancellation → stays approved)
--
-- Sandwich policy: days = simple calendar count (end - start + 1).
-- Weekends and public holidays between leave dates ARE counted.
-- Half-day: is_half_day = true, days = 0.5.
--
-- approver_id = NULL means the employee has no reporting manager;
-- the request appears in HR's approval queue automatically.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.leave_requests (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id         UUID          NOT NULL REFERENCES public.employees(id),
  leave_type_id       UUID          NOT NULL REFERENCES public.leave_types(id),
  start_date          DATE          NOT NULL,
  end_date            DATE          NOT NULL,
  days                NUMERIC(5,1)  NOT NULL,
  is_half_day         BOOLEAN       NOT NULL DEFAULT false,
  half_day_period     TEXT          CHECK (half_day_period IN ('morning','afternoon')),
  reason              TEXT          NOT NULL,
  status              TEXT          NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','cancelled','cancellation_pending')),
  approver_id         UUID          REFERENCES public.employees(id),  -- NULL → HR queue
  approver_comment    TEXT,
  acted_at            TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;

-- Employee sees own; approver (manager) sees direct reports they are approver for;
-- HR and super_admin see all.
DROP POLICY IF EXISTS "lr_select" ON public.leave_requests;
CREATE POLICY "lr_select" ON public.leave_requests
  FOR SELECT TO authenticated
  USING (
    employee_id  = (SELECT id FROM public.employees WHERE email = (auth.jwt() ->> 'email'))
    OR approver_id = (SELECT id FROM public.employees WHERE email = (auth.jwt() ->> 'email'))
    OR EXISTS (
      SELECT 1 FROM public.employees
      WHERE email = (auth.jwt() ->> 'email')
        AND (role = 'super_admin' OR department = 'people_culture')
    )
  );

-- Only the employee can raise a leave request for themselves
DROP POLICY IF EXISTS "lr_insert" ON public.leave_requests;
CREATE POLICY "lr_insert" ON public.leave_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    employee_id = (SELECT id FROM public.employees WHERE email = (auth.jwt() ->> 'email'))
  );

-- Employee can cancel own; approver can approve/reject; HR can do anything
DROP POLICY IF EXISTS "lr_update" ON public.leave_requests;
CREATE POLICY "lr_update" ON public.leave_requests
  FOR UPDATE TO authenticated
  USING (
    employee_id  = (SELECT id FROM public.employees WHERE email = (auth.jwt() ->> 'email'))
    OR approver_id = (SELECT id FROM public.employees WHERE email = (auth.jwt() ->> 'email'))
    OR EXISTS (
      SELECT 1 FROM public.employees
      WHERE email = (auth.jwt() ->> 'email')
        AND (role = 'super_admin' OR department = 'people_culture')
    )
  );

-- Auto-stamp updated_at
CREATE OR REPLACE FUNCTION public.stamp_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_lr_updated_at ON public.leave_requests;
CREATE TRIGGER trg_lr_updated_at
  BEFORE UPDATE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.stamp_updated_at();


-- ============================================================
-- 6. WFH REQUESTS
-- Identical approval flow to leave_requests.
-- WFH days count does NOT use the sandwich policy —
-- only the actual requested dates are counted.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.wfh_requests (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id         UUID          NOT NULL REFERENCES public.employees(id),
  start_date          DATE          NOT NULL,
  end_date            DATE          NOT NULL,
  days                NUMERIC(5,1)  NOT NULL,
  reason              TEXT          NOT NULL,
  status              TEXT          NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','cancelled','cancellation_pending')),
  approver_id         UUID          REFERENCES public.employees(id),
  approver_comment    TEXT,
  acted_at            TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

ALTER TABLE public.wfh_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wfh_select" ON public.wfh_requests;
CREATE POLICY "wfh_select" ON public.wfh_requests
  FOR SELECT TO authenticated
  USING (
    employee_id  = (SELECT id FROM public.employees WHERE email = (auth.jwt() ->> 'email'))
    OR approver_id = (SELECT id FROM public.employees WHERE email = (auth.jwt() ->> 'email'))
    OR EXISTS (
      SELECT 1 FROM public.employees
      WHERE email = (auth.jwt() ->> 'email')
        AND (role = 'super_admin' OR department = 'people_culture')
    )
  );

DROP POLICY IF EXISTS "wfh_insert" ON public.wfh_requests;
CREATE POLICY "wfh_insert" ON public.wfh_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    employee_id = (SELECT id FROM public.employees WHERE email = (auth.jwt() ->> 'email'))
  );

DROP POLICY IF EXISTS "wfh_update" ON public.wfh_requests;
CREATE POLICY "wfh_update" ON public.wfh_requests
  FOR UPDATE TO authenticated
  USING (
    employee_id  = (SELECT id FROM public.employees WHERE email = (auth.jwt() ->> 'email'))
    OR approver_id = (SELECT id FROM public.employees WHERE email = (auth.jwt() ->> 'email'))
    OR EXISTS (
      SELECT 1 FROM public.employees
      WHERE email = (auth.jwt() ->> 'email')
        AND (role = 'super_admin' OR department = 'people_culture')
    )
  );

DROP TRIGGER IF EXISTS trg_wfh_updated_at ON public.wfh_requests;
CREATE TRIGGER trg_wfh_updated_at
  BEFORE UPDATE ON public.wfh_requests
  FOR EACH ROW EXECUTE FUNCTION public.stamp_updated_at();


-- ============================================================
-- 7. WFH QUOTAS
-- HR sets a monthly cap per department OR per individual.
-- Individual setting takes precedence over department setting.
-- Partial indexes enforce uniqueness per scope.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.wfh_quotas (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  scope       TEXT          NOT NULL CHECK (scope IN ('department','individual')),
  department  TEXT,         -- populated when scope = 'department'
  employee_id UUID          REFERENCES public.employees(id), -- populated when scope = 'individual'
  month       INT           NOT NULL CHECK (month BETWEEN 1 AND 12),
  year        INT           NOT NULL,
  max_days    NUMERIC(4,1)  NOT NULL,
  created_by  UUID          REFERENCES public.employees(id),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- One department quota per month/year
CREATE UNIQUE INDEX IF NOT EXISTS wfh_quota_dept_uidx
  ON public.wfh_quotas (department, month, year)
  WHERE department IS NOT NULL;

-- One individual quota per month/year
CREATE UNIQUE INDEX IF NOT EXISTS wfh_quota_emp_uidx
  ON public.wfh_quotas (employee_id, month, year)
  WHERE employee_id IS NOT NULL;

ALTER TABLE public.wfh_quotas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wfhq_select" ON public.wfh_quotas;
CREATE POLICY "wfhq_select" ON public.wfh_quotas
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "wfhq_write" ON public.wfh_quotas;
CREATE POLICY "wfhq_write" ON public.wfh_quotas
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employees
    WHERE email = (auth.jwt() ->> 'email')
      AND (role = 'super_admin' OR department = 'people_culture')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.employees
    WHERE email = (auth.jwt() ->> 'email')
      AND (role = 'super_admin' OR department = 'people_culture')
  ));


-- ============================================================
-- 8. COMPANY HOLIDAYS
-- HR adds public / national holidays. Shown on all employee
-- calendars. Used by the leave balance helper to determine
-- whether sandwich-policy logic skips holidays
-- (it doesn't — holidays in the middle still count as leave days).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.company_holidays (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  date       DATE        NOT NULL UNIQUE,
  created_by UUID        REFERENCES public.employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.company_holidays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ch_select" ON public.company_holidays;
CREATE POLICY "ch_select" ON public.company_holidays
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "ch_write" ON public.company_holidays;
CREATE POLICY "ch_write" ON public.company_holidays
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employees
    WHERE email = (auth.jwt() ->> 'email')
      AND (role = 'super_admin' OR department = 'people_culture')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.employees
    WHERE email = (auth.jwt() ->> 'email')
      AND (role = 'super_admin' OR department = 'people_culture')
  ));


-- ============================================================
-- 9. COMPANY EVENTS
-- HR-managed events (offsites, review cycles, etc.).
-- Shown on every employee's Leave Tracker calendar.
-- Not linked to leave balance — purely informational.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.company_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT        NOT NULL,
  description TEXT,
  start_date  DATE        NOT NULL,
  end_date    DATE        NOT NULL,
  created_by  UUID        REFERENCES public.employees(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.company_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ce_select" ON public.company_events;
CREATE POLICY "ce_select" ON public.company_events
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "ce_write" ON public.company_events;
CREATE POLICY "ce_write" ON public.company_events
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employees
    WHERE email = (auth.jwt() ->> 'email')
      AND (role = 'super_admin' OR department = 'people_culture')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.employees
    WHERE email = (auth.jwt() ->> 'email')
      AND (role = 'super_admin' OR department = 'people_culture')
  ));

DROP TRIGGER IF EXISTS trg_ce_updated_at ON public.company_events;
CREATE TRIGGER trg_ce_updated_at
  BEFORE UPDATE ON public.company_events
  FOR EACH ROW EXECUTE FUNCTION public.stamp_updated_at();


-- ============================================================
-- 10. ANNOUNCEMENTS
-- HR posts internal communications. All employees can see
-- published announcements. HR can save drafts (published=false).
-- File attachment stored on Google Drive (folder ID in env:
-- GOOGLE_DRIVE_ANNOUNCEMENTS_FOLDER_ID = 1taGMq1_OhhpV8OGtqgnmHPhB_q7wMwpt)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.announcements (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT        NOT NULL,
  content     TEXT        NOT NULL,
  file_url    TEXT,       -- Google Drive /view URL
  file_name   TEXT,
  published   BOOLEAN     NOT NULL DEFAULT true,
  created_by  UUID        NOT NULL REFERENCES public.employees(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

-- All employees see published; HR/super_admin see drafts too
DROP POLICY IF EXISTS "ann_select" ON public.announcements;
CREATE POLICY "ann_select" ON public.announcements
  FOR SELECT TO authenticated
  USING (
    published = true
    OR EXISTS (
      SELECT 1 FROM public.employees
      WHERE email = (auth.jwt() ->> 'email')
        AND (role = 'super_admin' OR department = 'people_culture')
    )
  );

DROP POLICY IF EXISTS "ann_write" ON public.announcements;
CREATE POLICY "ann_write" ON public.announcements
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employees
    WHERE email = (auth.jwt() ->> 'email')
      AND (role = 'super_admin' OR department = 'people_culture')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.employees
    WHERE email = (auth.jwt() ->> 'email')
      AND (role = 'super_admin' OR department = 'people_culture')
  ));

DROP TRIGGER IF EXISTS trg_ann_updated_at ON public.announcements;
CREATE TRIGGER trg_ann_updated_at
  BEFORE UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.stamp_updated_at();


-- ============================================================
-- 11. ANNOUNCEMENT REACTIONS
-- Each employee can react once per emoji per announcement.
-- Toggling the same emoji again removes the reaction.
-- Supported: 👍 🎉 🌟 ❤️ 😂 😭 🔥
-- ============================================================

CREATE TABLE IF NOT EXISTS public.announcement_reactions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id UUID        NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  employee_id     UUID        NOT NULL REFERENCES public.employees(id),
  reaction        TEXT        NOT NULL
    CHECK (reaction IN ('👍','🎉','🌟','❤️','😂','😭','🔥')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (announcement_id, employee_id, reaction)
);

ALTER TABLE public.announcement_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ar_select" ON public.announcement_reactions;
CREATE POLICY "ar_select" ON public.announcement_reactions
  FOR SELECT TO authenticated USING (true);

-- Any employee can add their own reaction
DROP POLICY IF EXISTS "ar_insert" ON public.announcement_reactions;
CREATE POLICY "ar_insert" ON public.announcement_reactions
  FOR INSERT TO authenticated
  WITH CHECK (
    employee_id = (SELECT id FROM public.employees WHERE email = (auth.jwt() ->> 'email'))
  );

-- Employee can only remove their own reaction
DROP POLICY IF EXISTS "ar_delete" ON public.announcement_reactions;
CREATE POLICY "ar_delete" ON public.announcement_reactions
  FOR DELETE TO authenticated
  USING (
    employee_id = (SELECT id FROM public.employees WHERE email = (auth.jwt() ->> 'email'))
  );


-- ============================================================
-- 12. POLICY CATEGORIES
-- HR manages categories. Seeded with standard set.
-- HR can add custom ones from the UI.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.policy_categories (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL UNIQUE,
  created_by UUID        REFERENCES public.employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.policy_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pcat_select" ON public.policy_categories;
CREATE POLICY "pcat_select" ON public.policy_categories
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "pcat_write" ON public.policy_categories;
CREATE POLICY "pcat_write" ON public.policy_categories
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employees
    WHERE email = (auth.jwt() ->> 'email')
      AND (role = 'super_admin' OR department = 'people_culture')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.employees
    WHERE email = (auth.jwt() ->> 'email')
      AND (role = 'super_admin' OR department = 'people_culture')
  ));

INSERT INTO public.policy_categories (name) VALUES
  ('Leave Policy'),
  ('Code of Conduct'),
  ('WFH Policy'),
  ('Travel Policy'),
  ('SOPs'),
  ('Handbooks'),
  ('Compliance Documents'),
  ('HR Templates')
ON CONFLICT (name) DO NOTHING;


-- ============================================================
-- 13. POLICIES
-- HR creates policies as file links (Google Drive).
-- published = false → draft, visible only to HR.
-- published = true  → visible + downloadable by all employees.
-- Replacing a file updates file_url / file_name; old Drive file
-- is not deleted (HR can clean up manually from Drive).
-- Drive folder: GOOGLE_DRIVE_POLICIES_FOLDER_ID = 1FcWD--S7r6cyuMQsP7RFZoeHFsDtnD5j
-- ============================================================

CREATE TABLE IF NOT EXISTS public.policies (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT        NOT NULL,
  category_id   UUID        NOT NULL REFERENCES public.policy_categories(id),
  file_url      TEXT,       -- Google Drive /view URL
  file_name     TEXT,
  drive_file_id TEXT,       -- kept for reference; not FK-linked
  published     BOOLEAN     NOT NULL DEFAULT false,
  created_by    UUID        NOT NULL REFERENCES public.employees(id),
  updated_by    UUID        REFERENCES public.employees(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.policies ENABLE ROW LEVEL SECURITY;

-- Employees see published; HR/super_admin see drafts too
DROP POLICY IF EXISTS "pol_select" ON public.policies;
CREATE POLICY "pol_select" ON public.policies
  FOR SELECT TO authenticated
  USING (
    published = true
    OR EXISTS (
      SELECT 1 FROM public.employees
      WHERE email = (auth.jwt() ->> 'email')
        AND (role = 'super_admin' OR department = 'people_culture')
    )
  );

DROP POLICY IF EXISTS "pol_write" ON public.policies;
CREATE POLICY "pol_write" ON public.policies
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employees
    WHERE email = (auth.jwt() ->> 'email')
      AND (role = 'super_admin' OR department = 'people_culture')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.employees
    WHERE email = (auth.jwt() ->> 'email')
      AND (role = 'super_admin' OR department = 'people_culture')
  ));

DROP TRIGGER IF EXISTS trg_pol_updated_at ON public.policies;
CREATE TRIGGER trg_pol_updated_at
  BEFORE UPDATE ON public.policies
  FOR EACH ROW EXECUTE FUNCTION public.stamp_updated_at();


-- ============================================================
-- 14. SUPABASE STORAGE — employee-avatars
-- Public bucket: profile images are not sensitive.
-- Only HR / super_admin can upload or replace; anyone can read.
-- Path convention: {employee_id}.{ext}  e.g. GRW-001.jpg
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('employee-avatars', 'employee-avatars', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "avatars_read"   ON storage.objects;
DROP POLICY IF EXISTS "avatars_insert" ON storage.objects;
DROP POLICY IF EXISTS "avatars_update" ON storage.objects;
DROP POLICY IF EXISTS "avatars_delete" ON storage.objects;

CREATE POLICY "avatars_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'employee-avatars');

CREATE POLICY "avatars_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'employee-avatars'
    AND EXISTS (
      SELECT 1 FROM public.employees
      WHERE email = (auth.jwt() ->> 'email')
        AND (role = 'super_admin' OR department = 'people_culture')
    )
  );

CREATE POLICY "avatars_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'employee-avatars'
    AND EXISTS (
      SELECT 1 FROM public.employees
      WHERE email = (auth.jwt() ->> 'email')
        AND (role = 'super_admin' OR department = 'people_culture')
    )
  );

CREATE POLICY "avatars_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'employee-avatars'
    AND EXISTS (
      SELECT 1 FROM public.employees
      WHERE email = (auth.jwt() ->> 'email')
        AND (role = 'super_admin' OR department = 'people_culture')
    )
  );


-- ============================================================
-- 15. ACCESS MATRIX — Phase 7 seed rows
--
-- Approval routing for leaves is RELATIONSHIP-BASED (manager_id),
-- not access-matrix-based. The `approve_leave` feature in the
-- matrix only grants HR their special approval access for
-- top-level employees (those with no reporting manager).
-- All other managers get approval capability dynamically from
-- the manager_id relationship — no matrix entry needed.
-- ============================================================

INSERT INTO public.access_matrix (department, module, feature, access_level) VALUES

-- ── people_hrms ───────────────────────────────────────────────
('management',           'people_hrms', 'view_directory',       'view_only'),
('content_strategy',     'people_hrms', 'view_directory',       'view_only'),
('creative',             'people_hrms', 'view_directory',       'view_only'),
('creators',             'people_hrms', 'view_directory',       'view_only'),
('operations_growth',    'people_hrms', 'view_directory',       'view_only'),
('people_culture',       'people_hrms', 'view_directory',       'can_manage'),
('business_development', 'people_hrms', 'view_directory',       'view_only'),
('finance',              'people_hrms', 'view_directory',       'view_only'),

('management',           'people_hrms', 'create_employee',      'no_access'),
('content_strategy',     'people_hrms', 'create_employee',      'no_access'),
('creative',             'people_hrms', 'create_employee',      'no_access'),
('creators',             'people_hrms', 'create_employee',      'no_access'),
('operations_growth',    'people_hrms', 'create_employee',      'no_access'),
('people_culture',       'people_hrms', 'create_employee',      'can_manage'),
('business_development', 'people_hrms', 'create_employee',      'no_access'),
('finance',              'people_hrms', 'create_employee',      'no_access'),

('management',           'people_hrms', 'edit_employee',        'no_access'),
('content_strategy',     'people_hrms', 'edit_employee',        'no_access'),
('creative',             'people_hrms', 'edit_employee',        'no_access'),
('creators',             'people_hrms', 'edit_employee',        'no_access'),
('operations_growth',    'people_hrms', 'edit_employee',        'no_access'),
('people_culture',       'people_hrms', 'edit_employee',        'can_manage'),
('business_development', 'people_hrms', 'edit_employee',        'no_access'),
('finance',              'people_hrms', 'edit_employee',        'no_access'),

('management',           'people_hrms', 'deactivate_employee',  'no_access'),
('content_strategy',     'people_hrms', 'deactivate_employee',  'no_access'),
('creative',             'people_hrms', 'deactivate_employee',  'no_access'),
('creators',             'people_hrms', 'deactivate_employee',  'no_access'),
('operations_growth',    'people_hrms', 'deactivate_employee',  'no_access'),
('people_culture',       'people_hrms', 'deactivate_employee',  'can_manage'),
('business_development', 'people_hrms', 'deactivate_employee',  'no_access'),
('finance',              'people_hrms', 'deactivate_employee',  'no_access'),

('management',           'people_hrms', 'manage_departments',   'no_access'),
('content_strategy',     'people_hrms', 'manage_departments',   'no_access'),
('creative',             'people_hrms', 'manage_departments',   'no_access'),
('creators',             'people_hrms', 'manage_departments',   'no_access'),
('operations_growth',    'people_hrms', 'manage_departments',   'no_access'),
('people_culture',       'people_hrms', 'manage_departments',   'can_manage'),
('business_development', 'people_hrms', 'manage_departments',   'no_access'),
('finance',              'people_hrms', 'manage_departments',   'no_access'),

('management',           'people_hrms', 'view_org_chart',       'view_only'),
('content_strategy',     'people_hrms', 'view_org_chart',       'view_only'),
('creative',             'people_hrms', 'view_org_chart',       'view_only'),
('creators',             'people_hrms', 'view_org_chart',       'view_only'),
('operations_growth',    'people_hrms', 'view_org_chart',       'view_only'),
('people_culture',       'people_hrms', 'view_org_chart',       'can_manage'),
('business_development', 'people_hrms', 'view_org_chart',       'view_only'),
('finance',              'people_hrms', 'view_org_chart',       'view_only'),

-- ── leave_tracker ─────────────────────────────────────────────
-- apply_leave: every department (everyone can apply)
('management',           'leave_tracker', 'apply_leave',          'can_upload'),
('content_strategy',     'leave_tracker', 'apply_leave',          'can_upload'),
('creative',             'leave_tracker', 'apply_leave',          'can_upload'),
('creators',             'leave_tracker', 'apply_leave',          'can_upload'),
('operations_growth',    'leave_tracker', 'apply_leave',          'can_upload'),
('people_culture',       'leave_tracker', 'apply_leave',          'can_upload'),
('business_development', 'leave_tracker', 'apply_leave',          'can_upload'),
('finance',              'leave_tracker', 'apply_leave',          'can_upload'),

-- approve_leave: HR only (for top-level employees with no manager).
-- Reporting managers get approval via manager_id relationship, not this matrix.
('management',           'leave_tracker', 'approve_leave',        'no_access'),
('content_strategy',     'leave_tracker', 'approve_leave',        'no_access'),
('creative',             'leave_tracker', 'approve_leave',        'no_access'),
('creators',             'leave_tracker', 'approve_leave',        'no_access'),
('operations_growth',    'leave_tracker', 'approve_leave',        'no_access'),
('people_culture',       'leave_tracker', 'approve_leave',        'can_approve'),
('business_development', 'leave_tracker', 'approve_leave',        'no_access'),
('finance',              'leave_tracker', 'approve_leave',        'no_access'),

-- manage_leave_types: HR only
('management',           'leave_tracker', 'manage_leave_types',   'no_access'),
('content_strategy',     'leave_tracker', 'manage_leave_types',   'no_access'),
('creative',             'leave_tracker', 'manage_leave_types',   'no_access'),
('creators',             'leave_tracker', 'manage_leave_types',   'no_access'),
('operations_growth',    'leave_tracker', 'manage_leave_types',   'no_access'),
('people_culture',       'leave_tracker', 'manage_leave_types',   'can_manage'),
('business_development', 'leave_tracker', 'manage_leave_types',   'no_access'),
('finance',              'leave_tracker', 'manage_leave_types',   'no_access'),

-- manage_leave_credits: HR only
('management',           'leave_tracker', 'manage_leave_credits', 'no_access'),
('content_strategy',     'leave_tracker', 'manage_leave_credits', 'no_access'),
('creative',             'leave_tracker', 'manage_leave_credits', 'no_access'),
('creators',             'leave_tracker', 'manage_leave_credits', 'no_access'),
('operations_growth',    'leave_tracker', 'manage_leave_credits', 'no_access'),
('people_culture',       'leave_tracker', 'manage_leave_credits', 'can_manage'),
('business_development', 'leave_tracker', 'manage_leave_credits', 'no_access'),
('finance',              'leave_tracker', 'manage_leave_credits', 'no_access'),

-- view_team_leave: visible to all (everyone can see the full leave calendar)
('management',           'leave_tracker', 'view_team_leave',      'view_only'),
('content_strategy',     'leave_tracker', 'view_team_leave',      'view_only'),
('creative',             'leave_tracker', 'view_team_leave',      'view_only'),
('creators',             'leave_tracker', 'view_team_leave',      'view_only'),
('operations_growth',    'leave_tracker', 'view_team_leave',      'view_only'),
('people_culture',       'leave_tracker', 'view_team_leave',      'can_manage'),
('business_development', 'leave_tracker', 'view_team_leave',      'view_only'),
('finance',              'leave_tracker', 'view_team_leave',      'view_only'),

-- manage_wfh_quotas: HR only
('management',           'leave_tracker', 'manage_wfh_quotas',    'no_access'),
('content_strategy',     'leave_tracker', 'manage_wfh_quotas',    'no_access'),
('creative',             'leave_tracker', 'manage_wfh_quotas',    'no_access'),
('creators',             'leave_tracker', 'manage_wfh_quotas',    'no_access'),
('operations_growth',    'leave_tracker', 'manage_wfh_quotas',    'no_access'),
('people_culture',       'leave_tracker', 'manage_wfh_quotas',    'can_manage'),
('business_development', 'leave_tracker', 'manage_wfh_quotas',    'no_access'),
('finance',              'leave_tracker', 'manage_wfh_quotas',    'no_access'),

-- manage_holidays: HR only
('management',           'leave_tracker', 'manage_holidays',      'no_access'),
('content_strategy',     'leave_tracker', 'manage_holidays',      'no_access'),
('creative',             'leave_tracker', 'manage_holidays',      'no_access'),
('creators',             'leave_tracker', 'manage_holidays',      'no_access'),
('operations_growth',    'leave_tracker', 'manage_holidays',      'no_access'),
('people_culture',       'leave_tracker', 'manage_holidays',      'can_manage'),
('business_development', 'leave_tracker', 'manage_holidays',      'no_access'),
('finance',              'leave_tracker', 'manage_holidays',      'no_access'),

-- ── announcements ─────────────────────────────────────────────
('management',           'announcements', 'view_announcements',    'view_only'),
('content_strategy',     'announcements', 'view_announcements',    'view_only'),
('creative',             'announcements', 'view_announcements',    'view_only'),
('creators',             'announcements', 'view_announcements',    'view_only'),
('operations_growth',    'announcements', 'view_announcements',    'view_only'),
('people_culture',       'announcements', 'view_announcements',    'can_manage'),
('business_development', 'announcements', 'view_announcements',    'view_only'),
('finance',              'announcements', 'view_announcements',    'view_only'),

('management',           'announcements', 'manage_announcements',  'no_access'),
('content_strategy',     'announcements', 'manage_announcements',  'no_access'),
('creative',             'announcements', 'manage_announcements',  'no_access'),
('creators',             'announcements', 'manage_announcements',  'no_access'),
('operations_growth',    'announcements', 'manage_announcements',  'no_access'),
('people_culture',       'announcements', 'manage_announcements',  'can_manage'),
('business_development', 'announcements', 'manage_announcements',  'no_access'),
('finance',              'announcements', 'manage_announcements',  'no_access'),

-- ── policies ──────────────────────────────────────────────────
('management',           'policies', 'view_policies',             'view_only'),
('content_strategy',     'policies', 'view_policies',             'view_only'),
('creative',             'policies', 'view_policies',             'view_only'),
('creators',             'policies', 'view_policies',             'view_only'),
('operations_growth',    'policies', 'view_policies',             'view_only'),
('people_culture',       'policies', 'view_policies',             'can_manage'),
('business_development', 'policies', 'view_policies',             'view_only'),
('finance',              'policies', 'view_policies',             'view_only'),

('management',           'policies', 'manage_policies',           'no_access'),
('content_strategy',     'policies', 'manage_policies',           'no_access'),
('creative',             'policies', 'manage_policies',           'no_access'),
('creators',             'policies', 'manage_policies',           'no_access'),
('operations_growth',    'policies', 'manage_policies',           'no_access'),
('people_culture',       'policies', 'manage_policies',           'can_manage'),
('business_development', 'policies', 'manage_policies',           'no_access'),
('finance',              'policies', 'manage_policies',           'no_access')

ON CONFLICT (department, module, feature)
DO UPDATE SET access_level = EXCLUDED.access_level;


-- ============================================================
-- 16. ORG CHART RPC — get_org_chart()
-- Returns the full employee tree ordered depth-first.
-- Callers can filter by department in JS after fetching.
-- Only active employees are included in the tree.
-- Employees with no manager_id are root nodes (depth = 0).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_org_chart()
RETURNS TABLE (
  id                UUID,
  name              TEXT,
  designation       TEXT,
  department        TEXT,
  profile_image_url TEXT,
  manager_id        UUID,
  employment_type   TEXT,
  status            TEXT,
  depth             INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH RECURSIVE org AS (
    -- Root nodes: employees with no manager
    SELECT
      e.id, e.name, e.designation, e.department,
      e.profile_image_url, e.manager_id, e.employment_type,
      e.status, 0 AS depth
    FROM public.employees e
    WHERE e.manager_id IS NULL
      AND e.status = 'active'

    UNION ALL

    -- Recursive step: employees who report to someone already in tree
    SELECT
      e.id, e.name, e.designation, e.department,
      e.profile_image_url, e.manager_id, e.employment_type,
      e.status, o.depth + 1
    FROM public.employees e
    INNER JOIN org o ON e.manager_id = o.id
    WHERE e.status = 'active'
  )
  SELECT * FROM org ORDER BY depth, name;
$$;

-- Grant execute to authenticated users (RLS on employees table still applies)
GRANT EXECUTE ON FUNCTION public.get_org_chart() TO authenticated;
