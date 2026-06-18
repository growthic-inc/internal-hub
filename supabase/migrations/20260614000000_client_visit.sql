-- ============================================================
-- Client Visit — new attendance request type (mirrors WFH)
--
--   * Employee submits a Client Visit (client + entity + duration
--     + date/range + reason)
--   * Reporting Manager approves / rejects (same flow as WFH)
--   * Approved full-day / multi-day visits auto-materialize editable
--     draft Timesheet entries (one per date); half-day visits do not
--     (they only show as context in the Timesheet)
--   * Treated as a working day in Attendance (never marked absent)
-- ============================================================

BEGIN;

-- ── Table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_visit_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id         UUID NOT NULL REFERENCES employees(id),
  client_id           UUID NOT NULL REFERENCES clients(id),
  entity_id           UUID REFERENCES client_entities(id),
  duration_type       TEXT NOT NULL DEFAULT 'full_day'
                        CHECK (duration_type IN ('full_day','first_half','second_half')),
  start_date          DATE NOT NULL,
  end_date            DATE NOT NULL,
  days                NUMERIC,
  reason              TEXT,
  status              TEXT NOT NULL DEFAULT 'pending',
  approver_id         UUID REFERENCES employees(id),
  approver_comment    TEXT,
  acted_at            TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cv_employee_idx ON client_visit_requests (employee_id, status);
CREATE INDEX IF NOT EXISTS cv_approver_idx ON client_visit_requests (approver_id);
CREATE INDEX IF NOT EXISTS cv_dates_idx    ON client_visit_requests (start_date, end_date);

-- ── RLS (mirrors wfh_requests; HR check is rename-safe via _is_dept_admin) ──
ALTER TABLE client_visit_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY cv_insert ON client_visit_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    employee_id = (SELECT id FROM employees WHERE email = (auth.jwt() ->> 'email'))
  );

CREATE POLICY cv_select ON client_visit_requests
  FOR SELECT TO public
  USING (
    employee_id = (SELECT id FROM employees WHERE email = (auth.jwt() ->> 'email'))
    OR approver_id = (SELECT id FROM employees WHERE email = (auth.jwt() ->> 'email'))
    OR (status = 'approved' AND auth.uid() IN (SELECT id FROM employees WHERE status = 'active'))
    OR _is_dept_admin()
  );

CREATE POLICY cv_update ON client_visit_requests
  FOR UPDATE TO authenticated
  USING (
    employee_id = (SELECT id FROM employees WHERE email = (auth.jwt() ->> 'email'))
    OR approver_id = (SELECT id FROM employees WHERE email = (auth.jwt() ->> 'email'))
    OR _is_dept_admin()
  );

-- ── Link Timesheet entries back to the visit that generated them ─
ALTER TABLE timesheets
  ADD COLUMN IF NOT EXISTS source_client_visit_id UUID
    REFERENCES client_visit_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ts_source_client_visit_idx
  ON timesheets (source_client_visit_id);

-- ── Auto-materialize Timesheet entries on approval ────────────
-- Full-day (incl. multi-day) approved visits create one editable DRAFT
-- entry per date. Half-day visits create nothing (context only). Runs
-- as definer so a manager approving someone else's visit can write the
-- requester's timesheet rows.
CREATE OR REPLACE FUNCTION materialize_client_visit_timesheet()
RETURNS TRIGGER AS $$
DECLARE
  d         DATE;
  v_reason  TEXT;
  v_pcode   TEXT;
BEGIN
  -- Remove any previously auto-generated rows that the employee hasn't
  -- touched yet (still draft). Submitted/approved ones are left intact.
  DELETE FROM timesheets
   WHERE source_client_visit_id = NEW.id
     AND status = 'draft';

  IF NEW.status = 'approved' AND NEW.duration_type = 'full_day' THEN
    v_reason := COALESCE(NULLIF(btrim(NEW.reason), ''), 'Client Visit');
    SELECT project_code INTO v_pcode FROM clients WHERE id = NEW.client_id;

    d := NEW.start_date;
    WHILE d <= NEW.end_date LOOP
      INSERT INTO timesheets (
        employee_id, work_type, client_id, entity_id, project_code,
        date, hours, task_description, work_description,
        status, is_late, source_client_visit_id, created_at, updated_at
      ) VALUES (
        NEW.employee_id, 'client', NEW.client_id, NEW.entity_id, v_pcode,
        d, 8, 'Client Visit — ' || v_reason, v_reason,
        'draft', false, NEW.id, now(), now()
      );
      d := d + 1;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_materialize_client_visit ON client_visit_requests;
CREATE TRIGGER trg_materialize_client_visit
  AFTER INSERT OR UPDATE OF status ON client_visit_requests
  FOR EACH ROW EXECUTE FUNCTION materialize_client_visit_timesheet();

COMMIT;
