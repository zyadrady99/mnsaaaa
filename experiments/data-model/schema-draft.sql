-- F03 review draft, PostgreSQL 17. Apply ONLY to an empty disposable database.
-- No production migration, Auth-provider tables, login roles or HTTP permissions.
begin;
create schema app_private;
revoke all on schema app_private from public;
alter default privileges in schema app_private revoke all on tables from public;
alter default privileges in schema app_private revoke execute on functions from public;

create table app_private.grades (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  sort_order integer not null unique check (sort_order > 0),
  enabled boolean not null default true
);
create table app_private.subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) > 0)
);
create table app_private.teachers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  biography text not null default '',
  image_ref text,
  enabled boolean not null default true
);
create table app_private.accounts (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  full_name text not null check (length(btrim(full_name)) > 0),
  role text not null check (role in ('student','admin')),
  status text not null default 'active' check (status in ('active','disabled')),
  provisioning_locked boolean not null default true,
  recovery_locked boolean not null default false,
  auth_epoch bigint not null default 1 check (auth_epoch > 0),
  created_at timestamptz not null default clock_timestamp(),
  unique (id, role)
);
create table app_private.identity_links (
  account_id uuid primary key references app_private.accounts(id),
  provider text not null check (length(btrim(provider)) > 0),
  external_subject text not null check (length(btrim(external_subject)) > 0),
  unique (provider, external_subject)
);
create table app_private.student_profiles (
  account_id uuid primary key,
  role text not null default 'student' check (role = 'student'),
  grade_id uuid not null references app_private.grades(id),
  foreign key (account_id, role) references app_private.accounts(id, role)
);
create index student_profiles_grade_idx on app_private.student_profiles(grade_id);

create table app_private.courses (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references app_private.teachers(id),
  grade_id uuid not null references app_private.grades(id),
  subject_id uuid not null references app_private.subjects(id),
  title text not null check (length(btrim(title)) > 0),
  description text not null default '',
  cover_ref text,
  delivery_environment text not null default 'development' check (delivery_environment in ('development','live')),
  status text not null default 'draft' check (status in ('draft','published','archived')),
  published_at timestamptz,
  archived_at timestamptz,
  check ((status = 'draft' and published_at is null and archived_at is null)
    or (status = 'published' and published_at is not null and archived_at is null)
    or (status = 'archived' and published_at is not null and archived_at is not null and archived_at >= published_at))
);
create index courses_teacher_idx on app_private.courses(teacher_id);
create index courses_subject_idx on app_private.courses(subject_id);
create index courses_catalog_idx on app_private.courses(grade_id, subject_id, teacher_id) where status = 'published';
create index courses_grade_fk_idx on app_private.courses(grade_id);
create table app_private.course_units (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references app_private.courses(id),
  title text not null check (length(btrim(title)) > 0),
  position integer not null check (position > 0),
  unique (course_id, position), unique (id, course_id)
);
create table app_private.lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references app_private.courses(id),
  unit_id uuid not null,
  position integer not null check (position > 0),
  title text not null check (length(btrim(title)) > 0),
  description text not null default '',
  published_at timestamptz,
  first_used_at timestamptz,
  current_video_id uuid,
  unique (id, course_id), unique (course_id, position),
  foreign key (unit_id, course_id) references app_private.course_units(id, course_id)
);
create index lessons_unit_idx on app_private.lessons(unit_id, course_id);
create table app_private.video_uploads (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references app_private.lessons(id),
  generation integer not null check (generation > 0),
  provider text not null check (provider in ('local','bunny')),
  library_id text,
  provider_video_id text,
  local_fixture_ref text,
  state text not null check (state in ('processing','ready','failed')),
  verification text not null check (verification in ('fixture','provider')),
  duration_seconds numeric(12,3) check (duration_seconds > 0 and duration_seconds <> 'NaN'::numeric),
  failure_code text,
  created_at timestamptz not null default clock_timestamp(),
  unique (lesson_id, generation), unique (id, lesson_id),
  check ((provider = 'local' and verification = 'fixture' and local_fixture_ref is not null
      and library_id is null and provider_video_id is null)
    or (provider = 'bunny' and verification = 'provider' and library_id is not null
      and provider_video_id is not null and local_fixture_ref is null)),
  check (state <> 'ready' or duration_seconds is not null),
  check ((state = 'failed') = (failure_code is not null))
);
create unique index video_provider_asset_idx on app_private.video_uploads(provider, library_id, provider_video_id)
  where provider = 'bunny';
