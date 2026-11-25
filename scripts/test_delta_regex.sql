-- isolate: what does the regex replacement actually produce?
select
  regexp_replace(q.text, '\\Delta([A-Za-z])', '\\Delta \1', 'g') as fixed_text,
  substring(regexp_replace(q.text, '\\Delta([A-Za-z])', '\\Delta \1', 'g') from 1 for 120) as fixed_head
  from questions q
 where q.public_id = 'PYQ-2019-qIUwi5Ml';
