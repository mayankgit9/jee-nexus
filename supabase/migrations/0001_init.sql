-- JEE NEXUS — production PostgreSQL schema (Supabase)
-- Mirrors prisma/schema.prisma with native PG types + Row Level Security.
-- Applied via Supabase management API. Idempotent guards allow re-runs.

-- ============ enums ============
do $$ begin
  create type question_type as enum ('mcq_single', 'mcq_multi', 'numerical');
exception when duplicate_object then null; end $$;

do $$ begin
  create type difficulty as enum ('easy', 'medium', 'hard');
exception when duplicate_object then null; end $$;

do $$ begin
  create type verification_status as enum ('imported', 'needs_review', 'verified', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app_role as enum ('student', 'admin');
exception when duplicate_object then null; end $$;

-- ============ users & auth ============
create table if not exists app_users (
  id text primary key,
  email text unique not null,
  password_hash text not null,
  name text,
  role app_role not null default 'student',
  preferences jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_sessions (
  id text primary key,
  token text unique not null,
  user_id text not null references app_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists app_sessions_user_idx on app_sessions(user_id);

create table if not exists password_resets (
  id text primary key,
  user_id text not null references app_users(id) on delete cascade,
  token text unique not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============ taxonomy ============
create table if not exists subjects (
  id text primary key,
  key text unique not null,
  name text not null,
  icon text,
  color_key text,
  sort_order int not null default 0
);

create table if not exists chapters (
  id text primary key,
  subject_id text not null references subjects(id) on delete cascade,
  key text unique not null,
  name text not null,
  unit text,
  sort_order int not null default 0
);
create index if not exists chapters_subject_idx on chapters(subject_id);

-- ============ questions ============
create table if not exists questions (
  id text primary key,
  public_id text unique not null,
  subject_id text not null references subjects(id),
  chapter_id text not null references chapters(id),
  subtopic text,
  type question_type not null,
  text text not null,
  correct_options jsonb,            -- [0,2]
  numerical_answer numeric,
  numerical_tolerance numeric,
  difficulty difficulty not null default 'medium',
  source_exam text not null default 'JEE Main',
  source_year int,
  source_date text,
  source_shift text,
  source_question_number int,
  source_reference text,
  verification_status verification_status not null default 'imported',
  tags jsonb not null default '[]',
  content_hash text unique not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists questions_subject_chapter_idx on questions(subject_id, chapter_id);
create index if not exists questions_year_subject_idx on questions(source_year, subject_id);
create index if not exists questions_status_idx on questions(verification_status);
create index if not exists questions_type_idx on questions(type);

create table if not exists question_options (
  id text primary key,
  question_id text not null references questions(id) on delete cascade,
  idx int not null,
  text text not null,
  is_correct boolean not null default false,
  unique (question_id, idx)
);

create table if not exists question_images (
  id text primary key,
  question_id text not null references questions(id) on delete cascade,
  kind text not null default 'question' check (kind in ('question', 'solution')),
  url text not null,
  alt_text text not null,
  caption text,
  attribution text,
  is_original_exam_image boolean not null default false,
  sort_order int not null default 0
);

create table if not exists solutions (
  id text primary key,
  question_id text unique not null references questions(id) on delete cascade,
  key_concept text,
  formulas jsonb not null default '[]',
  body text not null,
  common_mistakes text,
  alternative_method text,
  verification text,
  is_ai_generated boolean not null default true,
  verified_at timestamptz,
  source_references jsonb not null default '[]',
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============ exams / CBT ============
create table if not exists exam_patterns (
  id text primary key,
  key text unique not null,
  name text not null,
  description text,
  duration_minutes int not null,
  config jsonb not null
);

create table if not exists exams (
  id text primary key,
  title text not null,
  description text,
  kind text not null check (kind in ('full_length', 'subject', 'chapter', 'custom', 'pyq_year')),
  pattern_id text not null references exam_patterns(id),
  subject_key text,
  year int,
  config jsonb,
  created_by_id text,
  is_published boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists exams_kind_idx on exams(kind);

create table if not exists exam_questions (
  id text primary key,
  exam_id text not null references exams(id) on delete cascade,
  question_id text not null references questions(id),
  sort_order int not null,
  section text not null,
  section_order int not null,
  unique (exam_id, sort_order)
);
create index if not exists exam_questions_exam_section_idx on exam_questions(exam_id, section);

create table if not exists exam_attempts (
  id text primary key,
  user_id text not null references app_users(id) on delete cascade,
  exam_id text not null references exams(id) on delete cascade,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  submitted_at timestamptz,
  status text not null default 'in_progress' check (status in ('in_progress', 'submitted', 'expired')),
  total_marks numeric,
  max_marks numeric,
  time_spent_seconds int,
  created_at timestamptz not null default now()
);
create index if not exists exam_attempts_user_idx on exam_attempts(user_id, started_at);

create table if not exists exam_attempt_answers (
  id text primary key,
  exam_attempt_id text not null references exam_attempts(id) on delete cascade,
  exam_question_id text not null references exam_questions(id),
  selected_options jsonb,
  numerical_value text,
  is_correct boolean,
  marks_awarded numeric,
  visited boolean not null default false,
  marked_for_review boolean not null default false,
  time_spent_seconds int not null default 0,
  updated_at timestamptz not null default now(),
  unique (exam_attempt_id, exam_question_id)
);

-- ============ practice & engagement ============
create table if not exists attempts (
  id text primary key,
  user_id text not null references app_users(id) on delete cascade,
  question_id text not null references questions(id),
  selected_options jsonb,
  numerical_value text,
  is_correct boolean,
  time_spent_seconds int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists attempts_user_created_idx on attempts(user_id, created_at);
create index if not exists attempts_user_question_idx on attempts(user_id, question_id);

create table if not exists bookmarks (
  id text primary key,
  user_id text not null references app_users(id) on delete cascade,
  question_id text not null references questions(id),
  created_at timestamptz not null default now(),
  unique (user_id, question_id)
);

create table if not exists reports (
  id text primary key,
  user_id text not null references app_users(id) on delete cascade,
  question_id text not null references questions(id),
  reason text not null check (reason in ('incorrect_answer', 'incorrect_solution', 'missing_diagram', 'typo', 'copyright', 'other')),
  details text,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolution text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists reports_status_idx on reports(status);
create index if not exists reports_question_idx on reports(question_id);

create table if not exists import_jobs (
  id text primary key,
  admin_id text not null,
  file_name text not null,
  source_format text not null check (source_format in ('json', 'csv')),
  total_rows int not null default 0,
  inserted int not null default 0,
  skipped_duplicate int not null default 0,
  rejected int not null default 0,
  errors jsonb,
  status text not null default 'completed' check (status in ('running', 'completed', 'failed')),
  created_at timestamptz not null default now()
);
create index if not exists import_jobs_created_idx on import_jobs(created_at);

-- ============ Row Level Security ============
-- Model: the Next.js API layer connects with the service role (bypasses RLS)
-- and enforces per-user authorization server-side (session checks in code).
-- The anon key gets read-only access to PUBLIC reference data only.
-- No anon/client key can read private tables (attempts, sessions, answers).

alter table app_users enable row level security;
alter table app_sessions enable row level security;
alter table password_resets enable row level security;
alter table subjects enable row level security;
alter table chapters enable row level security;
alter table questions enable row level security;
alter table question_options enable row level security;
alter table question_images enable row level security;
alter table solutions enable row level security;
alter table exam_patterns enable row level security;
alter table exams enable row level security;
alter table exam_questions enable row level security;
alter table exam_attempts enable row level security;
alter table exam_attempt_answers enable row level security;
alter table attempts enable row level security;
alter table bookmarks enable row level security;
alter table reports enable row level security;
alter table import_jobs enable row level security;

-- Public read-only policies (anon can SELECT public reference data)
drop policy if exists "public read subjects" on subjects;
create policy "public read subjects" on subjects for select using (true);

drop policy if exists "public read chapters" on chapters;
create policy "public read chapters" on chapters for select using (true);

drop policy if exists "public read non-rejected questions" on questions;
create policy "public read non-rejected questions" on questions
  for select using (verification_status <> 'rejected');

-- NOTE (intentional): question_options, solutions and question_images have NO anon
-- policy — answers and solutions are only served through the app's API after
-- submission. The API connects with the service role.

drop policy if exists "public read published exams" on exams;
create policy "public read published exams" on exams for select using (is_published);

drop policy if exists "public read exam patterns" on exam_patterns;
create policy "public read exam patterns" on exam_patterns for select using (true);

-- Private tables (users, sessions, resets, attempts, exam_attempts, answers,
-- bookmarks, reports, import_jobs): NO anon policies at all — service role only.
