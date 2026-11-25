-- JEE NEXUS — 0009: rate limiting via counter rows + trigger guard
-- (supersedes 0008's events table; matches the schema applied live 2026-11-25)
--
-- Prod lessons 2026-11-25 (FOUR live iterations):
--  1. In-memory Maps never fire on Workers (per-isolate) — 0008 moved the
--     window to Postgres.
--  2. The events-table COUNT is a read — Hyperdrive served the identical
--     query text stale (31 sends all saw the first result). A uuid-in-comment
--     cache-buster broke parameter typing (42P18).
--  3. Even INSERT..ON CONFLICT..RETURNING got cached — DML WITH a result set
--     is treated as a cacheable read, so bursts saw a stale "hits".
--  4. RETURNING removed entirely: the limiter is ONE $executeRaw upsert
--     (command tag only, nothing to cache) and the cap is enforced by a
--     BEFORE trigger that RAISEs RATE_LIMIT_EXCEEDED, mapped to 429 in app.
--     Rejected attempts abort inside Postgres — spam extends nothing.
--
-- Memory lesson (prod incident 2026-11-25, error 1102): every `db` Proxy
-- access opened a fresh Prisma engine + pg pool; up to 3 per request pushed
-- busy isolates past the 128MB Workers limit. The app-side limiter therefore
-- runs every query through ONE dbClient() (see src/lib/auth.ts).
--
-- Apply on Supabase:
--   python3 scripts/apply_migration.py supabase/migrations/0009_rate_limit_counters.sql

create table if not exists rate_limit_counters (
  key            text primary key,
  window_start   timestamptz(6) not null default now(),
  hits           integer not null default 0,
  window_seconds integer not null default 60,
  limit_max      integer not null default 999999
);

-- ---------- guard trigger: the cap is enforced inside Postgres ----------
create or replace function public.rate_limit_guard()
returns trigger
language plpgsql
as $function$
begin
  if NEW.hits > NEW.limit_max then
    raise exception 'RATE_LIMIT_EXCEEDED (limit % per % seconds)', NEW.limit_max, NEW.window_seconds;
  end if;
  return NEW;
end $function$;

drop trigger if exists rate_limit_guard_trigger on rate_limit_counters;
create trigger rate_limit_guard_trigger
  before insert or update on rate_limit_counters
  for each row execute function rate_limit_guard();

-- ---------- grants + RLS (private table, app role only) ----------
grant select, insert, update, delete on rate_limit_counters to jee_app;

alter table rate_limit_counters enable row level security;

drop policy if exists "app full access" on rate_limit_counters;
create policy "app full access" on rate_limit_counters
  for all to jee_app using (true) with check (true);

-- retire the superseded events table (0008)
drop table if exists rate_limit_events;
