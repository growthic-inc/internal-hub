-- ============================================================
-- ACCESS MATRIX — Feature-level 6-tier permissions
-- Run this in Supabase SQL editor
-- ============================================================

-- ── 1. Create table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS access_matrix (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  department   text NOT NULL,
  module       text NOT NULL,
  feature      text NOT NULL,
  access_level text NOT NULL DEFAULT 'no_access'
    CHECK (access_level IN ('no_access','view_only','can_upload','can_edit','can_manage','can_approve')),
  updated_at   timestamptz DEFAULT now(),
  CONSTRAINT access_matrix_dept_module_feature_unique UNIQUE (department, module, feature)
);

-- ── 2. RLS ───────────────────────────────────────────────────
ALTER TABLE access_matrix ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read the full matrix (needed at login)
CREATE POLICY "auth_read_access_matrix"
  ON access_matrix FOR SELECT
  TO authenticated
  USING (true);

-- Only super_admin can write
-- (employees table uses email, not auth_id, to link to auth users)
CREATE POLICY "super_admin_write_access_matrix"
  ON access_matrix FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.email = auth.jwt() ->> 'email'
        AND employees.role  = 'super_admin'
    )
  );

-- ── 3. Auto-update timestamp ─────────────────────────────────
CREATE OR REPLACE FUNCTION update_access_matrix_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_access_matrix_updated_at
  BEFORE UPDATE ON access_matrix
  FOR EACH ROW EXECUTE FUNCTION update_access_matrix_timestamp();

-- ── 4. Seed data ─────────────────────────────────────────────
-- Access levels: no_access(0) < view_only(1) < can_upload(2) < can_edit(3) < can_manage(4) < can_approve(5)
-- Higher levels include all lower levels.

INSERT INTO access_matrix (department, module, feature, access_level) VALUES

-- ── MANAGEMENT ───────────────────────────────────────────────
('management', 'client_dashboard',    'view_dashboard',          'view_only'),
('management', 'client_dashboard',    'upload_performance_data', 'can_manage'),
('management', 'client_dashboard',    'update_client_status',    'can_manage'),

('management', 'client_directory',    'view_clients',            'view_only'),
('management', 'client_directory',    'create_client',           'can_manage'),
('management', 'client_directory',    'edit_client',             'can_manage'),
('management', 'client_directory',    'brand_book',              'can_edit'),

('management', 'client_repository',   'view_files',              'view_only'),
('management', 'client_repository',   'upload_files',            'can_upload'),
('management', 'client_repository',   'manage_files',            'can_manage'),

('management', 'timesheet',           'log_entry',               'can_upload'),
('management', 'timesheet',           'submit_timesheet',        'can_upload'),
('management', 'timesheet',           'approve_timesheets',      'can_approve'),

('management', 'reimbursements',      'raise_pre_approval',      'can_upload'),
('management', 'reimbursements',      'raise_expense_claim',     'can_upload'),
('management', 'reimbursements',      'approve_requests',        'can_approve'),
('management', 'reimbursements',      'process_payment',         'no_access'),

('management', 'asset_management',    'view_assets',             'view_only'),
('management', 'asset_management',    'request_asset',           'can_upload'),
('management', 'asset_management',    'manage_assets',           'can_manage'),

('management', 'tools_subscriptions', 'view_tools',              'view_only'),
('management', 'tools_subscriptions', 'request_access',          'can_upload'),
('management', 'tools_subscriptions', 'manage_tools',            'can_manage'),
('management', 'tools_subscriptions', 'approve_requests',        'can_approve'),

('management', 'people_hrms',         'view_employees',          'can_manage'),
('management', 'people_hrms',         'manage_employees',        'can_manage'),
('management', 'people_hrms',         'manage_access',           'no_access'),

-- ── OPERATIONS & GROWTH ──────────────────────────────────────
('operations_growth', 'client_dashboard',    'view_dashboard',          'view_only'),
('operations_growth', 'client_dashboard',    'upload_performance_data', 'can_manage'),
('operations_growth', 'client_dashboard',    'update_client_status',    'can_manage'),

('operations_growth', 'client_directory',    'view_clients',            'view_only'),
('operations_growth', 'client_directory',    'create_client',           'can_manage'),
('operations_growth', 'client_directory',    'edit_client',             'can_manage'),
('operations_growth', 'client_directory',    'brand_book',              'can_edit'),

('operations_growth', 'client_repository',   'view_files',              'view_only'),
('operations_growth', 'client_repository',   'upload_files',            'can_upload'),
('operations_growth', 'client_repository',   'manage_files',            'can_manage'),

