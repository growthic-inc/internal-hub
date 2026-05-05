/* ============================================================
   BADGES SYSTEM — Migration
   Tables: badges (catalogue), employee_badges (awards)
   ============================================================ */

-- ── Master badge catalogue ─────────────────────────────────────
create table if not exists badges (
  id             uuid        primary key default gen_random_uuid(),
  name           text        not null,
  description    text,
  icon           text        not null default '🏅',
  colour         text        not null default '#0F4799',
  category       text        not null check (category in ('tenure', 'special', 'recognition')),
  criteria_type  text        not null check (criteria_type in ('auto', 'manual')),
  criteria_months int,                  -- tenure badges only: months of service required
  sort_order     int         not null default 0,
  active         boolean     not null default true,
  created_at     timestamptz not null default now()
);

-- ── Employee badge awards ──────────────────────────────────────
create table if not exists employee_badges (
  id              uuid        primary key default gen_random_uuid(),
  employee_id     uuid        not null references employees(id) on delete cascade,
  badge_id        uuid        not null references badges(id)    on delete cascade,
  awarded_at      timestamptz not null default now(),
  awarded_by      uuid        references employees(id),         -- null = auto-awarded
  note            text,
  -- tenure + recognition badges are unique per employee
  -- birthday badge handled in app (deleted + re-awarded each year)
  unique (employee_id, badge_id)
);

-- Indexes
create index if not exists employee_badges_employee_idx on employee_badges(employee_id);
create index if not exists employee_badges_badge_idx    on employee_badges(badge_id);

-- ── RLS ───────────────────────────────────────────────────────
alter table badges          enable row level security;
alter table employee_badges enable row level security;

-- All authenticated users can read
create policy "badges_select"
  on badges for select to authenticated using (true);

create policy "employee_badges_select"
  on employee_badges for select to authenticated using (true);

-- Inserts + deletes controlled at app layer (service role / trusted client)
create policy "employee_badges_insert"
  on employee_badges for insert to authenticated with check (true);

create policy "employee_badges_delete"
  on employee_badges for delete to authenticated using (true);

-- ── Seed: Badge Catalogue ──────────────────────────────────────
insert into badges (name, description, icon, colour, category, criteria_type, criteria_months, sort_order)
values

  -- ── Tenure (auto) ─────────────────────────────────────────
  ('3 Month Club',
   'Made it past the hardest part. Welcome to the crew.',
   '🌱', '#16a34a', 'tenure', 'auto', 3, 10),

  ('Half Year Hero',
   'Six months in and still going strong.',
   '⚡', '#0891b2', 'tenure', 'auto', 6, 20),

  ('One Year Strong',
   'A full trip around the sun. Officially a Growthic veteran.',
   '🏆', '#d97706', 'tenure', 'auto', 12, 30),

  ('Loyal Crew',
   'Two years and still crushing it.',
   '🔥', '#dc2626', 'tenure', 'auto', 24, 40),

  ('Three Year Legend',
   'You''ve seen it all and built a lot.',
   '⭐', '#7c3aed', 'tenure', 'auto', 36, 50),

  ('Growthic Veteran',
   'Four years of grit, growth, and showing up.',
   '🛡️', '#0F4799', 'tenure', 'auto', 48, 60),

  ('Five Year Icon',
   'A rare breed. Five years of building Growthic.',
   '👑', '#b45309', 'tenure', 'auto', 60, 70),

  ('Growthic OG',
   'Six+ years in. You basically built this place.',
   '🏅', '#1e3a8a', 'tenure', 'auto', 72, 80),

  -- ── Special (auto) ────────────────────────────────────────
  ('Birthday Star',
   'It''s your week — celebrate!',
   '🎂', '#db2777', 'special', 'auto', null, 5),

  -- ── Recognition (manual) ──────────────────────────────────
  ('Rockstar',
   'Exceptional performance this month.',
   '🌟', '#f59e0b', 'recognition', 'manual', null, 100),

  ('Big Brain',
   'Brought a game-changing idea to the table.',
   '💡', '#8b5cf6', 'recognition', 'manual', null, 110),

  ('Team Player',
   'Always shows up for the team, no questions asked.',
   '🤝', '#0891b2', 'recognition', 'manual', null, 120),

  ('Above & Beyond',
   'Went the extra mile when it mattered.',
   '🚀', '#0F4799', 'recognition', 'manual', null, 130),

  ('Client Champion',
   'Received exceptional client feedback.',
   '🎯', '#16a34a', 'recognition', 'manual', null, 140),

  ('Fast Learner',
   'Picked up new skills at an impressive pace.',
   '⚡', '#0891b2', 'recognition', 'manual', null, 150),

  ('Culture Carrier',
   'Truly embodies what Growthic stands for.',
   '🌱', '#16a34a', 'recognition', 'manual', null, 160),

  ('Mentor',
   'Makes the people around them better.',
   '🦮', '#7c3aed', 'recognition', 'manual', null, 170),

  ('Problem Solver',
   'Turned a tough situation completely around.',
   '🔧', '#dc2626', 'recognition', 'manual', null, 180),

  ('On Fire',
   'Consistently crushing it right now.',
   '🔥', '#f97316', 'recognition', 'manual', null, 190)

on conflict do nothing;
