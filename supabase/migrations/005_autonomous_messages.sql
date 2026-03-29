-- Autonomous messages — companion-initiated outreach
create table if not exists autonomous_messages (
  id uuid default gen_random_uuid() primary key,
  companion_id uuid references companions(id) on delete cascade not null,
  content text not null,
  message_type text default 'spontaneous' not null,  -- 'morning', 'spontaneous', 'reflection_share', 'event'
  media_type text default 'text' not null,            -- 'text', 'voice', 'image'
  media_metadata jsonb default '{}'::jsonb,
  status text default 'pending' not null,             -- 'pending', 'push_sent', 'read'
  read_at timestamptz,
  created_at timestamptz default now() not null
);

create index idx_autonomous_status on autonomous_messages (status, created_at desc);
create index idx_autonomous_companion on autonomous_messages (companion_id, created_at desc);

-- RLS — single-user app, allow all
alter table autonomous_messages enable row level security;
create policy "allow_all_autonomous" on autonomous_messages for all using (true) with check (true);

-- Push subscriptions — store web push endpoints
create table if not exists push_subscriptions (
  id uuid default gen_random_uuid() primary key,
  endpoint text unique not null,
  keys jsonb not null,  -- { p256dh, auth }
  created_at timestamptz default now() not null
);

alter table push_subscriptions enable row level security;
create policy "allow_all_push_subs" on push_subscriptions for all using (true) with check (true);

-- Enable realtime for autonomous_messages
alter publication supabase_realtime add table autonomous_messages;
