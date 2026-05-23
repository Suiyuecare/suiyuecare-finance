create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  recipient_user_id uuid references public.users(id),
  notification_type text not null,
  title text not null,
  content text not null,
  channels jsonb not null default '[]'::jsonb,
  status text not null default 'unread',
  source_module text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.notifications enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='notifications' and policyname='users view own notifications or hr') then
    create policy "users view own notifications or hr" on public.notifications
    for select to authenticated
    using (deleted_at is null and (recipient_user_id in (select id from public.users where auth_user_id = auth.uid()) or private.is_hr_admin()));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='notifications' and policyname='hr inserts notifications') then
    create policy "hr inserts notifications" on public.notifications
    for insert to authenticated
    with check (private.is_hr_admin() or recipient_user_id in (select id from public.users where auth_user_id = auth.uid()));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='notifications' and policyname='users update own notifications or hr') then
    create policy "users update own notifications or hr" on public.notifications
    for update to authenticated
    using (private.is_hr_admin() or recipient_user_id in (select id from public.users where auth_user_id = auth.uid()))
    with check (private.is_hr_admin() or recipient_user_id in (select id from public.users where auth_user_id = auth.uid()));
  end if;
end $$;
