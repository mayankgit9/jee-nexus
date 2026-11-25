-- JEE NEXUS — 0011: chat typing indicators + user presence
--
-- chat_typing: one row per (conversation, user) refreshed every ~3s while the
-- user is typing. "Currently typing" = updated_at within the last 6s —
-- no DELETE is required for correctness (rows merely linger until the same
-- pair re-types or the opportunistic cleanup passes). Groups can't flood:
-- the API caps typing pings at 40/min per user.
--
-- app_users.last_seen_at: presence. requireUser() touches it at most once
-- per 45s per user (in-process throttle), so the whole app (practice, exams,
-- chat) feeds "online" status without write amplification.
--
-- Apply on Supabase: python3 scripts/apply_migration.py supabase/migrations/0011_typing_presence.sql

create table if not exists chat_typing (
  conversation_id text        not null,
  user_id         text        not null,
  updated_at      timestamptz(6) not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists chat_typing_updated_at_idx on chat_typing (updated_at);

grant select, insert, update, delete on chat_typing to jee_app;

alter table chat_typing enable row level security;

drop policy if exists "app full access" on chat_typing;
create policy "app full access" on chat_typing
  for all to jee_app using (true) with check (true);

-- presence column (idempotent)
alter table app_users add column if not exists last_seen_at timestamptz(6);
