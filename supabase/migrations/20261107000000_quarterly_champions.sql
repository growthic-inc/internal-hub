-- ============================================================
-- Quarterly Champions
--
-- No new tables. Champion awards reuse the existing badge system:
--   badges           — one row per quarter + league  (e.g. "Q4 2026 Champion · Sales League")
--   employee_badges  — the winner of that badge, with the note (reason / reward)
--
-- This script:
--   1. adds two OPTIONAL columns to badges (period, league). Existing badges
--      keep NULL in both, so tenure / birthday / recognition badges are untouched.
--   2. lets HRMS Portal Access grantees (and super_admin) create, edit and
--      delete CHAMPION badges only (rows where period is not null).
--      badges had no write policy before, so nobody could change it from the app.
--
-- Deliberately NOT changed: employee_badges policies. Tenure/birthday badges are
-- awarded from each employee's own browser and managers award from People, so
-- tightening those would break them.
--
-- Needs hrms_portal_access() from the Portal Access script (already applied).
-- Safe to re-run.
-- ============================================================

alter table badges add column if not exists period text;   -- e.g. '2026-Q4'
alter table badges add column if not exists league text;   -- e.g. 'Sales League'

create index if not exists badges_period_idx on badges (period) where period is not null;

drop policy if exists badges_champion_insert on badges;
create policy badges_champion_insert on badges for insert to authenticated
  with check (
    period is not null
    and (
      hrms_portal_access()
      or exists (select 1 from employees e
                 where e.email = (auth.jwt() ->> 'email') and e.role = 'super_admin')
    )
  );

drop policy if exists badges_champion_update on badges;
create policy badges_champion_update on badges for update to authenticated
  using (
    period is not null
    and (
      hrms_portal_access()
      or exists (select 1 from employees e
                 where e.email = (auth.jwt() ->> 'email') and e.role = 'super_admin')
    )
  )
  with check (period is not null);

drop policy if exists badges_champion_delete on badges;
create policy badges_champion_delete on badges for delete to authenticated
  using (
    period is not null
    and (
      hrms_portal_access()
      or exists (select 1 from employees e
                 where e.email = (auth.jwt() ->> 'email') and e.role = 'super_admin')
    )
  );

-- ── UNDO (run only if you want to remove this feature) ─────────────
-- delete from badges where period is not null;      -- also removes the awards (cascade)
-- drop policy if exists badges_champion_insert on badges;
-- drop policy if exists badges_champion_update on badges;
-- drop policy if exists badges_champion_delete on badges;
-- drop index  if exists badges_period_idx;
-- alter table badges drop column if exists period, drop column if exists league;
