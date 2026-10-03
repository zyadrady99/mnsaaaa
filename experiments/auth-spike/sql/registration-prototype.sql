-- F01 experiment extension only; no final platform migration.
do $prototype$
begin
alter table auth_spike_private.accounts add column if not exists full_name text not null default 'F01 fixture';
alter table auth_spike_private.accounts add column if not exists grade_id text not null default 'f01_grade_1';
alter table auth_spike_private.accounts add column if not exists provisioning_locked boolean not null default false;

create table if not exists auth_spike_private.grades (
  id text primary key,
  enabled boolean not null default true
);
insert into auth_spike_private.grades(id) values ('f01_grade_1'), ('f01_grade_2') on conflict do nothing;
create table if not exists auth_spike_private.registrations (
  key_hash text primary key check (key_hash ~ '^[a-f0-9]{64}$'),
  operation_id uuid not null unique,
  auth_user_id uuid not null unique,
  run_id uuid not null,
  phone text not null,
  full_name text not null,
  grade_id text not null references auth_spike_private.grades(id),
  stage text not null check (stage in ('reserved', 'profiled', 'complete', 'review_uncertain')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table auth_spike_private.registrations drop constraint if exists registrations_stage_check;
alter table auth_spike_private.registrations add constraint registrations_stage_check check (stage in ('reserved', 'creating', 'profiled', 'complete', 'review_uncertain', 'cancelled'));
drop index if exists auth_spike_private.registrations_phone_idx;
create unique index registrations_phone_idx on auth_spike_private.registrations(phone) where stage <> 'cancelled';
alter table auth_spike_private.registrations add column if not exists reconciled_by uuid references auth_spike_private.accounts(id);
alter table auth_spike_private.registrations add column if not exists reconciliation_ref text;
alter table auth_spike_private.registrations add column if not exists reconciled_at timestamptz;
create index if not exists registrations_reconciled_by_idx on auth_spike_private.registrations(reconciled_by);
create index if not exists registrations_run_idx on auth_spike_private.registrations(run_id);
create index if not exists registrations_grade_idx on auth_spike_private.registrations(grade_id);
create table if not exists auth_spike_private.request_limits (
  bucket_hash text primary key check (bucket_hash ~ '^[a-f0-9]{64}$'),
  attempts integer not null check (attempts > 0),
  reset_at timestamptz not null
);
alter table auth_spike_private.request_limits add column if not exists scope_hash text;
alter table auth_spike_private.request_limits alter column scope_hash set not null;
create index if not exists request_limits_scope_idx on auth_spike_private.request_limits(scope_hash);
revoke all on auth_spike_private.grades, auth_spike_private.registrations, auth_spike_private.request_limits from public, anon, authenticated, service_role;
grant select on auth_spike_private.grades to dorosna_auth_spike_server;
grant select, insert, update on auth_spike_private.registrations, auth_spike_private.request_limits to dorosna_auth_spike_server;
alter table auth_spike_private.grades enable row level security;
alter table auth_spike_private.grades force row level security;
alter table auth_spike_private.registrations enable row level security;
alter table auth_spike_private.registrations force row level security;
alter table auth_spike_private.request_limits enable row level security;
alter table auth_spike_private.request_limits force row level security;
drop policy if exists experiment_server on auth_spike_private.grades;
create policy experiment_server on auth_spike_private.grades for select to dorosna_auth_spike_server using (true);
drop policy if exists experiment_server on auth_spike_private.registrations;
create policy experiment_server on auth_spike_private.registrations to dorosna_auth_spike_server using (true) with check (true);
drop policy if exists experiment_server on auth_spike_private.request_limits;
create policy experiment_server on auth_spike_private.request_limits to dorosna_auth_spike_server using (true) with check (true);

alter table auth_spike_private.recoveries drop constraint if exists recoveries_check;
alter table auth_spike_private.recoveries drop constraint if exists recoveries_operation_state;
alter table auth_spike_private.recoveries add constraint recoveries_operation_state
  check (stage not in ('claimed', 'applied', 'consumed') or operation_id is not null);
-- Allow re-freezing a stranded operation before issuing any replacement token.
alter table auth_spike_private.recoveries drop constraint if exists recoveries_stage_check;
alter table auth_spike_private.recoveries add constraint recoveries_stage_check check
  (stage in ('preparing', 'issued', 'exchanged', 'claimed', 'applied', 'consumed', 'cancelled', 'review_uncertain', 'reconciling'));
drop index if exists auth_spike_private.recoveries_one_pending_idx;
create unique index recoveries_one_pending_idx on auth_spike_private.recoveries(account_id)
  where stage in ('preparing', 'issued', 'exchanged', 'claimed', 'applied', 'review_uncertain', 'reconciling');
execute 'create or replace function auth_spike_private.f01_rpc_probe() returns integer language sql security invoker set search_path = '''' as ''select 1''';
revoke all on function auth_spike_private.f01_rpc_probe() from public, anon, authenticated, service_role;
grant execute on function auth_spike_private.f01_rpc_probe() to dorosna_auth_spike_server;
notify pgrst, 'reload schema';
end
$prototype$;
