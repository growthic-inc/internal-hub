-- Allows employees to request cancellation of specific days within a
-- multi-day leave or WFH request instead of the entire record.
-- NULL means full cancellation (existing behaviour); an array means partial.

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS cancellation_dates date[];

ALTER TABLE wfh_requests
  ADD COLUMN IF NOT EXISTS cancellation_dates date[];
