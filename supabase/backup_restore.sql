-- 備份與還原紀錄
-- 目的：記錄每次備份包下載與還原動作，讓正式上線後可追蹤誰在何時做了備份/還原。

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

-- 說明：
-- 1. 前端備份包保存業務資料 JSON 與附件路徑，不保存 Supabase Auth 密碼。
-- 2. Supabase 專案層級完整備份仍建議用官方 PITR / scheduled backups / pg_dump 管理。
-- 3. 正式還原前，請先在 test data_environment 還原檢查，再進 production。
