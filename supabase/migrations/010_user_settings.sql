-- User settings — single-user app, one row
create table if not exists user_settings (
  id uuid default gen_random_uuid() primary key,
  timezone text default 'Europe/London' not null,
  display_name text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table user_settings enable row level security;
create policy "allow_all_user_settings" on user_settings for all using (true) with check (true);

-- Seed a default row
insert into user_settings (timezone, display_name) values ('Europe/London', 'Genie')
on conflict do nothing;
