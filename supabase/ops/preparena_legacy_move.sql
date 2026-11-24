-- JEE NEXUS — preparena onboarding: move the previous prototype app's
-- objects from `public` to a dedicated `legacy` schema.
--
-- WHY: the preparena project already contained a small study-app prototype
-- (12 tables, 1 view, 8 functions, ~200 rows). Its data must be preserved,
-- but the JEE Nexus schema (0001_init.sql) needs `public` for itself
-- (name collision on `exams`).
--
-- Non-destructive & reversible: all rows, indexes, sequences, constraints,
-- RLS policies, the view and the auth trigger keep working — objects are
-- only re-homed. Functions get a pinned search_path so their unqualified
-- table references still resolve.
--
-- Run ONCE against preparena via the SQL endpoint. NEVER in CI/containers
-- (there `public` holds the JEE Nexus schema — this file lives in ops/,
-- outside the migration chain CI applies).

create schema if not exists legacy;

do $$
declare
  r record;
begin
  -- 1. move the view first: when its underlying tables move, Postgres
  --    re-qualifies the view's internal references automatically
  if to_regclass('public.leaderboard_view') is not null then
    execute 'alter view public.leaderboard_view set schema legacy';
    raise notice 'moved view leaderboard_view';
  end if;

  -- 2. move every remaining table out of public
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    order by c.relname
  loop
    execute format('alter table public.%I set schema legacy', r.relname);
    raise notice 'moved table %', r.relname;
  end loop;

  -- 3. move user functions; pin search_path so unqualified refs resolve
  for r in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('alter function %s set schema legacy', r.oid::regprocedure::text);
    execute format('alter function legacy.%I(%s) set search_path = legacy, public, extensions',
                   r.proname, pg_get_function_identity_arguments(r.oid));
    raise notice 'moved function %', r.proname;
  end loop;
end $$;

-- keep legacy data reachable through the standard PostgREST roles
grant usage on schema legacy to anon, authenticated, service_role;
grant select on all tables in schema legacy to anon, service_role;
grant select, insert, update, delete on all tables in schema legacy to authenticated, service_role;
alter default privileges in schema legacy grant select on tables to anon, service_role;
alter default privileges in schema legacy grant select, insert, update, delete on tables to authenticated, service_role;

-- verification (expect public_tables = 0, legacy_tables = 12)
select
  (select count(*) from pg_tables where schemaname = 'public') as public_tables,
  (select count(*) from pg_tables where schemaname = 'legacy') as legacy_tables,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public') as public_functions;
