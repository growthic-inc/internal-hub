-- Track when an employee accepted the company policies acknowledgement.
-- NULL = not yet acknowledged (modules locked except the whitelist).
-- Timestamp = accepted; all modules unlock per their normal access matrix.
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS policy_acknowledged_at timestamptz;