alter table app_private.lessons add foreign key (current_video_id, id)
  references app_private.video_uploads(id, lesson_id) deferrable initially deferred;
create index lessons_video_idx on app_private.lessons(current_video_id, id);

create table app_private.assessments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references app_private.courses(id),
  unit_id uuid,
  lesson_id uuid,
  kind text not null check (kind in ('homework','exam')),
  title text not null check (length(btrim(title)) > 0),
  current_version_id uuid,
  unique (id, course_id, kind),
  foreign key (unit_id, course_id) references app_private.course_units(id, course_id),
  foreign key (lesson_id, course_id) references app_private.lessons(id, course_id),
  check ((kind = 'homework' and lesson_id is not null and unit_id is null)
    or (kind = 'exam' and lesson_id is null))
);
create unique index assessments_homework_idx on app_private.assessments(lesson_id) where kind = 'homework';
create index assessments_course_idx on app_private.assessments(course_id);
create index assessments_unit_idx on app_private.assessments(unit_id, course_id);
create index assessments_lesson_fk_idx on app_private.assessments(lesson_id, course_id);
create table app_private.assessment_versions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null,
  course_id uuid not null,
  kind text not null,
  version_number integer not null check (version_number > 0),
  duration_seconds integer,
  max_attempts integer,
  pass_percent numeric(6,3) not null check (pass_percent between 0 and 100),
  opens_at timestamptz,
  closes_at timestamptz,
  published_at timestamptz,
  unique (assessment_id, version_number), unique (id, assessment_id),
  unique (id, assessment_id, course_id, kind),
  foreign key (assessment_id, course_id, kind) references app_private.assessments(id, course_id, kind),
  check ((kind = 'homework' and duration_seconds is null and max_attempts is null
      and pass_percent = 70 and opens_at is null and closes_at is null)
    or (kind = 'exam' and duration_seconds is not null and duration_seconds > 0
      and max_attempts is not null and max_attempts > 0)),
  check (opens_at is null or closes_at is null or closes_at > opens_at)
);
alter table app_private.assessments add foreign key (current_version_id, id)
  references app_private.assessment_versions(id, assessment_id) deferrable initially deferred;
create index assessments_version_idx on app_private.assessments(current_version_id, id);
create table app_private.questions (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references app_private.assessment_versions(id),
  position integer not null check (position > 0),
  prompt text not null check (length(btrim(prompt)) > 0),
  points numeric(10,3) not null check (points > 0 and points <> 'NaN'::numeric),
  unique (version_id, position), unique (version_id, id)
);
create table app_private.question_options (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null,
  question_id uuid not null,
  position integer not null check (position between 1 and 6),
  label text not null check (length(btrim(label)) > 0),
  foreign key (version_id, question_id) references app_private.questions(version_id, id),
  unique (version_id, question_id, position), unique (version_id, question_id, id)
);
create table app_private.answer_keys (
  version_id uuid not null,
  question_id uuid not null,
  correct_option_id uuid not null,
  explanation text not null default '',
  primary key (version_id, question_id),
  foreign key (version_id, question_id, correct_option_id)
    references app_private.question_options(version_id, question_id, id)
);

