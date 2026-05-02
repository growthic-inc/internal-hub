/* ============================================================
   PROJECT CODES MIGRATION
   - Adds project_description to clients
   - Adds 'internal' as a valid client category
   - Seeds 7 internal projects as clients with category='internal'
   ============================================================ */

-- ── Add project description to clients ───────────────────────
ALTER TABLE clients ADD COLUMN IF NOT EXISTS project_description TEXT;

-- ── Extend category constraint to include 'internal' ─────────
-- Drop the existing check constraint (whatever it's named) and recreate it
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'clients'::regclass
      AND contype  = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%category%'
  LOOP
    EXECUTE format('ALTER TABLE clients DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- Use lower() so both 'Shark' and 'shark' pass (handles existing data regardless of casing)
ALTER TABLE clients ADD CONSTRAINT clients_category_check
  CHECK (lower(category) IN ('shark', 'dolphin', 'turtle', 'snail', 'internal') OR category IS NULL);

-- ── Seed internal projects as clients ────────────────────────
INSERT INTO clients (client_name, project_code, category, status, project_description) VALUES
  ('Growthic People & Culture',     'GRW-HR',   'internal', 'active', 'Log hours for any HR-related work: hiring, onboarding, policy, and people operations.'),
  ('Growthic Business Development', 'GRW-BDE',  'internal', 'active', 'Log hours for BDE activities: outreach, proposals, discovery calls, and events.'),
  ('Growthic Internal Meetings',    'GRW-MEET', 'internal', 'active', 'Log hours for all-hands, standups, and internal sync meetings.'),
  ('Growthic General',              'GRW',      'internal', 'active', 'Log hours for general Growthic internal work not covered by other categories.'),
  ('Relatable Office',              'INT-RO',   'internal', 'active', 'Log hours for work related to the Relatable Office brand.'),
  ('Furreal',                       'INT-FURR', 'internal', 'active', 'Log hours for work related to the Furreal brand.'),
  ('Naravio',                       'NARAV',    'internal', 'active', 'Log hours for work related to Naravio.')
ON CONFLICT (project_code) DO NOTHING;

-- ── Seed work-area entities for internal clients ─────────────
DO $$
DECLARE
  v_hr_id    UUID;
  v_bde_id   UUID;
  v_ro_id    UUID;
  v_furr_id  UUID;
  v_narav_id UUID;
BEGIN
  SELECT id INTO v_hr_id    FROM clients WHERE project_code = 'GRW-HR';
  SELECT id INTO v_bde_id   FROM clients WHERE project_code = 'GRW-BDE';
  SELECT id INTO v_ro_id    FROM clients WHERE project_code = 'INT-RO';
  SELECT id INTO v_furr_id  FROM clients WHERE project_code = 'INT-FURR';
  SELECT id INTO v_narav_id FROM clients WHERE project_code = 'NARAV';

  IF v_hr_id IS NOT NULL THEN
    INSERT INTO client_entities (client_id, entity_name) VALUES
      (v_hr_id, 'Hiring'),
      (v_hr_id, 'Interviews'),
      (v_hr_id, 'Onboarding'),
      (v_hr_id, 'Policy / Documentation'),
      (v_hr_id, 'Culture / Engagement'),
      (v_hr_id, 'Admin'),
      (v_hr_id, 'Internal Meeting'),
      (v_hr_id, 'Exit & Offboarding'),
      (v_hr_id, 'Performance Reviews / Appraisals'),
      (v_hr_id, 'Payroll & Attendance Coordination')
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_bde_id IS NOT NULL THEN
    INSERT INTO client_entities (client_id, entity_name) VALUES
      (v_bde_id, 'Outreach / Events / Followups'),
      (v_bde_id, 'Proposals / Deck / Presentation Prep'),
      (v_bde_id, 'Discovery Calls / Client Calls')
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_ro_id IS NOT NULL THEN
    INSERT INTO client_entities (client_id, entity_name) VALUES
      (v_ro_id, 'Outreach / Followups'),
      (v_ro_id, 'Content Strategy & Planning'),
      (v_ro_id, 'Content Creation & Review')
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_furr_id IS NOT NULL THEN
    INSERT INTO client_entities (client_id, entity_name) VALUES
      (v_furr_id, 'Outreach / Followups'),
      (v_furr_id, 'Content Strategy & Planning'),
      (v_furr_id, 'Content Creation & Review')
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_narav_id IS NOT NULL THEN
    INSERT INTO client_entities (client_id, entity_name) VALUES
      (v_narav_id, 'Outreach / Events / Followups'),
      (v_narav_id, 'Proposals / Deck / Presentation Prep'),
      (v_narav_id, 'Discovery Calls / Client Calls')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