('operations_growth', 'timesheet',           'log_entry',               'can_upload'),
('operations_growth', 'timesheet',           'submit_timesheet',        'can_upload'),
('operations_growth', 'timesheet',           'approve_timesheets',      'can_approve'),

('operations_growth', 'reimbursements',      'raise_pre_approval',      'can_upload'),
('operations_growth', 'reimbursements',      'raise_expense_claim',     'can_upload'),
('operations_growth', 'reimbursements',      'approve_requests',        'can_approve'),
('operations_growth', 'reimbursements',      'process_payment',         'no_access'),

('operations_growth', 'asset_management',    'view_assets',             'view_only'),
('operations_growth', 'asset_management',    'request_asset',           'can_upload'),
('operations_growth', 'asset_management',    'manage_assets',           'can_manage'),

('operations_growth', 'tools_subscriptions', 'view_tools',              'view_only'),
('operations_growth', 'tools_subscriptions', 'request_access',          'can_upload'),
('operations_growth', 'tools_subscriptions', 'manage_tools',            'can_manage'),
('operations_growth', 'tools_subscriptions', 'approve_requests',        'can_approve'),

('operations_growth', 'people_hrms',         'view_employees',          'can_manage'),
('operations_growth', 'people_hrms',         'manage_employees',        'can_manage'),
('operations_growth', 'people_hrms',         'manage_access',           'no_access'),

-- ── PEOPLE & CULTURE ─────────────────────────────────────────
('people_culture', 'client_dashboard',    'view_dashboard',          'view_only'),
('people_culture', 'client_dashboard',    'upload_performance_data', 'no_access'),
('people_culture', 'client_dashboard',    'update_client_status',    'no_access'),

('people_culture', 'client_directory',    'view_clients',            'view_only'),
('people_culture', 'client_directory',    'create_client',           'no_access'),
('people_culture', 'client_directory',    'edit_client',             'no_access'),
('people_culture', 'client_directory',    'brand_book',              'no_access'),

('people_culture', 'client_repository',   'view_files',              'view_only'),
('people_culture', 'client_repository',   'upload_files',            'no_access'),
('people_culture', 'client_repository',   'manage_files',            'no_access'),

('people_culture', 'timesheet',           'log_entry',               'can_upload'),
('people_culture', 'timesheet',           'submit_timesheet',        'can_upload'),
('people_culture', 'timesheet',           'approve_timesheets',      'can_approve'),

('people_culture', 'reimbursements',      'raise_pre_approval',      'can_upload'),
('people_culture', 'reimbursements',      'raise_expense_claim',     'can_upload'),
('people_culture', 'reimbursements',      'approve_requests',        'can_approve'),
('people_culture', 'reimbursements',      'process_payment',         'no_access'),

('people_culture', 'asset_management',    'view_assets',             'view_only'),
('people_culture', 'asset_management',    'request_asset',           'can_upload'),
('people_culture', 'asset_management',    'manage_assets',           'can_manage'),

('people_culture', 'tools_subscriptions', 'view_tools',              'view_only'),
('people_culture', 'tools_subscriptions', 'request_access',          'can_upload'),
('people_culture', 'tools_subscriptions', 'manage_tools',            'can_manage'),
('people_culture', 'tools_subscriptions', 'approve_requests',        'can_approve'),

('people_culture', 'people_hrms',         'view_employees',          'can_manage'),
('people_culture', 'people_hrms',         'manage_employees',        'can_manage'),
('people_culture', 'people_hrms',         'manage_access',           'can_manage'),

-- ── BUSINESS DEVELOPMENT ─────────────────────────────────────
('business_development', 'client_dashboard',    'view_dashboard',          'view_only'),
('business_development', 'client_dashboard',    'upload_performance_data', 'no_access'),
('business_development', 'client_dashboard',    'update_client_status',    'no_access'),

('business_development', 'client_directory',    'view_clients',            'view_only'),
('business_development', 'client_directory',    'create_client',           'can_upload'),
('business_development', 'client_directory',    'edit_client',             'can_edit'),
('business_development', 'client_directory',    'brand_book',              'can_edit'),

('business_development', 'client_repository',   'view_files',              'view_only'),
('business_development', 'client_repository',   'upload_files',            'no_access'),
('business_development', 'client_repository',   'manage_files',            'no_access'),

('business_development', 'timesheet',           'log_entry',               'can_upload'),
('business_development', 'timesheet',           'submit_timesheet',        'can_upload'),
('business_development', 'timesheet',           'approve_timesheets',      'no_access'),

