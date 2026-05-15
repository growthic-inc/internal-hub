-- ============================================================
-- Brain — Client Intelligence Schema
-- ============================================================

-- Add matching fields to clients
ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_domain text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_contacts text[] DEFAULT '{}';

-- Sync state per employee (where we left off in their inbox)
CREATE TABLE IF NOT EXISTS brain_sync_state (
  employee_id    uuid PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  last_synced_at timestamptz,
  history_id     bigint
);

-- Ingested email threads matched to clients
CREATE TABLE IF NOT EXISTS brain_threads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gmail_thread_id text NOT NULL UNIQUE,
  client_id       uuid REFERENCES clients(id) ON DELETE SET NULL,
  subject         text,
  participants    text[],
  first_date      timestamptz,
  last_date       timestamptz,
  message_count   int DEFAULT 1,
  snippet         text,
  body_text       text,
  data_class      text NOT NULL DEFAULT 'unclassified',
  processed       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Extracted attachments / documents
CREATE TABLE IF NOT EXISTS brain_documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id      uuid REFERENCES brain_threads(id) ON DELETE CASCADE,
  client_id      uuid REFERENCES clients(id) ON DELETE SET NULL,
  filename       text,
  mime_type      text,
  extracted_text text,
  doc_date       timestamptz,
  processed      boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Extracted intelligence items per client
CREATE TABLE IF NOT EXISTS brain_intelligence (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  data_class       text NOT NULL,
  category         text NOT NULL, -- decision | preference | contact | open_item | health_signal
  content          text NOT NULL,
  source_thread_id uuid REFERENCES brain_threads(id) ON DELETE SET NULL,
  source_date      timestamptz,
  verified         boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Daily health score snapshots per client
CREATE TABLE IF NOT EXISTS brain_health_scores (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  score      int NOT NULL CHECK (score >= 0 AND score <= 100),
  signals    jsonb,
  scored_at  date NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE(client_id, scored_at)
);

-- RLS
ALTER TABLE brain_sync_state   ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_threads       ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_documents     ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_intelligence  ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_health_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read brain_threads"       ON brain_threads       FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read brain_documents"     ON brain_documents     FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read brain_intelligence"  ON brain_intelligence  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read brain_health_scores" ON brain_health_scores FOR SELECT TO authenticated USING (true);
CREATE POLICY "service role full brain_sync_state"     ON brain_sync_state    FOR ALL   USING (true);
CREATE POLICY "service role full brain_threads"        ON brain_threads       FOR ALL   USING (auth.role() = 'service_role');
CREATE POLICY "service role full brain_documents"      ON brain_documents     FOR ALL   USING (auth.role() = 'service_role');
CREATE POLICY "service role full brain_intelligence"   ON brain_intelligence  FOR ALL   USING (auth.role() = 'service_role');
CREATE POLICY "service role full brain_health_scores"  ON brain_health_scores FOR ALL   USING (auth.role() = 'service_role');

-- Indexes
CREATE INDEX IF NOT EXISTS brain_threads_client_id_idx       ON brain_threads(client_id);
CREATE INDEX IF NOT EXISTS brain_threads_processed_idx        ON brain_threads(processed) WHERE processed = false;
CREATE INDEX IF NOT EXISTS brain_threads_last_date_idx        ON brain_threads(last_date DESC);
CREATE INDEX IF NOT EXISTS brain_intelligence_client_id_idx   ON brain_intelligence(client_id);
CREATE INDEX IF NOT EXISTS brain_intelligence_category_idx    ON brain_intelligence(client_id, category);
CREATE INDEX IF NOT EXISTS brain_health_scores_client_idx     ON brain_health_scores(client_id, scored_at DESC);
