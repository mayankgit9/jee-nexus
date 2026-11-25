-- strict artifact check (file-based: regex sees literal backslash + Delta + letter)
select
  (select count(*) from questions where text ~ '\\Delta([A-Za-z])') as q_artifact,
  (select count(*) from question_options where text ~ '\\Delta([A-Za-z])') as opt_artifact,
  (select count(*) from solutions where body ~ '\\Delta([A-Za-z])') as sol_artifact;