create table app_private.code_batches (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references app_private.courses(id),
  duration_days integer not null check (duration_days in (30,60,90)),
  quantity integer not null check (quantity > 0),
  activate_before timestamptz,
  created_by uuid not null references app_private.accounts(id),
  request_id uuid not null,
  request_digest bytea not null check (octet_length(request_digest) = 32),
  created_at timestamptz not null default clock_timestamp(),
  unique (created_by, request_id), unique (id, course_id, duration_days),
  check (activate_before is null or activate_before > created_at)
);
create index code_batches_course_idx on app_private.code_batches(course_id);
create table app_private.activation_codes (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  course_id uuid not null,
  duration_days integer not null,
  code_digest bytea not null unique check (octet_length(code_digest) = 32),
  export_ciphertext bytea not null check (octet_length(export_ciphertext) > 0),
  encryption_key_id text not null check (length(btrim(encryption_key_id)) > 0),
  masked_suffix text not null check (length(masked_suffix) between 1 and 4),
  cancelled_at timestamptz,
  cancelled_by uuid references app_private.accounts(id),
  cancellation_reason text,
  unique (id, course_id, duration_days),
  foreign key (batch_id, course_id, duration_days) references app_private.code_batches(id, course_id, duration_days),
  check ((cancelled_at is null and cancelled_by is null and cancellation_reason is null)
    or (cancelled_at is not null and cancelled_by is not null and cancellation_reason is not null and length(btrim(cancellation_reason)) > 0))
);
create index activation_codes_batch_idx on app_private.activation_codes(batch_id, course_id, duration_days);
create index activation_codes_course_idx on app_private.activation_codes(course_id);
create index activation_codes_cancel_actor_idx on app_private.activation_codes(cancelled_by);
create table app_private.activations (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null unique,
  student_id uuid not null references app_private.student_profiles(account_id),
  course_id uuid not null,
  duration_days integer not null,
  access_event_id uuid not null unique,
  activated_at timestamptz not null,
  unique (id, student_id, course_id),
  foreign key (code_id, course_id, duration_days) references app_private.activation_codes(id, course_id, duration_days)
);
create index activations_student_course_idx on app_private.activations(student_id, course_id);
create index activations_course_idx on app_private.activations(course_id);
create table app_private.access_events (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references app_private.student_profiles(account_id),
  course_id uuid not null references app_private.courses(id),
  epoch integer not null check (epoch > 0),
  kind text not null check (kind in ('grant','renewal','regrant','extension','withdrawal')),
  activation_id uuid unique,
  actor_id uuid not null references app_private.accounts(id),
  operation_id uuid not null unique,
  reason text,
  added_days integer not null,
  occurred_at timestamptz not null,
  access_started_at timestamptz not null,
  access_until timestamptz not null check (access_until > access_started_at),
  unique (id, student_id, course_id, epoch),
  unique (activation_id, id, student_id, course_id),
  foreign key (activation_id, student_id, course_id) references app_private.activations(id, student_id, course_id)
    deferrable initially deferred,
  check ((kind in ('grant','renewal','regrant') and activation_id is not null and added_days in (30,60,90))
    or (kind = 'extension' and activation_id is null and added_days > 0 and reason is not null and length(btrim(reason)) > 0)
    or (kind = 'withdrawal' and activation_id is null and added_days = 0 and reason is not null and length(btrim(reason)) > 0))
);
alter table app_private.activations add foreign key (id, access_event_id, student_id, course_id)
  references app_private.access_events(activation_id, id, student_id, course_id) deferrable initially deferred;
create index access_events_student_course_idx on app_private.access_events(student_id, course_id, occurred_at, id);
create index access_events_course_idx on app_private.access_events(course_id);
create index access_events_actor_idx on app_private.access_events(actor_id);
create table app_private.course_access (
  student_id uuid not null references app_private.student_profiles(account_id),
  course_id uuid not null references app_private.courses(id),
  epoch integer not null check (epoch > 0),
  started_at timestamptz not null,
  access_until timestamptz not null check (access_until > started_at),
  withdrawn_at timestamptz,
  last_event_id uuid not null,
  primary key (student_id, course_id),
  foreign key (last_event_id, student_id, course_id, epoch)
    references app_private.access_events(id, student_id, course_id, epoch) deferrable initially deferred,
  check (withdrawn_at is null or withdrawn_at >= started_at)
);
create index course_access_course_idx on app_private.course_access(course_id);
create index course_access_event_idx on app_private.course_access(last_event_id, student_id, course_id, epoch);
alter table app_private.activations add foreign key (student_id, course_id)
  references app_private.course_access(student_id, course_id) deferrable initially deferred;

