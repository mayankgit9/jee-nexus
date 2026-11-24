-- Clean Playwright test accounts from the live DB (pw-* prefix).
delete from exam_attempt_answers where exam_attempt_id in (
  select ea.id from exam_attempts ea join app_users u on u.id = ea.user_id where u.email like 'pw-%');
delete from exam_attempts where user_id in (select id from app_users where email like 'pw-%');
delete from exam_questions where exam_id in (select id from exams where title like 'PW %' or title like 'PW Resume %' or title like 'PW Test%');
delete from exams where title like 'PW %' or title like 'PW Resume %' or title like 'PW Test%';
delete from attempts where user_id in (select id from app_users where email like 'pw-%');
delete from bookmarks where user_id in (select id from app_users where email like 'pw-%');
delete from reports where user_id in (select id from app_users where email like 'pw-%');
delete from app_users where email like 'pw-%';
