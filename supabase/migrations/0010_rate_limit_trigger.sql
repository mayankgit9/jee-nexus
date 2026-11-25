-- JEE NEXUS — 0010: rate limiter v3 — trigger-enforced, zero reads
--
-- Prod lesson #4 (2026-11-25): Hyperdrive cached the INSERT..ON CONFLICT..
-- RETURNING result (DML with a result set is apparently classified as a
-- cacheable read) — bursts saw a stale "hits" value and never tripped, while
-- only some upserts really executed. This version eliminates every cacheable
-- surface:
--   * the limiter is ONE $executeRaw statement (command tag only, no result
--     set — a write Hyperdrive must actually execute);
--   * the limit check lives in a BEFORE INSERT/UPDATE TRIGGER that RAISEs
--     when hits would exceed limit_max — the API maps that error to 429;
--   * rejected attempts roll back (trigger aborts), so spam cannot extend
--     or grow anything.
-- window_seconds + limit_max are per-key columns set on first hit, so one
-- generic trigger serves every limit in the app (30/min chat, 240/min exam
-- autosave, 5/min signup, ...).
--
-- Apply on Supabase: python3 scripts/apply_migration.py supabase/migrations/0010_rate_limit_trigger.sql

drop table if exists rate_limit_counters;

create table rate_limit_counters (
  key            text primary key,
  window_start   timestamptz(6) not null default now(),
  hits           integer not null default 0,
  window_seconds integer not null default 60,
  limit_max      integer not null default 999999
);

create or replace function rate_limit_guard() returns trigger as $$
begin
  if NEW.hits > NEW.limit_max then
    raise exception 'RATE_LIMIT_EXCEEDED (limit % per % seconds)', NEW.limit_max, NEW.window_seconds;
  end if;
  return NEW;
end $$ language plpgsql;

create trigger rate_limit_guard_trigger
  before insert or update on rate_limit_counters
  for each row execute function rate_limit_guard();

-- ---------- grants + RLS (private table, app role only) ----------
grant select, insert, update, delete on rate_limit_counters to jee_app;
grant execute on function rate_limit_guard() to jee_app;

alter table rate_limit_counters enable row level security;

drop policy if exists "app full access" on rate_limit_counters;
create policy "app full access" on rate_limit_counters
  for all to jee_app using (true) with check (true);