('business_development', 'reimbursements',      'raise_pre_approval',      'can_upload'),
('business_development', 'reimbursements',      'raise_expense_claim',     'can_upload'),
('business_development', 'reimbursements',      'approve_requests',        'no_access'),
('business_development', 'reimbursements',      'process_payment',         'no_access'),

('business_development', 'asset_management',    'view_assets',             'view_only'),
('business_development', 'asset_management',    'request_asset',           'no_access'),
('business_development', 'asset_management',    'manage_assets',           'no_access'),

('business_development', 'tools_subscriptions', 'view_tools',              'view_only'),
('business_development', 'tools_subscriptions', 'request_access',          'can_upload'),
('business_development', 'tools_subscriptions', 'manage_tools',            'no_access'),
('business_development', 'tools_subscriptions', 'approve_requests',        'no_access'),

('business_development', 'people_hrms',         'view_employees',          'no_access'),
('business_development', 'people_hrms',         'manage_employees',        'no_access'),
('business_development', 'people_hrms',         'manage_access',           'no_access'),

-- ── CONTENT STRATEGY ─────────────────────────────────────────
('content_strategy', 'client_dashboard',    'view_dashboard',          'view_only'),
('content_strategy', 'client_dashboard',    'upload_performance_data', 'no_access'),
('content_strategy', 'client_dashboard',    'update_client_status',    'no_access'),

('content_strategy', 'client_directory',    'view_clients',            'view_only'),
('content_strategy', 'client_directory',    'create_client',           'no_access'),
('content_strategy', 'client_directory',    'edit_client',             'no_access'),
('content_strategy', 'client_directory',    'brand_book',              'no_access'),

('content_strategy', 'client_repository',   'view_files',              'view_only'),
('content_strategy', 'client_repository',   'upload_files',            'can_upload'),
('content_strategy', 'client_repository',   'manage_files',            'no_access'),

('content_strategy', 'timesheet',           'log_entry',               'can_upload'),
('content_strategy', 'timesheet',           'submit_timesheet',        'can_upload'),
('content_strategy', 'timesheet',           'approve_timesheets',      'can_approve'),

('content_strategy', 'reimbursements',      'raise_pre_approval',      'can_upload'),
('content_strategy', 'reimbursements',      'raise_expense_claim',     'can_upload'),
('content_strategy', 'reimbursements',      'approve_requests',        'no_access'),
('content_strategy', 'reimbursements',      'process_payment',         'no_access'),

('content_strategy', 'asset_management',    'view_assets',             'view_only'),
('content_strategy', 'asset_management',    'request_asset',           'no_access'),
('content_strategy', 'asset_management',    'manage_assets',           'no_access'),

('content_strategy', 'tools_subscriptions', 'view_tools',              'view_only'),
('content_strategy', 'tools_subscriptions', 'request_access',          'can_upload'),
('content_strategy', 'tools_subscriptions', 'manage_tools',            'no_access'),
('content_strategy', 'tools_subscriptions', 'approve_requests',        'no_access'),

('content_strategy', 'people_hrms',         'view_employees',          'no_access'),
('content_strategy', 'people_hrms',         'manage_employees',        'no_access'),
('content_strategy', 'people_hrms',         'manage_access',           'no_access'),

-- ── CREATIVE ─────────────────────────────────────────────────
('creative', 'client_dashboard',    'view_dashboard',          'view_only'),
('creative', 'client_dashboard',    'upload_performance_data', 'no_access'),
('creative', 'client_dashboard',    'update_client_status',    'no_access'),

('creative', 'client_directory',    'view_clients',            'view_only'),
('creative', 'client_directory',    'create_client',           'no_access'),
('creative', 'client_directory',    'edit_client',             'no_access'),
('creative', 'client_directory',    'brand_book',              'no_access'),

('creative', 'client_repository',   'view_files',              'view_only'),
('creative', 'client_repository',   'upload_files',            'can_upload'),
('creative', 'client_repository',   'manage_files',            'no_access'),

('creative', 'timesheet',           'log_entry',               'can_upload'),
('creative', 'timesheet',           'submit_timesheet',        'can_upload'),
('creative', 'timesheet',           'approve_timesheets',      'can_approve'),

('creative', 'reimbursements',      'raise_pre_approval',      'can_upload'),
('creative', 'reimbursements',      'raise_expense_claim',     'can_upload'),
('creative', 'reimbursements',      'approve_requests',        'no_access'),
('creative', 'reimbursements',      'process_payment',         'no_access'),

('creative', 'asset_management',    'view_assets',             'view_only'),
('creative', 'asset_management',    'request_asset',           'no_access'),
('creative', 'asset_management',    'manage_assets',           'no_access'),

