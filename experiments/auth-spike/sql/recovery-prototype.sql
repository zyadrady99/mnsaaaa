-- F01 LOCAL EXPERIMENT ONLY. This is not the platform's F03 schema or migration.
-- A single DO statement keeps CLI 2.119.0's prepared query atomic.
do $prototype$
begin
create schema if not exists auth_spike_private;
revoke all on schema auth_spike_private from public, anon, authenticated, service_role;
do $block$
begin
  if not exists (select 1 from pg_roles where rolname = 'dorosna_auth_spike_server') then
    create role dorosna_auth_spike_server nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end
$block$;

create table if not exists auth_spike_private.accounts (
  id uuid primary key,
  run_id uuid not null,
  phone text not null unique check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  role text not null check (role in ('student', 'admin')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  auth_epoch integer not null default 0 check (auth_epoch >= 0),
  recovery_locked boolean not null default false
);
create index if not exists accounts_run_idx on auth_spike_private.accounts(run_id);

create table if not exists auth_spike_private.sessions (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  account_id uuid not null references auth_spike_private.accounts(id),
  auth_epoch integer not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists sessions_account_idx on auth_spike_private.sessions(account_id);

create table if not exists auth_spike_private.recoveries (
  id uuid primary key,
  account_id uuid not null references auth_spike_private.accounts(id),
  actor_id uuid not null references auth_spike_private.accounts(id),
  verification_ref text not null check (verification_ref ~ '^[A-Za-z0-9_-]{1,64}$'),
  auth_epoch integer not null,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  recovery_session_hash text unique check (recovery_session_hash ~ '^[a-f0-9]{64}$'),
  stage text not null check (stage in ('preparing', 'issued', 'exchanged', 'claimed', 'applied', 'consumed', 'cancelled', 'review_uncertain')),
  operation_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check ((stage in ('claimed', 'applied', 'consumed')) = (operation_id is not null) or stage = 'review_uncertain')
);
create index if not exists recoveries_account_idx on auth_spike_private.recoveries(account_id);
-- Idempotent when rerun against an earlier revision of this empty prototype.
alter table auth_spike_private.recoveries add column if not exists verification_ref text;
alter table auth_spike_private.recoveries alter column verification_ref set not null;
create index if not exists recoveries_actor_idx on auth_spike_private.recoveries(actor_id);
create unique index if not exists recoveries_one_pending_idx on auth_spike_private.recoveries(account_id)
  where stage in ('preparing', 'issued', 'exchanged', 'claimed', 'applied', 'review_uncertain');

create table if not exists auth_spike_private.audit (
  id uuid primary key,
  recovery_id uuid not null references auth_spike_private.recoveries(id),
  actor_id uuid not null references auth_spike_private.accounts(id),
  account_id uuid not null references auth_spike_private.accounts(id),
  event text not null check (event in ('recovery_started', 'auth_frozen', 'token_exchanged', 'password_claimed', 'password_applied', 'recovery_completed', 'recovery_cancelled', 'review_required')),
  reason text not null check (reason = 'in_person_verified'),
  verification_ref text not null check (verification_ref ~ '^[A-Za-z0-9_-]{1,64}$'),
  created_at timestamptz not null default now()
);
create index if not exists audit_recovery_idx on auth_spike_private.audit(recovery_id);
create index if not exists audit_actor_idx on auth_spike_private.audit(actor_id);
create index if not exists audit_account_idx on auth_spike_private.audit(account_id);

revoke all on all tables in schema auth_spike_private from public, anon, authenticated, service_role;
grant usage on schema auth_spike_private to dorosna_auth_spike_server;
grant select, insert, update on auth_spike_private.accounts, auth_spike_private.sessions, auth_spike_private.recoveries to dorosna_auth_spike_server;
grant insert on auth_spike_private.audit to dorosna_auth_spike_server;

alter table auth_spike_private.accounts enable row level security;
alter table auth_spike_private.sessions enable row level security;
alter table auth_spike_private.recoveries enable row level security;
alter table auth_spike_private.audit enable row level security;
alter table auth_spike_private.accounts force row level security;
alter table auth_spike_private.sessions force row level security;
alter table auth_spike_private.recoveries force row level security;
alter table auth_spike_private.audit force row level security;
-- The gateway is trusted to authorize each request against these private rows.
-- No client role receives a policy or even schema USAGE.
drop policy if exists experiment_server on auth_spike_private.accounts;
create policy experiment_server on auth_spike_private.accounts to dorosna_auth_spike_server using (true) with check (true);
drop policy if exists experiment_server on auth_spike_private.sessions;
create policy experiment_server on auth_spike_private.sessions to dorosna_auth_spike_server using (true) with check (true);
drop policy if exists experiment_server on auth_spike_private.recoveries;
create policy experiment_server on auth_spike_private.recoveries to dorosna_auth_spike_server using (true) with check (true);
drop policy if exists experiment_server on auth_spike_private.audit;
create policy experiment_server on auth_spike_private.audit for insert to dorosna_auth_spike_server with check (true);
end
$prototype$;
