create table if not exists public.shift_change_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  applicant_employee_id uuid not null references public.employees(id),
  counterpart_employee_id uuid not null references public.employees(id),
  original_schedule_id uuid not null references public.schedules(id),
  target_schedule_id uuid references public.schedules(id),
  request_type text not null check (request_type in ('swap','substitute')),
  reason text not null,
  status text not null default 'pending_counterpart'
    check (status in ('draft','pending_counterpart','pending_manager','pending_hr','completed','rejected','cancelled')),
  workflow_stage text not null default 'counterpart'
    check (workflow_stage in ('applicant','counterpart','manager','hr','schedule_updated','notified','rejected','cancelled')),
  original_snapshot jsonb not null default '{}'::jsonb,
  target_snapshot jsonb not null default '{}'::jsonb,
  notifications jsonb not null default '[]'::jsonb,
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  completed_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (applicant_employee_id <> counterpart_employee_id)
);

create index if not exists idx_shift_change_requests_company_status
on public.shift_change_requests(company_id, status, created_at desc);

create index if not exists idx_shift_change_requests_applicant
on public.shift_change_requests(applicant_employee_id, created_at desc);

create index if not exists idx_shift_change_requests_counterpart
on public.shift_change_requests(counterpart_employee_id, created_at desc);

drop trigger if exists trg_shift_change_requests_updated_at on public.shift_change_requests;
create trigger trg_shift_change_requests_updated_at before update on public.shift_change_requests
for each row execute function public.set_updated_at();

alter table public.shift_change_requests enable row level security;

drop policy if exists "employees can view related shift change requests" on public.shift_change_requests;
create policy "employees can view related shift change requests"
on public.shift_change_requests for select
to authenticated
using (
  auth.uid() is not null
  and deleted_at is null
  and public.current_employee_id() in (applicant_employee_id, counterpart_employee_id)
);

drop policy if exists "employees can create own shift change requests" on public.shift_change_requests;
create policy "employees can create own shift change requests"
on public.shift_change_requests for insert
to authenticated
with check (
  auth.uid() is not null
  and applicant_employee_id = public.current_employee_id()
);

drop policy if exists "shift change approvers can manage company requests" on public.shift_change_requests;
create policy "shift change approvers can manage company requests"
on public.shift_change_requests for all
to authenticated
using (
  public.current_role_key() in ('super_admin','company_admin','hr_manager','hr_staff','department_manager','homecare_supervisor','admin_director','ceo')
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
)
with check (
  public.current_role_key() in ('super_admin','company_admin','hr_manager','hr_staff','department_manager','homecare_supervisor','admin_director','ceo')
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
);
