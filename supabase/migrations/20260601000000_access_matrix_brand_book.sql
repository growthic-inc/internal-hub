-- Add brand_book feature to client_directory access matrix
-- management and operations_growth: can_edit (upload + delete)
-- business_development: can_edit (upload + delete)
-- all other departments: no_access

INSERT INTO access_matrix (department, module, feature, access_level) VALUES
('management',          'client_directory', 'brand_book', 'can_edit'),
('operations_growth',   'client_directory', 'brand_book', 'can_edit'),
('people_culture',      'client_directory', 'brand_book', 'no_access'),
('business_development','client_directory', 'brand_book', 'can_edit'),
('content_strategy',    'client_directory', 'brand_book', 'no_access'),
('creative',            'client_directory', 'brand_book', 'no_access'),
('creators',            'client_directory', 'brand_book', 'no_access'),
('finance',             'client_directory', 'brand_book', 'no_access')
ON CONFLICT (department, module, feature) DO UPDATE
  SET access_level = EXCLUDED.access_level;
