-- JEE NEXUS — 0012: message reactions
--
-- One row per (message, user, emoji): a user can react with several DIFFERENT
-- emojis to the same message, but never twice with the same one — the toggle
-- API upserts/deletes on the composite key, so no count can drift.
--
-- Apply on Supabase: python3 scripts/apply_migration.py supabase/migrations/0012_chat_reactions.sql

create table if not exists chat_reactions (
  message_id  text        not null,
  user_id     text        not null,
  emoji       text        not null,
  created_at  timestamptz(6) not null default now(),
  primary key (message_id, user_id, emoji)
);

create index if not exists chat_reactions_message_idx on chat_reactions (message_id);

grant select, insert, delete on chat_reactions to jee_app;

alter table chat_reactions enable row level security;

drop policy if exists "app full access" on chat_reactions;
create policy "app full access" on chat_reactions
  for all to jee_app using (true) with check (true);
