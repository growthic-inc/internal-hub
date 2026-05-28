-- Growthic One — Add permanent_address column to employees
-- Supports the updated onboarding flow which now captures Current Address
-- and Permanent Address as separate fields.
-- The existing `address` column becomes the current/residential address.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS permanent_address text;
