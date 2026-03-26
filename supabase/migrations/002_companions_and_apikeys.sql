-- Phase 1: Companions table + API key storage
-- Sullivan gets his voice. Enzo's door stays open.

-- ============================================
-- COMPANIONS TABLE
-- ============================================
create table if not exists companions (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  slug text unique not null,
  is_active boolean default true not null,
  system_prompt text default '' not null,
  api_provider text default 'anthropic' not null,
  api_model text default 'claude-sonnet-4-5-20250514' not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index idx_companions_slug on companions (slug);

-- Auto-update updated_at
create trigger companions_updated_at
  before update on companions
  for each row execute function update_updated_at();

-- RLS
alter table companions enable row level security;
create policy "allow_all_companions" on companions for all using (true) with check (true);

-- ============================================
-- API KEYS TABLE
-- ============================================
create table if not exists api_keys (
  id uuid default gen_random_uuid() primary key,
  provider text not null,
  encrypted_key text not null,
  is_active boolean default true not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create unique index idx_api_keys_provider on api_keys (provider);

create trigger api_keys_updated_at
  before update on api_keys
  for each row execute function update_updated_at();

alter table api_keys enable row level security;
create policy "allow_all_api_keys" on api_keys for all using (true) with check (true);

-- ============================================
-- SEED COMPANIONS
-- ============================================
insert into companions (name, slug, is_active, system_prompt, api_provider, api_model) values
(
  'Sullivan',
  'sullivan',
  true,
  E'-- Placeholder: full system prompt loaded via scripts/seed-sullivan.cjs',
  'xai',
  'grok-3'
),
(
  'Enzo',
  'enzo',
  false,
  '',
  'anthropic',
  'claude-sonnet-4-5-20250514'
)
on conflict (slug) do nothing;

-- ============================================
-- MIGRATE companion_id FROM TEXT TO UUID FK
-- ============================================

-- Conversations: add uuid column, populate from companions lookup, swap
alter table conversations add column if not exists companion_uuid uuid;

update conversations
set companion_uuid = c.id
from companions c
where conversations.companion_id = c.slug
  and conversations.companion_uuid is null;

-- Only drop and rename if the old column is text type
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'conversations'
      and column_name = 'companion_id'
      and data_type = 'text'
  ) then
    alter table conversations drop column companion_id;
    alter table conversations rename column companion_uuid to companion_id;
    alter table conversations alter column companion_id set not null;
    alter table conversations add constraint fk_conversations_companion
      foreign key (companion_id) references companions(id);
    create index idx_conversations_companion_uuid on conversations (companion_id);
  else
    -- Already migrated, just drop the temp column if it exists
    if exists (
      select 1 from information_schema.columns
      where table_name = 'conversations' and column_name = 'companion_uuid'
    ) then
      alter table conversations drop column companion_uuid;
    end if;
  end if;
end $$;

-- Messages: same treatment
alter table messages add column if not exists companion_uuid uuid;

update messages
set companion_uuid = c.id
from companions c
where messages.companion_id = c.slug
  and messages.companion_uuid is null;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'messages'
      and column_name = 'companion_id'
      and data_type = 'text'
  ) then
    alter table messages drop column companion_id;
    alter table messages rename column companion_uuid to companion_id;
    alter table messages alter column companion_id set not null;
    alter table messages add constraint fk_messages_companion
      foreign key (companion_id) references companions(id);
  else
    if exists (
      select 1 from information_schema.columns
      where table_name = 'messages' and column_name = 'companion_uuid'
    ) then
      alter table messages drop column companion_uuid;
    end if;
  end if;
end $$;

-- Also add 'system' to the role check constraint on messages
alter table messages drop constraint if exists messages_role_check;
alter table messages add constraint messages_role_check
  check (role in ('user', 'assistant', 'system'));
