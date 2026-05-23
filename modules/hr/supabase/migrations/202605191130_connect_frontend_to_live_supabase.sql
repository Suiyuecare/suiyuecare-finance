create table if not exists public.hr_requests (
  id text primary key,
  no text not null unique,
  request_type text not null,
  applicant_id uuid not null references public.users(id),
  entity_id text not null default 'hr',
  department_code text not null default '',
  status text not null default 'pending',
  current_step text not null default '申請人主管',
  current_owner_role text not null default 'supervisor',
  started_at timestamptz,
  ended_at timestamptz,
  total_hours numeric(8,2),
  reason text,
  payload jsonb not null default '{}'::jsonb,
  files jsonb not null default '[]'::jsonb,
  timeline jsonb not null default '[]'::jsonb,
  audit_logs jsonb not null default '[]'::jsonb,
  compliance_result jsonb not null default '{}'::jsonb,
  finance_handoff_status text not null default 'not_required',
  finance_reference_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.hr_requests enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='companies' and policyname='hr admins manage companies') then
    create policy "hr admins manage companies" on public.companies for all to authenticated using (private.is_hr_admin()) with check (private.is_hr_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='branches' and policyname='hr admins manage branches') then
    create policy "hr admins manage branches" on public.branches for all to authenticated using (private.is_hr_admin()) with check (private.is_hr_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='departments' and policyname='hr admins manage departments') then
    create policy "hr admins manage departments" on public.departments for all to authenticated using (private.is_hr_admin()) with check (private.is_hr_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='positions' and policyname='hr admins manage positions') then
    create policy "hr admins manage positions" on public.positions for all to authenticated using (private.is_hr_admin()) with check (private.is_hr_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='hr_requests' and policyname='hr requests visible by applicant or approver') then
    create policy "hr requests visible by applicant or approver" on public.hr_requests
    for select to authenticated
    using (
      deleted_at is null and (
        applicant_id in (select id from public.users where auth_user_id = auth.uid())
        or private.is_hr_admin()
        or current_owner_role = private.current_role_key()
      )
    );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='hr_requests' and policyname='users create own hr requests') then
    create policy "users create own hr requests" on public.hr_requests
    for insert to authenticated
    with check (applicant_id in (select id from public.users where auth_user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='hr_requests' and policyname='hr requests update by applicant approver or hr') then
    create policy "hr requests update by applicant approver or hr" on public.hr_requests
    for update to authenticated
    using (
      applicant_id in (select id from public.users where auth_user_id = auth.uid())
      or private.is_hr_admin()
      or current_owner_role = private.current_role_key()
    )
    with check (
      applicant_id in (select id from public.users where auth_user_id = auth.uid())
      or private.is_hr_admin()
      or current_owner_role = private.current_role_key()
    );
  end if;
end $$;
