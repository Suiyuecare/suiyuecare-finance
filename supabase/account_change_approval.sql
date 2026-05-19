-- 會計科目異動核准
-- 目的：會計科目新增、修改、停用、刪除必須可追蹤；非執行長只能送審，執行長核准後才套用 accounts 設定。

create table if not exists public.account_change_requests (
  id text primary key,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reason text not null,
  change_summary text,
  changes jsonb not null default '[]'::jsonb,
  proposed_accounts jsonb not null default '[]'::jsonb,
  submitted_by text,
  submitted_by_email text,
  submitted_at timestamptz not null default now(),
  reviewed_by text,
  reviewed_by_email text,
  reviewed_at timestamptz,
  data_environment text not null default 'production' check (data_environment in ('production', 'test')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.account_change_requests enable row level security;
alter table public.account_change_requests force row level security;

create index if not exists idx_account_change_requests_env_status
  on public.account_change_requests(data_environment, status, submitted_at desc);

grant select, insert, update on public.account_change_requests to authenticated;

drop policy if exists account_change_requests_read on public.account_change_requests;
create policy account_change_requests_read
on public.account_change_requests
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

drop policy if exists account_change_requests_submit on public.account_change_requests;
create policy account_change_requests_submit
on public.account_change_requests
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

drop policy if exists account_change_requests_review on public.account_change_requests;
create policy account_change_requests_review
on public.account_change_requests
for update
to authenticated
using (
  exists (
    select 1
    from public.finance_users fu
    where lower(fu.email) = lower(auth.jwt() ->> 'email')
      and fu.active = true
      and fu.role = 'ceo'
  )
)
with check (
  exists (
    select 1
    from public.finance_users fu
    where lower(fu.email) = lower(auth.jwt() ->> 'email')
      and fu.active = true
      and fu.role = 'ceo'
  )
);

create or replace function public.prevent_non_ceo_account_setting_apply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
begin
  if new.key <> 'accounts' then
    return new;
  end if;

  if current_user in ('postgres', 'supabase_admin') or coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return new;
  end if;

  select fu.role
    into actor_role
  from public.finance_users fu
  where lower(fu.email) = lower(auth.jwt() ->> 'email')
    and fu.active = true
  limit 1;

  if actor_role <> 'ceo' then
    raise exception '會計科目異動必須由執行長核准後才可套用 accounts 設定';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_non_ceo_account_setting_apply on public.system_settings;
create trigger trg_prevent_non_ceo_account_setting_apply
before insert or update on public.system_settings
for each row
execute function public.prevent_non_ceo_account_setting_apply();

-- 備註：
-- 1. 前端會把會計 / 行政部門主任提出的科目異動放入 pending_settings_changes，
--    同時寫入 account_change_requests 供追蹤。
-- 2. 真正改寫 system_settings.accounts 時，資料庫 trigger 會擋下非執行長。
-- 3. 若使用 SQL editor 或 service role 做維護，仍可進行緊急修復，但應補 audit log。