create table app_private.attempts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references app_private.student_profiles(account_id),
  assessment_id uuid not null,
  version_id uuid not null,
  course_id uuid not null,
  kind text not null,
  attempt_number integer not null check (attempt_number > 0),
  status text not null default 'in_progress' check (status in ('in_progress','submitted')),
  started_at timestamptz not null,
  deadline_at timestamptz,
  submitted_at timestamptz,
  submission_kind text check (submission_kind in ('manual','deadline')),
  result_id uuid,
  unique (student_id, assessment_id, attempt_number),
  unique (id, version_id), unique (id, status), unique (id, student_id, assessment_id, course_id, kind),
  foreign key (version_id, assessment_id, course_id, kind)
    references app_private.assessment_versions(id, assessment_id, course_id, kind),
  check ((kind = 'exam' and deadline_at is not null and deadline_at > started_at)
    or (kind = 'homework' and deadline_at is null)),
  check ((status = 'in_progress' and submitted_at is null and submission_kind is null and result_id is null)
    or (status = 'submitted' and submitted_at is not null and submitted_at >= started_at
      and submission_kind is not null and result_id is not null and result_id = id)),
  check (submission_kind is distinct from 'deadline' or (deadline_at is not null and submitted_at >= deadline_at))
);
create unique index attempts_one_active_idx on app_private.attempts(student_id, assessment_id) where status = 'in_progress';
create index attempts_version_idx on app_private.attempts(version_id, assessment_id, course_id, kind);
create index attempts_course_idx on app_private.attempts(course_id);
create index attempts_due_idx on app_private.attempts(deadline_at, id) where status = 'in_progress' and deadline_at is not null;
create index attempts_assessment_idx on app_private.attempts(assessment_id);
create table app_private.attempt_answers (
  attempt_id uuid not null,
  version_id uuid not null,
  question_id uuid not null,
  selected_option_id uuid,
  revision bigint not null check (revision > 0),
  received_at timestamptz not null,
  primary key (attempt_id, question_id),
  foreign key (attempt_id, version_id) references app_private.attempts(id, version_id),
  foreign key (version_id, question_id) references app_private.questions(version_id, id),
  foreign key (version_id, question_id, selected_option_id)
    references app_private.question_options(version_id, question_id, id)
);
create index attempt_answers_question_idx on app_private.attempt_answers(version_id, question_id, selected_option_id);
create table app_private.attempt_results (
  attempt_id uuid primary key,
  final_state text not null default 'submitted' check (final_state = 'submitted'),
  earned_points numeric(12,3) not null check (earned_points >= 0 and earned_points <> 'NaN'::numeric),
  possible_points numeric(12,3) not null check (possible_points > 0 and possible_points <> 'NaN'::numeric),
  passed boolean not null,
  graded_at timestamptz not null,
  check (earned_points <= possible_points),
  foreign key (attempt_id, final_state) references app_private.attempts(id, status) deferrable initially deferred
);
alter table app_private.attempts add foreign key (result_id) references app_private.attempt_results(attempt_id)
  deferrable initially deferred;
