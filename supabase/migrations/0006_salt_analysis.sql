-- JEE NEXUS migration 0006: add the Salt Analysis chapter (Inorganic
-- Chemistry). Gap found while importing real 2021-2023 PYQs (4 questions
-- tagged to examside's salt-analysis topic had no taxonomy target).
-- Idempotent: re-running is a no-op.

insert into chapters (id, subject_id, key, name, unit, sort_order)
select
  gen_random_uuid()::text,
  s.id,
  'chemistry:salt-analysis',
  'Salt Analysis',
  'Inorganic Chemistry',
  16
from subjects s
where s.key = 'chemistry'
  and not exists (select 1 from chapters c where c.key = 'chemistry:salt-analysis');

-- keep ordering consistent: shift chapters that were at order >= 16
update chapters
set sort_order = sort_order + 1
where subject_id = (select id from subjects where key = 'chemistry')
  and sort_order >= 16
  and key <> 'chemistry:salt-analysis';
