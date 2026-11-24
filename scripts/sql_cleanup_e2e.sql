-- JEE NEXUS — clean E2E test data from the live production database.
-- The E2E suites ran against the live DB to prove the Postgres cutover;
-- their synthetic users/questions/exams are not production content.
-- Idempotent + targeted: only test-pattern rows are touched.

-- 1) E2E test questions (TEST-IMP-* imported by the admin E2E suite)
delete from question_options where question_id in (select id from questions where public_id like 'TEST-IMP-%');
delete from solutions where question_id in (select id from questions where public_id like 'TEST-IMP-%');
delete from reports where question_id in (select id from questions where public_id like 'TEST-IMP-%');
delete from questions where public_id like 'TEST-IMP-%';

-- 2) E2E users and everything that cascades from them
--    (sessions, attempts, bookmarks, reports, exam attempts + answers)
delete from app_users where email like 'e2e-%@jee-nexus.dev'
                     or email like 'exam-e2e-%@jee-nexus.dev'
                     or email like 'student-%@jee-nexus.dev';

-- 3) leftover import jobs from E2E runs (admin_id was an E2E user)
delete from import_jobs where admin_id not in (select id from app_users);

-- 4) verification: what remains
select
  (select count(*) from questions) as questions,
  (select count(*) from app_users) as users,
  (select count(*) from import_jobs) as import_jobs,
  (select count(*) from exams) as exams,
  (select count(*) from exam_attempts) as exam_attempts,
  (select count(*) from attempts) as practice_attempts;