('creative', 'tools_subscriptions', 'view_tools',              'view_only'),
('creative', 'tools_subscriptions', 'request_access',          'can_upload'),
('creative', 'tools_subscriptions', 'manage_tools',            'no_access'),
('creative', 'tools_subscriptions', 'approve_requests',        'no_access'),

('creative', 'people_hrms',         'view_employees',          'no_access'),
('creative', 'people_hrms',         'manage_employees',        'no_access'),
('creative', 'people_hrms',         'manage_access',           'no_access'),

-- ── CREATORS ─────────────────────────────────────────────────
('creators', 'client_dashboard',    'view_dashboard',          'no_access'),
('creators', 'client_dashboard',    'upload_performance_data', 'no_access'),
('creators', 'client_dashboard',    'update_client_status',    'no_access'),

('creators', 'client_directory',    'view_clients',            'no_access'),
('creators', 'client_directory',    'create_client',           'no_access'),
('creators', 'client_directory',    'edit_client',             'no_access'),
('creators', 'client_directory',    'brand_book',              'no_access'),

('creators', 'client_repository',   'view_files',              'view_only'),
('creators', 'client_repository',   'upload_files',            'can_upload'),
('creators', 'client_repository',   'manage_files',            'no_access'),

('creators', 'timesheet',           'log_entry',               'can_upload'),
('creators', 'timesheet',           'submit_timesheet',        'can_upload'),
('creators', 'timesheet',           'approve_timesheets',      'no_access'),

('creators', 'reimbursements',      'raise_pre_approval',      'can_upload'),
('creators', 'reimbursements',      'raise_expense_claim',     'can_upload'),
('creators', 'reimbursements',      'approve_requests',        'no_access'),
('creators', 'reimbursements',      'process_payment',         'no_access'),

('creators', 'asset_management',    'view_assets',             'view_only'),
('creators', 'asset_management',    'request_asset',           'no_access'),
('creators', 'asset_management',    'manage_assets',           'no_access'),

('creators', 'tools_subscriptions', 'view_tools',              'view_only'),
('creators', 'tools_subscriptions', 'request_access',          'can_upload'),
('creators', 'tools_subscriptions', 'manage_tools',            'no_access'),
('creators', 'tools_subscriptions', 'approve_requests',        'no_access'),

('creators', 'people_hrms',         'view_employees',          'no_access'),
('creators', 'people_hrms',         'manage_employees',        'no_access'),
('creators', 'people_hrms',         'manage_access',           'no_access'),

-- ── FINANCE ──────────────────────────────────────────────────
('finance', 'client_dashboard',    'view_dashboard',          'view_only'),
('finance', 'client_dashboard',    'upload_performance_data', 'no_access'),
('finance', 'client_dashboard',    'update_client_status',    'no_access'),

('finance', 'client_directory',    'view_clients',            'view_only'),
('finance', 'client_directory',    'create_client',           'no_access'),
('finance', 'client_directory',    'edit_client',             'no_access'),
('finance', 'client_directory',    'brand_book',              'no_access'),

('finance', 'client_repository',   'view_files',              'view_only'),
('finance', 'client_repository',   'upload_files',            'no_access'),
('finance', 'client_repository',   'manage_files',            'no_access'),

('finance', 'timesheet',           'log_entry',               'can_upload'),
('finance', 'timesheet',           'submit_timesheet',        'can_upload'),
('finance', 'timesheet',           'approve_timesheets',      'no_access'),

('finance', 'reimbursements',      'raise_pre_approval',      'can_upload'),
('finance', 'reimbursements',      'raise_expense_claim',     'can_upload'),
('finance', 'reimbursements',      'approve_requests',        'can_approve'),
('finance', 'reimbursements',      'process_payment',         'can_approve'),

('finance', 'asset_management',    'view_assets',             'view_only'),
('finance', 'asset_management',    'request_asset',           'no_access'),
('finance', 'asset_management',    'manage_assets',           'no_access'),

('finance', 'tools_subscriptions', 'view_tools',              'view_only'),
('finance', 'tools_subscriptions', 'request_access',          'can_upload'),
('finance', 'tools_subscriptions', 'manage_tools',            'can_manage'),
('finance', 'tools_subscriptions', 'approve_requests',        'can_approve'),

('finance', 'people_hrms',         'view_employees',          'no_access'),
('finance', 'people_hrms',         'manage_employees',        'no_access'),
('finance', 'people_hrms',         'manage_access',           'no_access')

ON CONFLICT (department, module, feature)
DO UPDATE SET access_level = EXCLUDED.access_level, updated_at = now();
