create extension if not exists pgcrypto with schema extensions;

create table if not exists public.attendance_punches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  user_id uuid not null references public.users(id),
  employee_id uuid references public.employees(id),
  punched_at timestamptz not null default now(),
  punch_type text not null check (punch_type in ('clock_in','clock_out','out','return')),
  latitude numeric(10,6),
  longitude numeric(10,6),
  address text,
  device_info text,
  wifi_ssid text,
  ip_address text,
  is_abnormal boolean not null default false,
  abnormal_reason text,
  rule_name text,
  passed_rule text,
  distance_meters int,
  review_status text not null default 'none' check (review_status in ('none','pending','approved','rejected')),
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.payroll_payslip_access (
  user_id uuid primary key references public.users(id),
  password_hash text not null,
  read_log jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.attendance_punches enable row level security;
alter table public.payroll_payslip_access enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='attendance_punches' and policyname='users view own punches or hr') then
    create policy "users view own punches or hr" on public.attendance_punches
    for select to authenticated
    using (deleted_at is null and (user_id in (select id from public.users where auth_user_id = auth.uid()) or private.is_hr_admin()));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='attendance_punches' and policyname='users insert own punches') then
    create policy "users insert own punches" on public.attendance_punches
    for insert to authenticated
    with check (user_id in (select id from public.users where auth_user_id = auth.uid()));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='attendance_punches' and policyname='hr reviews punches') then
    create policy "hr reviews punches" on public.attendance_punches
    for update to authenticated
    using (private.is_hr_admin() or user_id in (select id from public.users where auth_user_id = auth.uid()))
    with check (private.is_hr_admin() or user_id in (select id from public.users where auth_user_id = auth.uid()));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='payroll_payslip_access' and policyname='users manage own payslip access') then
    create policy "users manage own payslip access" on public.payroll_payslip_access
    for all to authenticated
    using (user_id in (select id from public.users where auth_user_id = auth.uid()))
    with check (user_id in (select id from public.users where auth_user_id = auth.uid()));
  end if;
end $$;

create or replace function public.initialize_payslip_password(target_user_id uuid, initial_password text)
returns boolean
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if length(coalesce(initial_password, '')) < 8 then
    raise exception '薪資袋密碼至少需要 8 碼';
  end if;

  if not exists (select 1 from public.users where id = target_user_id and auth_user_id = auth.uid()) then
    return false;
  end if;

  insert into public.payroll_payslip_access (user_id, password_hash)
  values (target_user_id, extensions.crypt(initial_password, extensions.gen_salt('bf')))
  on conflict (user_id) do nothing;

  return true;
end;
$$;

create or replace function public.verify_payslip_password(target_user_id uuid, plain_password text)
returns boolean
language sql
security definer
set search_path = public, auth, extensions
as $$
  select exists (
    select 1
    from public.payroll_payslip_access access
    join public.users app_user on app_user.id = access.user_id
    where access.user_id = target_user_id
      and app_user.auth_user_id = auth.uid()
      and access.deleted_at is null
      and access.password_hash = extensions.crypt(plain_password, access.password_hash)
  );
$$;

create or replace function public.set_payslip_password(target_user_id uuid, current_password text, next_password text)
returns boolean
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if length(coalesce(next_password, '')) < 8 then
    raise exception '薪資袋密碼至少需要 8 碼';
  end if;

  if not exists (
    select 1 from public.payroll_payslip_access access
    join public.users app_user on app_user.id = access.user_id
    where access.user_id = target_user_id
      and app_user.auth_user_id = auth.uid()
      and access.password_hash = extensions.crypt(current_password, access.password_hash)
  ) then
    return false;
  end if;

  update public.payroll_payslip_access
  set password_hash = extensions.crypt(next_password, extensions.gen_salt('bf')), updated_at = now()
  where user_id = target_user_id;
  return true;
end;
$$;
