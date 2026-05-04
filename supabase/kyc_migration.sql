-- ============================================================
-- KYC & Compliance fields for employees table
-- Run in Supabase SQL Editor
-- ============================================================

-- KYC document URLs (uploaded to Google Drive)
ALTER TABLE employees ADD COLUMN IF NOT EXISTS kyc_aadhar_url        text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS kyc_pan_url           text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS kyc_passport_url      text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS kyc_passport_photo_url text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS kyc_submitted_at      timestamptz;

-- PEP (Politically Exposed Person) compliance
ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_pep boolean DEFAULT false;
