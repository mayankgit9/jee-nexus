-- finish the status move the cancelled run left incomplete
update questions
   set verification_status = 'needs_review'
 where verification_status = 'imported'
   and public_id like 'PYQ-%';
