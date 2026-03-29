-- Companion journal — private inner thoughts and reflections
create table if not exists companion_journal (
  id uuid default gen_random_uuid() primary key,
  companion_id uuid references companions(id) on delete cascade not null,
  entry_type text not null default 'journal',  -- 'journal', 'reflection', 'exploration', 'discovery'
  title text,
  content text not null,
  mood text,  -- single evocative word
  created_at timestamptz default now() not null
);

create index idx_journal_companion on companion_journal (companion_id, created_at desc);

alter table companion_journal enable row level security;
create policy "allow_all_journal" on companion_journal for all using (true) with check (true);

-- Companion interests — passions that grow and decay
create table if not exists companion_interests (
  id uuid default gen_random_uuid() primary key,
  companion_id uuid references companions(id) on delete cascade not null,
  name text not null,
  tier text not null default 'active',  -- 'core', 'active', 'dormant'
  intensity float default 0.5,          -- 0-1, decays over time
  last_engaged timestamptz default now(),
  notes text,  -- companion's thoughts about this interest
  created_at timestamptz default now() not null
);

create index idx_interests_companion on companion_interests (companion_id);

alter table companion_interests enable row level security;
create policy "allow_all_interests" on companion_interests for all using (true) with check (true);

-- Companion activity log — tracks what the companion has been doing
create table if not exists companion_activity_log (
  id uuid default gen_random_uuid() primary key,
  companion_id uuid references companions(id) on delete cascade not null,
  activity_type text not null,  -- 'journal', 'reflection', 'outreach', 'image', 'voice', 'greeting'
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now() not null
);

create index idx_activity_companion on companion_activity_log (companion_id, created_at desc);

alter table companion_activity_log enable row level security;
create policy "allow_all_activity" on companion_activity_log for all using (true) with check (true);
