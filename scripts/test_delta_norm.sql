-- dump the SQL-side normalized string for diffing against Python
select s.key,
       btrim(translate(
           regexp_replace(
             lower(regexp_replace(q.text, '\\Delta([A-Za-z])', '\\Delta \1', 'g')),
             '\s+', ' ', 'g'),
           '$\{}', '')) as sql_normalized
  from questions q
  join subjects s on s.id = q.subject_id
 where q.public_id = 'PYQ-2019-qIUwi5Ml';
