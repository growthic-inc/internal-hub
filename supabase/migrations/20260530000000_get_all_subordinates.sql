-- Recursive function: returns all employees in the reporting subtree
-- beneath a given manager (direct reports + their reports + so on).
-- Used by the Timesheet module to scope Team tab visibility to the full hierarchy.
CREATE OR REPLACE FUNCTION get_all_subordinates(root_manager_id uuid)
RETURNS TABLE(id uuid, name text, department text, profile_image_url text)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  WITH RECURSIVE subordinates AS (
    SELECT e.id, e.name, e.department, e.profile_image_url
    FROM   employees e
    WHERE  e.manager_id = root_manager_id
      AND  e.status = 'active'
    UNION ALL
    SELECT e.id, e.name, e.department, e.profile_image_url
    FROM   employees e
    INNER JOIN subordinates s ON e.manager_id = s.id
    WHERE  e.status = 'active'
  )
  SELECT * FROM subordinates ORDER BY name;
$$;
