-- Optional venue for a company event (e.g. "Office Lounge", "Third Wave").
-- Shown on the Home page event banner; informational only, nothing else reads it.
alter table company_events
  add column if not exists location text;