create index attempts_result_idx on app_private.attempts(result_id);
create table app_private.lesson_progress (
  student_id uuid not null references app_private.student_profiles(account_id),
  lesson_id uuid not null references app_private.lessons(id),
  completed_at timestamptz,
  position_seconds numeric(12,3) not null default 0 check (position_seconds >= 0 and position_seconds <> 'NaN'::numeric),
  revision bigint not null default 1 check (revision > 0),
  primary key (student_id, lesson_id)
);
create index lesson_progress_lesson_idx on app_private.lesson_progress(lesson_id);
create table app_private.homework_passes (
  student_id uuid not null,
  assessment_id uuid not null,
  course_id uuid not null,
  kind text not null default 'homework' check (kind = 'homework'),
  first_pass_attempt_id uuid not null,
  passed_at timestamptz not null,
  primary key (student_id, assessment_id),
  foreign key (first_pass_attempt_id, student_id, assessment_id, course_id, kind)
    references app_private.attempts(id, student_id, assessment_id, course_id, kind),
  foreign key (first_pass_attempt_id) references app_private.attempt_results(attempt_id)
);
create index homework_passes_attempt_idx on app_private.homework_passes(first_pass_attempt_id, student_id, assessment_id, course_id, kind);
create table app_private.gate_overrides (
  student_id uuid not null references app_private.student_profiles(account_id),
  lesson_id uuid not null references app_private.lessons(id),
  granted_by uuid not null references app_private.accounts(id),
  reason text not null check (length(btrim(reason)) > 0),
  granted_at timestamptz not null,
  operation_id uuid not null unique,
  primary key (student_id, lesson_id)
);
create index gate_overrides_lesson_idx on app_private.gate_overrides(lesson_id);
create index gate_overrides_actor_idx on app_private.gate_overrides(granted_by);
create table app_private.watch_leases (
  student_id uuid primary key references app_private.student_profiles(account_id),
  lesson_id uuid not null references app_private.lessons(id),
  generation bigint not null check (generation > 0),
  device_digest bytea not null check (octet_length(device_digest) = 32),
  token_digest bytea not null unique check (octet_length(token_digest) = 32),
  acquired_at timestamptz not null,
  heartbeat_at timestamptz not null,
  expires_at timestamptz not null,
  check (heartbeat_at >= acquired_at and expires_at > heartbeat_at)
);
create index watch_leases_lesson_idx on app_private.watch_leases(lesson_id);
create table app_private.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references app_private.accounts(id),
  action text not null check (length(btrim(action)) > 0),
  target_type text not null check (length(btrim(target_type)) > 0),
  target_id uuid not null,
  operation_id uuid not null,
  reason text,
  occurred_at timestamptz not null default clock_timestamp(),
  unique (operation_id, action, target_type, target_id)
);
create index audit_events_actor_idx on app_private.audit_events(actor_id, occurred_at);
create index audit_events_target_idx on app_private.audit_events(target_type, target_id, occurred_at);

-- History cannot be edited through ordinary SQL. Owner/superuser maintenance is a separate boundary.
create function app_private.reject_history_change() returns trigger language plpgsql
set search_path = pg_catalog as $$ begin raise exception using errcode='23514', message='immutable_history'; end $$;
do $$ declare t text; begin
  foreach t in array array['activations','access_events','attempt_results','homework_passes','gate_overrides','audit_events'] loop
    execute format('create trigger history_immutable before update or delete on app_private.%I for each row execute function app_private.reject_history_change()', t);
  end loop;
end $$;

create function app_private.guard_version() returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if tg_op = 'DELETE' then
    if old.published_at is not null then raise exception using errcode='23514', message='published_version_frozen'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.published_at is not null then
    raise exception using errcode='23514', message='published_version_frozen';
  end if;
  if new.published_at is not null then
    if not exists (select 1 from app_private.questions q where q.version_id = new.id)
      or exists (select 1 from app_private.questions q where q.version_id = new.id
        and ((select count(*) from app_private.question_options o where o.version_id = q.version_id and o.question_id = q.id) not between 2 and 6
          or not exists (select 1 from app_private.answer_keys k where k.version_id = q.version_id and k.question_id = q.id))) then
      raise exception using errcode='23514', message='assessment_not_ready';
    end if;
  end if;
  return new;
end $$;
create trigger version_guard before insert or update or delete on app_private.assessment_versions
for each row execute function app_private.guard_version();
create function app_private.guard_version_child() returns trigger language plpgsql set search_path = pg_catalog as $$
declare v uuid; p timestamptz;
begin
  v := case when tg_op = 'DELETE' then old.version_id else new.version_id end;
  if tg_op = 'UPDATE' and new.version_id <> old.version_id then
    raise exception using errcode='23514', message='version_reference_frozen';
  end if;
  select published_at into p from app_private.assessment_versions where id = v for update;
  if p is not null then raise exception using errcode='23514', message='published_version_frozen'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['questions','question_options','answer_keys'] loop
    execute format('create trigger version_child_guard before insert or update or delete on app_private.%I for each row execute function app_private.guard_version_child()', t);
  end loop;
