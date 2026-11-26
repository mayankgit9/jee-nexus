-- JEE NEXUS — 0014: chat @mentions
--
-- chat_mentions: one row per (message, mentioned member). Written when a
-- group message body contains "@<display name>" matching a conversation
-- member (sender excluded, longest-name-first so "@Mayank Kumar" does not
-- also ping a member named "Mayank"). read_at is stamped when the mentioned
-- user marks the conversation read — drives the "X mentioned you" toast and
-- future mention badges.
--
-- Cascade rules mirror chat_reactions: deleting the message (or the user)
-- removes their mention rows; the composite PK prevents duplicate pings of
-- the same member from one message.

create table if not exists chat_mentions (
  message_id text not null references chat_messages(id) on delete cascade,
  user_id    text not null references app_users(id) on delete cascade,
  created_at timestamptz(6) not null default now(),
  read_at    timestamptz(6),
  primary key (message_id, user_id)
);

create index if not exists chat_mentions_user_created_idx
  on chat_mentions (user_id, created_at desc);
