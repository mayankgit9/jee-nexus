-- Runtime state check (no secrets)
select current_user as sql_endpoint_user, (select usesuper from pg_user where usename = current_user) as is_super;
select rolname, rolsuper, rolbypassrls from pg_roles where rolname in ('postgres','service_role','supabase_admin');
select count(*) as tables_public from information_schema.tables where table_schema='public' and table_type='BASE TABLE';
select
  (select count(*) from subjects) as subjects,
  (select count(*) from chapters) as chapters,
  (select count(*) from questions) as questions,
  (select count(*) from app_users) as users,
  (select count(*) from exam_patterns) as exam_patterns;
select tablename, count(*) as policies from pg_policies where schemaname='public' group by tablename;
