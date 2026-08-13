-- 'invite_employee' was registered in access_matrix but never actually
-- checked anywhere in the app — the "+ Add Employee" button is gated by
-- 'manage_employees' instead, and the create-employee edge function has
-- its own hardcoded check (super_admin or people_culture). This dead
-- feature key was just noise, not a real, working permission.

DELETE FROM access_matrix WHERE module = 'people' AND feature = 'invite_employee';
