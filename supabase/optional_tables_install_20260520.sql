-- Optional production tables install bundle
-- Covers tables used by the front-end health checks:
-- 1. system_setting_versions
-- 2. backup_restore_events

create table if not exists public.system_setting_versions (
  id text primary key,
  version_no text not null,
  target text not null,
  summary text,
  snapshot jsonb not null default '{}'::jsonb,
  change_request_id text,
  created_by text,
  approved_by text,
  data_environment text not null default 'production' check (data_environment in ('production', 'test')),
  created_at timestamptz not null default now()
);

alter table public.system_setting_versions enable row level security;
alter table public.system_setting_versions force row level security;

create unique index if not exists idx_system_setting_versions_env_no
  on public.system_setting_versions(data_environment, version_no);

create index if not exists idx_system_setting_versions_env_created
  on public.system_setting_versions(data_environment, created_at desc);

create index if not exists idx_system_setting_versions_target
  on public.system_setting_versions(target, created_at desc);

grant select, insert on public.system_setting_versions to authenticated;

drop policy if exists system_setting_versions_read on public.system_setting_versions;
create policy system_setting_versions_read
on public.system_setting_versions
for select
to authenticated
using (
  exists (
    select 1
    from public.finance_users fu
    where lower(fu.email) = lower(auth.jwt() ->> 'email')
      and fu.active = true
      and fu.role in ('accountant', 'admin_director', 'ceo')
  )
);

drop policy if exists system_setting_versions_insert on public.system_setting_versions;
create policy system_setting_versions_insert
on public.system_setting_versions
for insert
to authenticated
with check (
  exists (
    select 1
    from public.finance_users fu
    where lower(fu.email) = lower(auth.jwt() ->> 'email')
      and fu.active = true
      and fu.role = 'ceo'
  )
);

create table if not exists public.backup_restore_events (
  id text primary key,
  action text not null check (action in ('backup', 'restore')),
  status text not null default 'completed',
  file_name text,
  file_hash text,
  summary jsonb not null default '{}'::jsonb,
  actor_name text,
  note text,
  data_environment text not null default 'production' check (data_environment in ('production', 'test')),
  created_at timestamptz not null default now()
);

alter table public.backup_restore_events enable row level security;
alter table public.backup_restore_events force row level security;

create index if not exists idx_backup_restore_events_env_created
  on public.backup_restore_events(data_environment, created_at desc);

create index if not exists idx_backup_restore_events_action
  on public.backup_restore_events(action, status);

grant select, insert, update on public.backup_restore_events to authenticated;

drop policy if exists "finance backup events read" on public.backup_restore_events;
create policy "finance backup events read"
on public.backup_restore_events
for select
to authenticated
using (
  exists (
    select 1
    from public.finance_users fu
    where lower(fu.email) = lower(auth.jwt() ->> 'email')
      and fu.active = true
      and fu.role in ('accountant', 'admin_director', 'ceo')
  )
);

drop policy if exists "finance backup events write" on public.backup_restore_events;
create policy "finance backup events write"
on public.backup_restore_events
for insert
to authenticated
with check (
  exists (
    select 1
    from public.finance_users fu
    where lower(fu.email) = lower(auth.jwt() ->> 'email')
      and fu.active = true
      and fu.role in ('accountant', 'admin_director', 'ceo')
  )
);

drop policy if exists "finance backup events update" on public.backup_restore_events;
create policy "finance backup events update"
on public.backup_restore_events
for update
to authenticated
using (
  exists (
    select 1
    from public.finance_users fu
    where lower(fu.email) = lower(auth.jwt() ->> 'email')
      and fu.active = true
      and fu.role in ('accountant', 'admin_director', 'ceo')
  )
)
with check (
  exists (
    select 1
    from public.finance_users fu
    where lower(fu.email) = lower(auth.jwt() ->> 'email')
      and fu.active = true
      and fu.role in ('accountant', 'admin_director', 'ceo')
  )
);
