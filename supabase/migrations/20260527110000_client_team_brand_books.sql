-- ============================================================
-- Growthic One — Client Team Members + Brand Books
-- ============================================================

-- ── client_team_members ──────────────────────────────────────
-- Stores the many-to-many relationship between clients and
-- the employees assigned to work on them.

CREATE TABLE IF NOT EXISTS client_team_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES clients(id)   ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  added_by    uuid             REFERENCES employees(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, employee_id)
);

ALTER TABLE client_team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth select client_team_members" ON client_team_members
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth insert client_team_members" ON client_team_members
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "auth delete client_team_members" ON client_team_members
  FOR DELETE TO authenticated USING (true);

-- ── client_brand_books ────────────────────────────────────────
-- Tracks brand book PDFs uploaded to Google Drive for each client.
-- A client can have multiple brand books (e.g. one per entity/account).

CREATE TABLE IF NOT EXISTS client_brand_books (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name        text NOT NULL,
  drive_url   text NOT NULL,
  file_name   text NOT NULL,
  uploaded_by uuid REFERENCES employees(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE client_brand_books ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth select client_brand_books" ON client_brand_books
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth insert client_brand_books" ON client_brand_books
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "auth delete client_brand_books" ON client_brand_books
  FOR DELETE TO authenticated USING (true);
