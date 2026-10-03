begin;

-- Recoverable removal is separate from publication, entitlement and result history.
alter table app_private.courses add column deleted_at timestamptz;
alter table app_private.teachers add column deleted_at timestamptz;
alter table app_private.grades add column deleted_at timestamptz;
alter table app_private.subjects add column deleted_at timestamptz;
alter table app_private.course_units add column deleted_at timestamptz;
alter table app_private.lessons add column deleted_at timestamptz;
alter table app_private.assessments add column deleted_at timestamptz;
alter table app_private.code_batches add column deleted_at timestamptz;
alter table app_private.activation_codes add column deleted_at timestamptz;

-- Batch contents stay immutable. Only their administrative visibility can change.
-- The activation-code guard continues to prohibit physical deletion and freezes
-- cancellation/ownership data. No trigger on results or access history is relaxed.
create function app_private.guard_batch_metadata() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode='23514', message='immutable_history';
  end if;
  if (to_jsonb(new) - 'deleted_at') is distinct from (to_jsonb(old) - 'deleted_at') then
    raise exception using errcode='23514', message='immutable_history';
  end if;
  return new;
end $$;
drop trigger batch_immutable on app_private.code_batches;
create trigger batch_immutable before update or delete on app_private.code_batches
for each row execute function app_private.guard_batch_metadata();
revoke all on function app_private.guard_batch_metadata() from public,anon,authenticated,service_role;
grant execute on function app_private.guard_batch_metadata() to dorosna_server;

commit;
