-- Standalone assessments share immutable versions/attempts, without a course entitlement.
begin;

alter table app_private.assessments alter column course_id drop not null;
alter table app_private.assessment_versions alter column course_id drop not null;
alter table app_private.attempts alter column course_id drop not null;

alter table app_private.assessments
  add column scope text not null default 'course' check (scope in ('course','standalone')),
  add column grade_id uuid references app_private.grades(id),
  add column subject_id uuid references app_private.subjects(id),
  add column status text not null default 'draft' check (status in ('draft','published','archived'));

update app_private.assessments a set status='published'
where exists (select 1 from app_private.assessment_versions v
  where v.id=a.current_version_id and v.published_at is not null);

alter table app_private.assessments drop constraint assessments_check;
alter table app_private.assessments
  add constraint assessments_scope_shape check (
    (scope='course' and course_id is not null and grade_id is null and subject_id is null
      and ((kind='homework' and lesson_id is not null and unit_id is null)
        or (kind='exam' and lesson_id is null)))
    or (scope='standalone' and course_id is null and lesson_id is null and unit_id is null
      and grade_id is not null and subject_id is not null)
  ),
  add constraint assessments_published_pointer check (status='draft' or current_version_id is not null),
  add constraint assessments_id_kind_unique unique (id,kind);

-- Nullable course_id must never bypass assessment/version identity through MATCH SIMPLE.
alter table app_private.assessment_versions
  add constraint assessment_versions_assessment_kind_fkey foreign key (assessment_id,kind)
    references app_private.assessments(id,kind),
  add constraint assessment_versions_id_assessment_kind_unique unique (id,assessment_id,kind);
alter table app_private.attempts
  add constraint attempts_version_assessment_kind_fkey foreign key (version_id,assessment_id,kind)
    references app_private.assessment_versions(id,assessment_id,kind);

create index assessments_standalone_grade_idx on app_private.assessments(grade_id,subject_id,id)
  where scope='standalone' and status='published';
create index assessments_subject_fk_idx on app_private.assessments(subject_id)
  where subject_id is not null;

create function app_private.guard_assessment_scope() returns trigger language plpgsql
set search_path=pg_catalog as $$
begin
  if tg_op='INSERT' and new.status<>'draft' then
    raise exception using errcode='23514',message='assessment_must_start_draft';
  end if;
  if tg_op='UPDATE' then
    if row(new.id,new.scope,new.course_id,new.lesson_id,new.unit_id,new.grade_id,new.subject_id,new.kind)
      is distinct from row(old.id,old.scope,old.course_id,old.lesson_id,old.unit_id,old.grade_id,old.subject_id,old.kind) then
      raise exception using errcode='23514',message='assessment_identity_frozen';
    end if;
    if not (new.status=old.status or (old.status='draft' and new.status='published')
      or (old.status='published' and new.status='archived')) then
      raise exception using errcode='23514',message='assessment_transition_invalid';
    end if;
  end if;
  if new.status<>'draft' and not exists (
    select 1 from app_private.assessment_versions v where v.id=new.current_version_id
      and v.assessment_id=new.id and v.published_at is not null
  ) then
    raise exception using errcode='23514',message='assessment_current_version_not_published';
  end if;
  return new;
end $$;
create trigger assessment_scope_guard before insert or update on app_private.assessments
for each row execute function app_private.guard_assessment_scope();

create function app_private.guard_version_scope() returns trigger language plpgsql
set search_path=pg_catalog as $$
declare expected_course uuid; expected_kind text;
begin
  select course_id,kind into expected_course,expected_kind
    from app_private.assessments where id=new.assessment_id;
  if not found or new.course_id is distinct from expected_course or new.kind is distinct from expected_kind then
    raise exception using errcode='23514',message='assessment_version_scope_mismatch';
  end if;
  if tg_op='UPDATE' and row(new.id,new.assessment_id,new.course_id,new.kind,new.version_number)
    is distinct from row(old.id,old.assessment_id,old.course_id,old.kind,old.version_number) then
    raise exception using errcode='23514',message='assessment_version_identity_frozen';
  end if;
  return new;
end $$;
create trigger version_scope_guard before insert or update on app_private.assessment_versions
for each row execute function app_private.guard_version_scope();

create function app_private.guard_attempt_scope() returns trigger language plpgsql
set search_path=pg_catalog as $$
declare expected_course uuid; expected_assessment uuid; expected_kind text; published timestamptz;
begin
  select course_id,assessment_id,kind,published_at
    into expected_course,expected_assessment,expected_kind,published
    from app_private.assessment_versions where id=new.version_id;
  if not found or new.course_id is distinct from expected_course
    or new.assessment_id is distinct from expected_assessment
    or new.kind is distinct from expected_kind or published is null then
    raise exception using errcode='23514',message='attempt_version_scope_mismatch';
  end if;
  return new;
end $$;
create trigger attempt_scope_guard before insert on app_private.attempts
for each row execute function app_private.guard_attempt_scope();

revoke all on function app_private.guard_assessment_scope() from public;
revoke all on function app_private.guard_version_scope() from public;
revoke all on function app_private.guard_attempt_scope() from public;
commit;