end $$;
create function app_private.guard_lesson() returns trigger language plpgsql set search_path = pg_catalog as $$
declare env text; max_position integer;
begin
  if tg_op = 'DELETE' then
    if old.published_at is not null or old.first_used_at is not null then
      raise exception using errcode='23514', message='used_lesson_frozen';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and (old.published_at is not null or old.first_used_at is not null) then
    if row(new.course_id,new.unit_id,new.position,new.current_video_id,new.published_at)
      is distinct from row(old.course_id,old.unit_id,old.position,old.current_video_id,old.published_at)
      or (old.first_used_at is not null and new.first_used_at is distinct from old.first_used_at) then
      raise exception using errcode='23514', message='used_lesson_frozen';
    end if;
  end if;
  if new.published_at is not null and (tg_op = 'INSERT' or old.published_at is null) then
    select delivery_environment into env from app_private.courses where id = new.course_id for update;
    if not exists (select 1 from app_private.video_uploads where id = new.current_video_id and lesson_id = new.id
      and state = 'ready' and (env = 'development' or (provider = 'bunny' and verification = 'provider'))) then
      raise exception using errcode='23514', message='video_not_ready';
    end if;
    select max(position) into max_position from app_private.lessons where course_id = new.course_id and published_at is not null and id <> new.id;
    if max_position is not null and new.position <= max_position then
      raise exception using errcode='23514', message='publish_append_only';
    end if;
  end if;
  return new;
end $$;
create trigger lesson_guard before insert or update or delete on app_private.lessons for each row execute function app_private.guard_lesson();
create function app_private.guard_course() returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if tg_op = 'INSERT' and new.status <> 'draft' then raise exception using errcode='23514', message='course_must_start_draft'; end if;
  if tg_op = 'UPDATE' then
    if not ((new.status = old.status) or (old.status = 'draft' and new.status = 'published')
      or (old.status = 'published' and new.status = 'archived')) then
      raise exception using errcode='23514', message='course_transition_invalid';
    end if;
    if old.status <> 'draft' and row(new.teacher_id,new.grade_id,new.subject_id,new.delivery_environment,new.published_at)
      is distinct from row(old.teacher_id,old.grade_id,old.subject_id,old.delivery_environment,old.published_at) then
      raise exception using errcode='23514', message='course_identity_frozen';
    end if;
  end if;
  if new.status = 'published' and (tg_op = 'INSERT' or old.status = 'draft')
    and not exists (select 1 from app_private.lessons where course_id = new.id and published_at is not null) then
    raise exception using errcode='23514', message='course_not_ready';
  end if;
  return new;
end $$;
create trigger course_guard before insert or update on app_private.courses for each row execute function app_private.guard_course();

create trigger batch_immutable before update or delete on app_private.code_batches
for each row execute function app_private.reject_history_change();
create function app_private.guard_code() returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if tg_op = 'DELETE' then raise exception using errcode='23514', message='code_history_frozen'; end if;
  if row(new.id,new.batch_id,new.course_id,new.duration_days,new.code_digest,new.export_ciphertext,new.encryption_key_id,new.masked_suffix)
    is distinct from row(old.id,old.batch_id,old.course_id,old.duration_days,old.code_digest,old.export_ciphertext,old.encryption_key_id,old.masked_suffix)
    or (old.cancelled_at is not null and row(new.cancelled_at,new.cancelled_by,new.cancellation_reason)
      is distinct from row(old.cancelled_at,old.cancelled_by,old.cancellation_reason)) then
    raise exception using errcode='23514', message='code_identity_frozen';
  end if;
  if new.cancelled_at is not null and exists (select 1 from app_private.activations where code_id = new.id) then
    raise exception using errcode='23514', message='used_code_cannot_cancel';
  end if;
  return new;
