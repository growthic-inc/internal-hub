-- Expand employee address into granular fields
-- Replaces the single text columns (address / permanent_address) with
-- structured sub-fields matching the profile wizard format.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS current_address_house_no   text,
  ADD COLUMN IF NOT EXISTS current_address_building   text,
  ADD COLUMN IF NOT EXISTS current_address_street     text,
  ADD COLUMN IF NOT EXISTS current_address_landmark   text,
  ADD COLUMN IF NOT EXISTS current_address_city       text,
  ADD COLUMN IF NOT EXISTS current_address_state      text,
  ADD COLUMN IF NOT EXISTS current_address_pincode    text,
  ADD COLUMN IF NOT EXISTS current_address_type       text,
  ADD COLUMN IF NOT EXISTS permanent_address_house_no text,
  ADD COLUMN IF NOT EXISTS permanent_address_building text,
  ADD COLUMN IF NOT EXISTS permanent_address_street   text,
  ADD COLUMN IF NOT EXISTS permanent_address_landmark text,
  ADD COLUMN IF NOT EXISTS permanent_address_city     text,
  ADD COLUMN IF NOT EXISTS permanent_address_state    text,
  ADD COLUMN IF NOT EXISTS permanent_address_pincode  text,
  ADD COLUMN IF NOT EXISTS permanent_address_type     text;
