-- JEE NEXUS — 0008: DB-backed rate limiting (works across Workers isolates)
--
-- The original in-memory Map limiter was per-process: locally (single Node
-- process) the 30/min chat-send limit tripped reliably, but on Cloudflare
-- Workers every isolate keeps its own Map, so limits NEVER fired in
-- production (live e2e proof 2026-11-25: 31/31 chat sends returned 200).
-- Events now live in Postgres — one row per ALLOWED action — so all isolates
-- share one sliding window. Rejected attempts write nothing.
--
-- Table is private (app role only), same model as chat_* tables. Rows are
-- logically dead after the longest window (1h) and are removed by
-- opportunistic cleanup in src/lib/auth.ts (2% of calls, 2h cutoff).
--
-- Apply on Supabase: python3 scripts/apply_migration.py supabase/migrations/0008_rate_limit.sql

create table if not exists rate_limit_events (
  id         text primary key,
  key        text not null,
  created_at timestamptz(6) not null default now()
);
create index if not exists rate_limit_events_key_created_at_idx
  on rate_limit_events (key, created_at);
create index if not exists rate_limit_events_created_at_idx
  on rate_limit_events (created_at);

-- ---------- grants + RLS (private table, app role only) ----------
grant select, insert, update, delete on rate_limit_events to jee_app;

alter table rate_limit_events enable row level security;

drop policy if exists "app full access" on rate_limit_events;
create policy "app full access" on rate_limit_events
  for all to jee_app using (true) with check (true);
