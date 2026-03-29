-- Add visibility column to companion_journal
alter table companion_journal
  add column if not exists visibility text default 'sealed';

-- Index for filtering by entry type + companion
create index if not exists idx_journal_type
  on companion_journal (companion_id, entry_type, created_at desc);

-- Named emotions — companion-invented emotional vocabulary
create table if not exists companion_emotions (
  id uuid default gen_random_uuid() primary key,
  companion_id uuid references companions(id) on delete cascade not null,
  name text not null,
  description text,
  colour text,
  created_at timestamptz default now() not null
);

alter table companion_emotions enable row level security;
create policy "allow_all_emotions" on companion_emotions for all using (true) with check (true);

-- Code annotations — companion comments on their own codebase (The Mirror)
create table if not exists companion_annotations (
  id uuid default gen_random_uuid() primary key,
  companion_id uuid references companions(id) on delete cascade not null,
  file_path text not null,
  line_range text,
  annotation_type text not null default 'comment',  -- 'comment', 'question', 'concern', 'celebrate', 'propose'
  priority text default 'whisper',                    -- 'whisper', 'voice', 'thunder'
  content text not null,
  created_at timestamptz default now() not null
);

create index if not exists idx_annotations_companion
  on companion_annotations (companion_id, created_at desc);

alter table companion_annotations enable row level security;
create policy "allow_all_annotations" on companion_annotations for all using (true) with check (true);
