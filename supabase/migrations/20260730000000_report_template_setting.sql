-- Client report export — the master Google Slides template's file ID,
-- stored in the shared Drive (contact@thegrowthic.com), used by the
-- report-generation automation to know which file to copy and fill in.
INSERT INTO app_settings (key, value, label, module) VALUES
  ('reports.company_page_template_id', '1aE94YxLWsks4l-rJxIb8UgeEXWWTMCfR', 'Company Page Report Template (Slides file ID)', 'reports')
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, updated_at = now();
