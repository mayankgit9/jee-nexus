-- JEE NEXUS migration 0005: add the missing Electrochemistry chapter
-- (gap found while importing real PYQs; JEE Main Chemistry syllabus includes it).
-- Idempotent: re-running is a no-op.

insert into chapters (id, subject_id, key, name, unit, sort_order)
select
  gen_random_uuid()::text,
  s.id,
  'chemistry:electrochemistry',
  'Electrochemistry',
  'Physical Chemistry',
  9
from subjects s
where s.key = 'chemistry'
  and not exists (select 1 from chapters c where c.key = 'chemistry:electrochemistry');

-- keep ordering consistent: shift chapters that were at order >= 9
update chapters
set sort_order = sort_order + 1
where subject_id = (select id from subjects where key = 'chemistry')
  and sort_order >= 9
  and key <> 'chemistry:electrochemistry'
  and not exists (
    -- only if the new chapter landed at 9 (i.e. this migration is fresh)
    select 1 from chapters c2
    where c2.key = 'chemistry:electrochemistry' and c2.sort_order = 9
  );
