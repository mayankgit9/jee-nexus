-- JEE NEXUS — 0013: chat message replies + soft deletes
--
-- Replies: chat_messages.reply_to_id → chat_messages(id) (self-reference).
--   ON DELETE SET NULL: hard-deleting a parent (not done by the app, but
--   possible by ops) keeps the reply, just orphaned of its quote context.
--   The app soft-deletes (deleted_at) instead — replies keep their quote
--   and render "Message deleted" for the parent snippet.
-- Soft deletes: deleted_at is set by the API (sender-only). The body stays
--   in the row for audit but is NEVER returned to clients afterwards —
--   toClientMessage blanks it and every read path hides it. Unread counts
--   exclude deleted messages; reactions on tombstones are rejected.
--
-- Apply on Supabase: scripts/apply_migration.py 0013_chat_replies_deletes.sql
-- (management-API SQL endpoint, runs as postgres) — then deploy the app.

-- ============ replies: self-referencing FK ============
alter table chat_messages
  add column if not exists reply_to_id text references chat_messages(id) on delete set null;
create index if not exists chat_messages_reply_to_id_idx on chat_messages (reply_to_id);

-- ============ soft deletes ============
alter table chat_messages
  add column if not exists deleted_at timestamptz(6);

-- partial index: the 3s poll fetches deleted ids per conversation to turn
-- already-rendered bubbles into tombstones without reloading history —
-- this index keeps that lookup at index-only scan cost.
create index if not exists chat_messages_deleted_per_conv_idx
  on chat_messages (conversation_id) where deleted_at is not null;

-- ============ grants (columns inherit table grants; noop-safe) ============
-- jee_app already has insert/update/select on chat_messages from 0007.
