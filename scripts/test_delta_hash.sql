-- read-only pre-flight: does the SQL hash expression reproduce the
-- TS computeContentHash for a row's POST-FIX text? compare with
-- scripts/preflight_delta_hash.py output (expected new hash).
select q.public_id,
       encode(extensions.digest(
         s.key || '::' ||
         btrim(translate(
           regexp_replace(
             lower(regexp_replace(q.text, '\\Delta([A-Za-z])', '\\Delta \1', 'g')),
             '\s+', ' ', 'g'),
           '$\{}', '')),
         'sha256'), 'hex') as sql_new_hash
  from questions q
  join subjects s on s.id = q.subject_id
 where q.public_id = 'PYQ-2019-qIUwi5Ml';
