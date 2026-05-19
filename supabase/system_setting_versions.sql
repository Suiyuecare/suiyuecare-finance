-- 系統設定版本紀錄
-- 目的：每次正式系統設定生效時保存版本快照，便於稽核、回看與匯出。

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

-- 版本紀錄是稽核資料，不提供 update/delete policy。
-- 若需修正，請新增下一版設定並於 audit log 說明原因。
