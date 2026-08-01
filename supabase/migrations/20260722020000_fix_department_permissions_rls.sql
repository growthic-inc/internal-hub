-- Security fix: department_permissions had a leftover "allow_all_for_now"
-- policy (USING (true), all commands, all roles including anon) that made
-- the entire table world-readable and world-writable — bypassing the
-- properly-scoped read/write policies sitting right next to it.
--
-- The Permissions Control Panel frontend that would use this table isn't
-- even wired into navigation today (no registered route), so nothing live
-- depends on this open policy. Dropping it lets the existing correct
-- policies (authenticated read, super_admin write) take over as intended.
DROP POLICY IF EXISTS allow_all_for_now ON department_permissions;
