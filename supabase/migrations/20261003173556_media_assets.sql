create table app_private.media_assets (
  id uuid primary key,
  kind text not null check (kind in ('teacher','course')),
  content_type text not null check (content_type='image/webp'),
  bytes integer not null check (bytes>0 and bytes<=5242880),
  width integer not null check (width>0 and width<=2400),
  height integer not null check (height>0 and height<=2400),
  created_by uuid not null references app_private.accounts(id),
  created_at timestamptz not null default clock_timestamp()
);
create index media_assets_created_by_idx on app_private.media_assets(created_by);
alter table app_private.media_assets enable row level security;
revoke all on app_private.media_assets from public,anon,authenticated;
grant select,insert,delete on app_private.media_assets to dorosna_server;
create policy server_connection on app_private.media_assets to dorosna_server using (true) with check (true);
