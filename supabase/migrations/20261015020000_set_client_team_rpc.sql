-- #10: Move setClientTeam to an atomic server-side RPC so the
-- delete + insert happens in a single transaction. A client-side
-- delete-then-insert can leave the team empty if the insert fails.

CREATE OR REPLACE FUNCTION set_client_team(
  p_client_id   uuid,
  p_employee_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM client_team_members WHERE client_id = p_client_id;
  IF array_length(p_employee_ids, 1) IS NOT NULL THEN
    INSERT INTO client_team_members (client_id, employee_id)
    SELECT p_client_id, unnest(p_employee_ids);
  END IF;
END;
$$;
