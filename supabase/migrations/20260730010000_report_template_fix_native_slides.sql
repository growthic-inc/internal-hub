-- The original template file stored at reports.company_page_template_id
-- was a .pptx file merely being previewed inside Drive, not a genuine
-- native Google Slides document — the Slides API's batchUpdate refuses
-- to operate on Office-format files ("must not be an Office file").
-- Pointing this setting at the properly converted native Slides file.
UPDATE app_settings
SET value = '1Hdzf6U6zeyysd_4EcokCEDGbU7_eUrZl_pBEwfbH4lU', updated_at = now()
WHERE key = 'reports.company_page_template_id';
