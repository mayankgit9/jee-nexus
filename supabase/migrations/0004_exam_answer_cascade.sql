-- JEE NEXUS — 0004: cascade-safe exam deletion (diamond FK fix)
--
-- exam_attempt_answers references BOTH exam_attempts (cascade) and
-- exam_questions (no action). Deleting an exam cascades down both paths;
-- depending on trigger order the restricted edge fires spuriously.
-- An answer row belongs to its question-slot: deleting the slot should take
-- the answer with it. Making this edge CASCADE removes the order dependency.
-- Idempotent via guard.

do $$ begin
  if exists (
    select 1 from information_schema.referential_constraints
    where constraint_name = 'exam_attempt_answers_exam_question_id_fkey'
      and delete_rule <> 'CASCADE'
  ) then
    alter table exam_attempt_answers
      drop constraint exam_attempt_answers_exam_question_id_fkey;
    alter table exam_attempt_answers
      add constraint exam_attempt_answers_exam_question_id_fkey
      foreign key (exam_question_id) references exam_questions(id) on delete cascade;
  end if;
end $$;
