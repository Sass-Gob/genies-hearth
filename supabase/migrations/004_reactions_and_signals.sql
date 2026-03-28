-- Add reactions JSONB column to messages
-- Format: [{ "emoji": "❤️", "by": "user" | "companion" }]
alter table messages
  add column if not exists reactions jsonb default '[]'::jsonb;

-- Companion signals table — tracks behavioral signals for companion awareness
create table if not exists companion_signals (
  id uuid default gen_random_uuid() primary key,
  companion_id uuid references companions(id) on delete cascade not null,
  signal_type text not null,            -- e.g. 'reaction', 'presence', 'mood'
  payload jsonb default '{}'::jsonb,    -- signal-specific data
  created_at timestamptz default now() not null
);

-- Index for querying recent signals per companion
create index if not exists idx_companion_signals_companion_created
  on companion_signals (companion_id, created_at desc);
