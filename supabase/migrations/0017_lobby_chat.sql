-- 0017: public lobby chat (2026-11-28)
-- One permanent 'lobby' conversation that EVERYONE can read and post to
-- without joining. Guest (not signed-in) posts store sender_id NULL and a
-- display-name snapshot in sender_name.

ALTER TYPE conversation_type ADD VALUE IF NOT EXISTS 'lobby';

ALTER TABLE chat_messages ALTER COLUMN sender_id DROP NOT NULL;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS sender_name TEXT;

INSERT INTO chat_conversations (id, type, created_at, updated_at)
VALUES ('lobby', 'lobby', now(), now())
ON CONFLICT (id) DO NOTHING;
