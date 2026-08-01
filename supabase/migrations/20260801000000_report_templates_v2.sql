-- Two rebuilt Slides templates: the Company Page template replaced
-- (fixing the box-overlap/format issues found in the first real test),
-- and the Personal Profile template registered for the first time.
UPDATE app_settings
SET value = '1P_6TGKQacmiSaYp2QwkyrcvwDZ5ZMyNn2WbTtlh-ThI', updated_at = now()
WHERE key = 'reports.company_page_template_id';

INSERT INTO app_settings (key, value, label, module) VALUES
  ('reports.personal_profile_template_id', '104gOBsuxkaJHv_sGAhlWriDZqfmAcVw6fZdQwNWSgEY', 'Personal Profile Report Template (Slides file ID)', 'reports')
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, updated_at = now();
