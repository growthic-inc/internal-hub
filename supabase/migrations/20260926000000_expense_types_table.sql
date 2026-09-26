-- Expense types were a hardcoded list copy-pasted in three places in the
-- frontend (the claim form, the pre-approval form, and HR's filter
-- dropdown). Move them into a real table, managed from HRMS Settings,
-- the same way leave_types already works for the Leave Tracker.
create table if not exists expense_types (
  id         uuid primary key default gen_random_uuid(),
  value      text not null unique,   -- stable slug stored on reimbursements.expense_type
  name       text not null,          -- editable display label
  is_active  boolean not null default true,
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now()
);

insert into expense_types (value, name) values
  ('travel',                  'Travel (Cab / Train / Flight)'),
  ('food_meals',              'Food & Meals'),
  ('printing_stationery',     'Printing & Stationery'),
  ('internet_communication',  'Internet & Communication'),
  ('photography_videography', 'Photography & Videography'),
  ('event_venue',             'Event & Venue'),
  ('software_tools',          'Software & Tools'),
  ('courier_delivery',        'Courier & Delivery'),
  ('marketing_materials',     'Marketing Materials'),
  ('accommodation',           'Accommodation'),
  ('other',                   'Other')
on conflict (value) do nothing;

-- Swap the fixed CHECK list for a real FK, so new rows in expense_types
-- are immediately usable on reimbursements without a code change/deploy.
-- RESTRICT (the default) blocks deleting a type that's still referenced —
-- deactivating it is the correct way to retire one.
alter table reimbursements drop constraint if exists reimbursements_expense_type_check;
alter table reimbursements
  add constraint reimbursements_expense_type_fkey
  foreign key (expense_type) references expense_types(value);

alter table expense_types enable row level security;

-- Everyone can read the list (need it to populate claim/pre-approval forms).
create policy et_select on expense_types for select using (true);

-- Only super_admin / People & Culture can add, rename, activate, or delete
-- a type — same authors as leave_types.
create policy et_write on expense_types for all
  using (
    exists (
      select 1 from employees
      where employees.email = (auth.jwt() ->> 'email')
        and (employees.role = 'super_admin' or employees.department = 'people_culture')
    )
  )
  with check (
    exists (
      select 1 from employees
      where employees.email = (auth.jwt() ->> 'email')
        and (employees.role = 'super_admin' or employees.department = 'people_culture')
    )
  );
