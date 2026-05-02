/* ============================================================
   PROJECT CODES MIGRATION — v2
   Run this in Supabase SQL Editor once the UI rebuild is complete.
   ============================================================ */

-- 1. Add project_description column to clients (safe to re-run)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS project_description TEXT;

-- ── 2. internal_projects ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS internal_projects (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT        NOT NULL,
  project_code TEXT        NOT NULL UNIQUE,
  category     TEXT        NOT NULL DEFAULT 'internal',
  description  TEXT,
  status       TEXT        NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'inactive')),
  sort_order   INTEGER     NOT NULL DEFAULT 0,
  created_by   UUID        REFERENCES employees(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backfill: if table existed from a prior run without category column, add it
ALTER TABLE internal_projects ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'internal';

-- ── 3. internal_project_entities ───────────────────────────────
CREATE TABLE IF NOT EXISTS internal_project_entities (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  internal_project_id UUID        NOT NULL REFERENCES internal_projects(id) ON DELETE CASCADE,
  entity_name         TEXT        NOT NULL,
  sort_order          INTEGER     NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 4. RLS ──────────────────────────────────────────────────────
ALTER TABLE internal_projects         ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_project_entities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "internal_projects_select"  ON internal_projects;
DROP POLICY IF EXISTS "internal_projects_all"     ON internal_projects;
DROP POLICY IF EXISTS "ip_entities_select"        ON internal_project_entities;
DROP POLICY IF EXISTS "ip_entities_all"           ON internal_project_entities;

CREATE POLICY "internal_projects_select"
  ON internal_projects FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "internal_projects_all"
  ON internal_projects FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "ip_entities_select"
  ON internal_project_entities FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "ip_entities_all"
  ON internal_project_entities FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

-- ── 5. Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_internal_projects_status
  ON internal_projects (status);

CREATE INDEX IF NOT EXISTS idx_ip_entities_project_sort
  ON internal_project_entities (internal_project_id, sort_order);

-- ── 6. Seed internal_projects ───────────────────────────────────
INSERT INTO internal_projects (name, project_code, category, description, sort_order)
VALUES
  ('Growthic People & Culture',   'GRW-HR',   'internal', 'Log hours for any HR-related work: hiring, onboarding, policy, and people operations.', 1),
  ('Growthic Business Development','GRW-BDE',  'internal', 'Log hours for BDE activities: outreach, proposals, discovery calls, and events.',        2),
  ('Growthic Internal Meetings',  'GRW-MEET', 'internal', 'Log hours for all-hands, standups, and internal sync meetings.',                          3),
  ('Growthic General',            'GRW',      'internal', 'Log hours for general Growthic internal work not covered by other categories.',            4),
  ('Relatable Office',            'INT-RO',   'internal', 'Log hours for work related to the Relatable Office brand.',                               5),
  ('Furreal',                     'INT-FURR', 'internal', 'Log hours for work related to the Furreal brand.',                                        6),
  ('Naravio',                     'NARAV',    'internal', 'Log hours for work related to Naravio.',                                                  7)
ON CONFLICT (project_code) DO NOTHING;

-- ── 7. Seed entities via PL/pgSQL ───────────────────────────────
DO $$
DECLARE
  v_hr_id   UUID;
  v_bde_id  UUID;
  v_ro_id   UUID;
  v_furr_id UUID;
  v_narav_id UUID;
BEGIN
  SELECT id INTO v_hr_id    FROM internal_projects WHERE project_code = 'GRW-HR';
  SELECT id INTO v_bde_id   FROM internal_projects WHERE project_code = 'GRW-BDE';
  SELECT id INTO v_ro_id    FROM internal_projects WHERE project_code = 'INT-RO';
  SELECT id INTO v_furr_id  FROM internal_projects WHERE project_code = 'INT-FURR';
  SELECT id INTO v_narav_id FROM internal_projects WHERE project_code = 'NARAV';

  -- GRW-HR entities
  INSERT INTO internal_project_entities (internal_project_id, entity_name, sort_order)
  VALUES
    (v_hr_id, 'Hiring',                              1),
    (v_hr_id, 'Interviews',                          2),
    (v_hr_id, 'Onboarding',                          3),
    (v_hr_id, 'Policy / Documentation',              4),
    (v_hr_id, 'Culture / Engagement',                5),
    (v_hr_id, 'Admin',                               6),
    (v_hr_id, 'Internal Meeting',                    7),
    (v_hr_id, 'Exit & Offboarding',                  8),
    (v_hr_id, 'Performance Reviews / Appraisals',    9),
    (v_hr_id, 'Payroll & Attendance Coordination',  10)
  ON CONFLICT DO NOTHING;

  -- GRW-BDE entities
  INSERT INTO internal_project_entities (internal_project_id, entity_name, sort_order)
  VALUES
    (v_bde_id, 'Outreach / Events / Followups',          1),
    (v_bde_id, 'Proposals / Deck / Presentation Prep',   2),
    (v_bde_id, 'Discovery Calls / Client Calls',         3)
  ON CONFLICT DO NOTHING;

  -- INT-RO entities
  INSERT INTO internal_project_entities (internal_project_id, entity_name, sort_order)
  VALUES
    (v_ro_id, 'Outreach / Followups',           1),
    (v_ro_id, 'Content Strategy & Planning',    2),
    (v_ro_id, 'Content Creation & Review',      3)
  ON CONFLICT DO NOTHING;

  -- INT-FURR entities (same as INT-RO)
  INSERT INTO internal_project_entities (internal_project_id, entity_name, sort_order)
  VALUES
    (v_furr_id, 'Outreach / Followups',           1),
    (v_furr_id, 'Content Strategy & Planning',    2),
    (v_furr_id, 'Content Creation & Review',      3)
  ON CONFLICT DO NOTHING;

  -- NARAV entities
  INSERT INTO internal_project_entities (internal_project_id, entity_name, sort_order)
  VALUES
    (v_narav_id, 'Outreach / Events / Followups',          1),
    (v_narav_id, 'Proposals / Deck / Presentation Prep',   2),
    (v_narav_id, 'Discovery Calls / Client Calls',         3)
  ON CONFLICT DO NOTHING;
END $$;
