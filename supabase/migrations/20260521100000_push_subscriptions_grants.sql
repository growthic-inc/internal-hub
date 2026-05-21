-- Grant table-level access on push_subscriptions.
-- The table was created with RLS enabled but no GRANT, so the
-- authenticated role had no permission to read or write it at all —
-- every savePushSubscription() call failed with 42501.

GRANT SELECT, INSERT, UPDATE, DELETE ON push_subscriptions TO authenticated;
GRANT ALL                             ON push_subscriptions TO service_role;
