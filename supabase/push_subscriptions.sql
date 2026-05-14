-- ============================================================
-- Push Subscriptions — Web Push device registrations
-- ============================================================

create table if not exists push_subscriptions (
  id          uuid        primary key default gen_random_uuid(),
  employee_id uuid        not null references employees(id) on delete cascade,
  endpoint    text        not null,
  p256dh      text        not null,
  auth        text        not null,
  created_at  timestamptz not null default now(),
  unique(employee_id, endpoint)
);

-- Employees can manage their own subscriptions
alter table push_subscriptions enable row level security;

create policy "employees manage own push subscriptions"
  on push_subscriptions
  for all
  to authenticated
  using (
    employee_id = (
      select id from employees
      where email ilike (select email from auth.users where id = auth.uid())
      limit 1
    )
  )
  with check (
    employee_id = (
      select id from employees
      where email ilike (select email from auth.users where id = auth.uid())
      limit 1
    )
  );

-- Index for fast lookup by employee
create index if not exists push_subscriptions_employee_id_idx
  on push_subscriptions(employee_id);
