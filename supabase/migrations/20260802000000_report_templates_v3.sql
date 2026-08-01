-- Both templates updated with the new Weekly Publishing Activity and
-- Audience (Growth + Demographics) slides.
UPDATE app_settings
SET value = '1YsohN0WCmqF0sV43Gz-LInx5faClMiyVSAmhKi9v7qw', updated_at = now()
WHERE key = 'reports.company_page_template_id';

UPDATE app_settings
SET value = '1DQSvweAvYi3BhA7_fp_IfRe1b4SDZoxshIwaUSCoWp8', updated_at = now()
WHERE key = 'reports.personal_profile_template_id';