end $$;
create trigger code_guard before update or delete on app_private.activation_codes for each row execute function app_private.guard_code();
create function app_private.guard_activation() returns trigger language plpgsql set search_path = pg_catalog as $$
declare c timestamptz;
begin
  select cancelled_at into c from app_private.activation_codes where id = new.code_id for update;
  if c is not null then raise exception using errcode='23514', message='cancelled_code_cannot_activate'; end if;
  return new;
end $$;
create trigger activation_guard before insert on app_private.activations for each row execute function app_private.guard_activation();
create function app_private.guard_attempt() returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if old.status = 'submitted' or tg_op = 'DELETE' then
    raise exception using errcode='23514', message='attempt_history_frozen';
  end if;
  if row(new.id,new.student_id,new.assessment_id,new.version_id,new.course_id,new.kind,new.attempt_number,new.started_at,new.deadline_at)
    is distinct from row(old.id,old.student_id,old.assessment_id,old.version_id,old.course_id,old.kind,old.attempt_number,old.started_at,old.deadline_at) then
    raise exception using errcode='23514', message='attempt_identity_frozen';
  end if;
  return new;
end $$;
create trigger attempt_guard before update or delete on app_private.attempts for each row execute function app_private.guard_attempt();
create function app_private.guard_answer() returns trigger language plpgsql set search_path = pg_catalog as $$
declare s text; d timestamptz; t timestamptz;
begin
  if tg_op = 'DELETE' then raise exception using errcode='23514', message='clear_answer_with_revision'; end if;
  if tg_op = 'UPDATE' and (new.revision <= old.revision
    or row(new.attempt_id,new.version_id,new.question_id) is distinct from row(old.attempt_id,old.version_id,old.question_id)) then
    raise exception using errcode='23514', message='answer_revision_conflict';
  end if;
  select status,deadline_at into s,d from app_private.attempts where id = new.attempt_id for update;
  t := clock_timestamp();
  if s <> 'in_progress' or (d is not null and t >= d) then
    raise exception using errcode='23514', message='answer_closed';
  end if;
  new.received_at := t;
  return new;
end $$;
create trigger answer_guard before insert or update or delete on app_private.attempt_answers for each row execute function app_private.guard_answer();
create function app_private.guard_homework_pass() returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if not exists (select 1 from app_private.attempt_results where attempt_id = new.first_pass_attempt_id
    and passed and earned_points * 100 >= possible_points * 70) then
    raise exception using errcode='23514', message='homework_not_passed';
  end if;
  return new;
end $$;
create trigger homework_pass_guard before insert on app_private.homework_passes
for each row execute function app_private.guard_homework_pass();
create function app_private.guard_progress() returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if tg_op = 'DELETE' then raise exception using errcode='23514', message='progress_history_frozen'; end if;
  if new.revision <= old.revision or row(new.student_id,new.lesson_id) is distinct from row(old.student_id,old.lesson_id)
    or (old.completed_at is not null and new.completed_at is distinct from old.completed_at) then
    raise exception using errcode='23514', message='progress_revision_or_completion_frozen';
  end if;
  return new;
end $$;
create trigger progress_guard before update or delete on app_private.lesson_progress
for each row execute function app_private.guard_progress();

-- Identity/entitlement eligibility, quotas, exact batch size and clock decisions are transaction responsibilities.
-- Do not grant client writes to these tables. F04 defines runtime roles and operation entry points.
do $$ declare t record; r text; begin
  for t in select tablename from pg_catalog.pg_tables where schemaname = 'app_private' loop
    execute format('alter table app_private.%I enable row level security',t.tablename);
    execute format('alter table app_private.%I force row level security',t.tablename);
  end loop;
  foreach r in array array['anon','authenticated','service_role'] loop
    if exists (select 1 from pg_catalog.pg_roles where rolname = r) then
      execute format('revoke all on schema app_private from %I',r);
      execute format('revoke all on all tables in schema app_private from %I',r);
      execute format('revoke all on all functions in schema app_private from %I',r);
      execute format('alter default privileges in schema app_private revoke all on tables from %I',r);
      execute format('alter default privileges in schema app_private revoke execute on functions from %I',r);
    end if;
  end loop;
end $$;
commit;
