-- JEE NEXUS — 0003: dedicated application login role (jee_app)
--
-- The Next.js API layer connects as jee_app (never as `postgres`) and enforces
-- per-user authorization server-side (session checks in code) — the same model
-- Supabase uses for service_role. jee_app gets full DML on the public schema,
-- gated by explicit permissive RLS policies scoped to the role.
--
-- The password created here is a placeholder: scripts/create_app_role.sh sets
-- the real secret (kept only in .secrets/, gitignored). In CI the role is
-- created with the placeholder and never used for login (CI connects as the
-- container superuser).
-- Idempotent: safe to re-run.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'jee_app') then
    create role jee_app login password 'placeholder-set-by-runner';
  end if;
end $$;

grant usage on schema public to jee_app;
grant select, insert, update, delete on all tables in schema public to jee_app;

-- future tables created by postgres (SQL endpoint migrations) stay app-accessible
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to jee_app;

-- Permissive RLS policies scoped to jee_app (the anon read-only policies from
-- 0001 are untouched). Table owner postgres can create policies.
drop policy if exists "app full access" on app_users;
create policy "app full access" on app_users for all to jee_app using (true) with check (true);

drop policy if exists "app full access" on app_sessions;
create policy "app full access" on app_sessions for all to jee_app using (true) with check (true);

drop policy if exists "app full access" on password_resets;
create policy "app full access" on password_resets for all to jee_app using (true) with check (true);

drop policy if exists "app full access" on subjects;
create policy "app full access" on subjects for all to jee_app using (true) with check (true);

drop policy if exists "app full access" on chapters;
create policy "app full access" on chapters for all to jee_app using (true) with check (true);

drop policy if exists "app full access" on questions;
create policy "app full access" on questions for all to jee_app using (true) with check (true);

drop policy if exists "app full access" on question_options;
create policy "app full access" on question_options for all to jee_app using (true) with check (true);

drop policy if exists "app full access" on question_images;
create policy "app full access" on question_images for all to jee_app using (true) with check (true);

drop policy if exists "app full access" on solutions;
create policy "app full access" on solutions for all to jee_app using (true) with check (true);

drop policy if exists "app full access" on exam_patterns;
create policy "app full access" on exam_patterns for all to jee_app using (true) with check (true);

drop policy if exists "app full access" on exams;
create policy "app full access" on exams for all to jee_app using (true) with check (true);

drop policy if exists "app full access" on exam_questions;
create policy "app full access" on exam_questions for all to jee_app using (true) with check (true);

drop policy if exists "app full access" on exam_attempts;
create policy "app full access" on exam_attempts for all to jee_app using (true) with check (true);

drop policy if exists "app full access" on exam_attempt_answers;
create policy "app full access" on exam_attempt_answers for all to jee_app using (true) with check (true);

drop policy if exists "app full access" on attempts;
create policy "app full access" on attempts for all to jee_app using (true) with check (true);

drop policy if exists "app full access" on bookmarks;
create policy "app full access" on bookmarks for all to jee_app using (true) with check (true);

drop policy if exists "app full access" on reports;
create policy "app full access" on reports for all to jee_app using (true) with check (true);

drop policy if exists "app full access" on import_jobs;
create policy "app full access" on import_jobs for all to jee_app using (true) with check (true);
