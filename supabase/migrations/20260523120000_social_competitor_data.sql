-- Competitor analytics data uploaded from LinkedIn exports
CREATE TABLE IF NOT EXISTS social_competitor_data (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period_start      date        NOT NULL,
  period_end        date        NOT NULL,
  page_name         text        NOT NULL,
  total_followers   integer     NOT NULL DEFAULT 0,
  new_followers     integer     NOT NULL DEFAULT 0,
  total_engagements integer     NOT NULL DEFAULT 0,
  total_posts       integer     NOT NULL DEFAULT 0,
  uploaded_by       uuid        REFERENCES employees(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE social_competitor_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_select_competitor" ON social_competitor_data FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_competitor" ON social_competitor_data FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_delete_competitor" ON social_competitor_data FOR DELETE TO authenticated USING (true);

-- Unique: one row per client + period_start + page_name (enables upsert)
CREATE UNIQUE INDEX IF NOT EXISTS social_competitor_data_uk
  ON social_competitor_data (client_id, period_start, page_name);
