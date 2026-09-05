-- Reconciles the two credit types affected by the Indian-FY -> calendar-
-- year fix (20260905020000). The original YTD backfill (20260905010000)
-- computed Medical Leave / Mental Health Leave targets using April as
-- the yearly/half-yearly event month; the corrected policy uses
-- January (yearly) and January+July (half-yearly).
--
-- Additions (under-credited under the old April-only assumption, now
-- two half-yearly events — Jan and Jul — have occurred instead of one):
INSERT INTO leave_credits (employee_id, leave_type_id, year, credited_days, is_auto, credit_month)
SELECT e.id, lt.id, 2026, 0.5, false, NULL
FROM employees e, leave_types lt
WHERE e.name IN ('Manvi Sharma', 'Sunil Naudiyal', 'Yugansh Chokra')
  AND lt.name = 'Mental Health Leave';

-- Removal: Tudhgeet Kaur joined 2026-03-16, after the calendar year's
-- Jan 1 cutoff, so this year's Medical Leave grant (a yearly type) was
-- never actually due to her — her first one is January 2027. The 5.0
-- credit below is the single row the original backfill inserted for
-- her under the wrong April-cutoff assumption; she has zero Medical
-- Leave requests against it (confirmed before removing).
DELETE FROM leave_credits
WHERE id = 'cb25e7d5-5c02-46f0-8f93-56feade54e45';
