-- JEE NEXUS — 0007: community chat (DMs + group study chats)
--
-- Three tables: chat_conversations (dm | group), chat_members (membership +
-- per-user lastReadAt for unread counts), chat_messages.
--
-- Privacy model: chat tables are PRIVATE — no anon policies at all (like
-- app_users / sessions / attempts). The app connects as jee_app and enforces
-- per-user authorization in the API layer (membership checks per request).
-- jee_app access is granted by 0003's default privileges + explicit grants
-- below (idempotent either way).
--
-- Apply on Supabase: scripts/apply_migration.py 0007_chat.sql
-- (management-API SQL endpoint, runs as postgres) — then deploy the app.

-- ---------- enum ----------
do $$ begin
  create type conversation_type as enum ('dm', 'group');
exception when duplicate_object then null; end $$;

-- ---------- tables ----------
create table if not exists chat_conversations (
  id            text primary key,
  type          conversation_type not null,
  name          text,                    -- groups only, 1-60 chars (API-enforced)
  created_by_id text references app_users(id) on delete set null,
  created_at    timestamptz(6) not null default now(),
  updated_at    timestamptz(6) not null default now()  -- bumped on new message; sidebar sort key
);
create index if not exists chat_conversations_updated_at_idx on chat_conversations (updated_at);

create table if not exists chat_members (
  id              text primary key,
  conversation_id text not null references chat_conversations(id) on delete cascade,
  user_id         text not null references app_users(id) on delete cascade,
  role            text not null default 'member',   -- member | admin (creator)
  last_read_at    timestamptz(6),
  joined_at       timestamptz(6) not null default now(),
  unique (conversation_id, user_id)
);
create index if not exists chat_members_user_id_idx on chat_members (user_id);

create table if not exists chat_messages (
  id              text primary key,
  conversation_id text not null references chat_conversations(id) on delete cascade,
  sender_id       text not null references app_users(id) on delete cascade,
  body            text not null,                    -- 1-2000 chars (API-enforced)
  created_at      timestamptz(6) not null default now()
);
create index if not exists chat_messages_conversation_created_at_idx
  on chat_messages (conversation_id, created_at);

-- ---------- grants + RLS (private tables, app role only) ----------
grant select, insert, update, delete on chat_conversations, chat_members, chat_messages to jee_app;

alter table chat_conversations enable row level security;
alter table chat_members enable row level security;
alter table chat_messages enable row level security;

drop policy if exists "app full access" on chat_conversations;
create policy "app full access" on chat_conversations
  for all to jee_app using (true) with check (true);

drop policy if exists "app full access" on chat_members;
create policy "app full access" on chat_members
  for all to jee_app using (true) with check (true);

drop policy if exists "app full access" on chat_messages;
create policy "app full access" on chat_messages
  for all to jee_app using (true) with check (true);
