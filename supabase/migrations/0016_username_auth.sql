-- 0016: username-based auth (2026-11-28 auth rework)
-- Login identity moves from email to username; email becomes OPTIONAL and is
-- captured only for self-recovery (forgot username / forgot password).
-- Existing accounts are backfilled: username = normalized email prefix,
-- suffix -2, -3 … on collisions.

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS username TEXT;

UPDATE app_users
   SET username = lower(regexp_replace(split_part(email, '@', 1), '[^a-z0-9_.-]', '', 'g'))
 WHERE username IS NULL;

WITH c AS (
  SELECT id, username, ROW_NUMBER() OVER (PARTITION BY username ORDER BY created_at) AS rn
    FROM app_users
   WHERE username IS NOT NULL
)
UPDATE app_users u
   SET username = c.username || '-' || c.rn
  FROM c
 WHERE u.id = c.id AND c.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS app_users_username_key ON app_users (username);

ALTER TABLE app_users ALTER COLUMN username SET NOT NULL;
ALTER TABLE app_users ALTER COLUMN email DROP NOT NULL;
