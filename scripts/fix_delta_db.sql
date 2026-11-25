-- JEE NEXUS — \Delta<letter> LaTeX repair on the LIVE database.
-- Must run AFTER the current import finishes and TOGETHER with
-- scripts/fix_delta_corpus.py (same regex, so corpus contentHashes and
-- DB content_hashes stay identical).
--
-- Escaping (PG, standard_conforming_strings=on):
--   file '\\Delta([A-Za-z])'  -> string value \\Delta([A-Za-z])
--                              -> regex: literal backslash + "Delta" + group
--   file '\\Delta \\1'        -> string value \\Delta \2
--                              -> replacement: literal \, "Delta ", group 2
--   '\s+'                     -> regex whitespace class (single \ intended)

begin;

update questions q
   set text = regexp_replace(q.text, '\\Delta([A-Za-z])', '\\Delta \1', 'g'),
       content_hash = encode(extensions.digest(
         s.key || '::' ||
         btrim(translate(
           regexp_replace(
             lower(regexp_replace(q.text, '\\Delta([A-Za-z])', '\\Delta \1', 'g')),
             '\s+', ' ', 'g'),
           '$\{}', '')),
         'sha256'), 'hex')
  from subjects s
 where s.id = q.subject_id
   and q.text ~ '\\Delta([A-Za-z])';

update question_options
   set text = regexp_replace(text, '\\Delta([A-Za-z])', '\\Delta \1', 'g')
 where text ~ '\\Delta([A-Za-z])';

update solutions
   set body = regexp_replace(body, '\\Delta([A-Za-z])', '\\Delta \1', 'g')
 where body ~ '\\Delta([A-Za-z])';

commit;
