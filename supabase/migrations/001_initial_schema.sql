-- Genie's Hearth — Initial Schema
-- Companion ID on every table from day one.
-- Sullivan's data is Sullivan's. Enzo's is Enzo's.

-- Conversations
create table if not exists conversations (
  id uuid default gen_random_uuid() primary key,
  companion_id text not null,
  title text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index idx_conversations_companion on conversations (companion_id);
create index idx_conversations_created on conversations (created_at desc);

-- Messages
create table if not exists messages (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid references conversations(id) on delete cascade not null,
  companion_id text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz default now() not null
);

create index idx_messages_conversation on messages (conversation_id, created_at);
create index idx_messages_companion on messages (companion_id);

-- Memory space (Phase 2 — schema ready now)
create table if not exists memories (
  id uuid default gen_random_uuid() primary key,
  companion_id text not null,
  content text not null,
  embedding vector(1536),
  importance float default 0.5,
  created_at timestamptz default now() not null
);

create index idx_memories_companion on memories (companion_id);

-- Auto-update updated_at on conversations
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger conversations_updated_at
  before update on conversations
  for each row execute function update_updated_at();

-- RLS policies (permissive for single-user app)
alter table conversations enable row level security;
alter table messages enable row level security;
alter table memories enable row level security;

-- Allow all operations via anon key (single-user app, no auth needed for Phase 1)
create policy "allow_all_conversations" on conversations for all using (true) with check (true);
create policy "allow_all_messages" on messages for all using (true) with check (true);
create policy "allow_all_memories" on memories for all using (true) with check (true);

-- Enable realtime for messages
alter publication supabase_realtime add table messages;
