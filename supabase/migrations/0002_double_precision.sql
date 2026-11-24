-- JEE NEXUS — 0002: runtime parity with the Prisma client
-- Marks and numerical answers are consumed as JS numbers (tolerance-compared
-- in the app layer); double precision is the exact match for Prisma Float.
-- Idempotent: re-running is a harmless no-op conversion.

alter table questions
  alter column numerical_answer type double precision using numerical_answer::double precision;
alter table questions
  alter column numerical_tolerance type double precision using numerical_tolerance::double precision;
alter table exam_attempts
  alter column total_marks type double precision using total_marks::double precision;
alter table exam_attempts
  alter column max_marks type double precision using max_marks::double precision;
alter table exam_attempt_answers
  alter column marks_awarded type double precision using marks_awarded::double precision;
