-- F04 read-policy prototype. Requires F03 in an EMPTY disposable database.
-- __READER_ROLE__ is an existing owned NOLOGIN/NOBYPASSRLS test role, substituted by the runner.
-- app.actor_id/auth_epoch are set ONLY by a trusted server after session verification.
-- They are not user headers, JWT metadata or a client-selectable SQL scope.
begin;
create schema app_read;
revoke all on schema app_read from public;
grant usage on schema app_read,app_private to __READER_ROLE__;
grant select(id,full_name,phone) on app_private.accounts to __READER_ROLE__;
grant select(account_id,grade_id) on app_private.student_profiles to __READER_ROLE__;
grant select(student_id,course_id,started_at,access_until,withdrawn_at) on app_private.course_access to __READER_ROLE__;
grant select(id,student_id,assessment_id,version_id,kind,attempt_number,status,started_at,deadline_at,submitted_at)
  on app_private.attempts to __READER_ROLE__;
grant select(attempt_id,earned_points,possible_points,passed,graded_at) on app_private.attempt_results to __READER_ROLE__;
grant select(student_id,lesson_id,completed_at,position_seconds) on app_private.lesson_progress to __READER_ROLE__;

create policy f04_self_account on app_private.accounts for select to __READER_ROLE__ using (
  id=nullif(current_setting('app.actor_id',true),'')::uuid and role='student' and status='active'
  and not provisioning_locked and not recovery_locked
  and auth_epoch::text=current_setting('app.auth_epoch',true)
);
create policy f04_self_profile on app_private.student_profiles for select to __READER_ROLE__ using (
  account_id=nullif(current_setting('app.actor_id',true),'')::uuid
  and exists(select 1 from app_private.accounts a where a.id=account_id)
);
create policy f04_self_access on app_private.course_access for select to __READER_ROLE__ using (
  student_id=nullif(current_setting('app.actor_id',true),'')::uuid
  and exists(select 1 from app_private.accounts a where a.id=student_id)
);
create policy f04_self_attempt on app_private.attempts for select to __READER_ROLE__ using (
  student_id=nullif(current_setting('app.actor_id',true),'')::uuid
  and exists(select 1 from app_private.accounts a where a.id=student_id)
);
create policy f04_self_result on app_private.attempt_results for select to __READER_ROLE__ using (
  exists(select 1 from app_private.attempts a where a.id=attempt_id and a.status='submitted')
);
create policy f04_self_progress on app_private.lesson_progress for select to __READER_ROLE__ using (
  student_id=nullif(current_setting('app.actor_id',true),'')::uuid
  and exists(select 1 from app_private.accounts a where a.id=student_id)
);

create view app_read.my_profile with (security_invoker=true) as
  select a.id,a.full_name,a.phone,p.grade_id from app_private.accounts a
  join app_private.student_profiles p on p.account_id=a.id;
create view app_read.my_access with (security_invoker=true) as
  select course_id,started_at,access_until,withdrawn_at from app_private.course_access;
create view app_read.my_progress with (security_invoker=true) as
  select lesson_id,completed_at,position_seconds from app_private.lesson_progress;
create view app_read.my_results with (security_invoker=true) as
  select r.attempt_id,r.earned_points,r.possible_points,r.passed,r.graded_at
  from app_private.attempt_results r join app_private.attempts a on a.id=r.attempt_id;
grant select on app_read.my_profile,app_read.my_access,app_read.my_progress,app_read.my_results to __READER_ROLE__;
do $$ declare r text;begin
  foreach r in array array['anon','authenticated','service_role'] loop
    if exists(select 1 from pg_roles where rolname=r) then
      execute format('revoke all on schema app_read from %I',r);
      execute format('revoke all on all tables in schema app_read from %I',r);
    end if;
  end loop;
end $$;
commit;
