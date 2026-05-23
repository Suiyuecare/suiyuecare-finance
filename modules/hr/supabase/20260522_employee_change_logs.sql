create table if not exists public.employee_change_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  employee_id uuid not null references public.employees(id) on delete cascade,
  change_type text not null
    check (change_type in ('department','position','salary','supervisor','branch','status','onboarding','leave_without_pay','reinstatement','termination')),
  before_value text not null,
  after_value text not null,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  reason text not null,
  effective_date date not null,
  status text not null default 'applied' check (status in ('draft','pending','approved','applied','cancelled')),
  applied_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (before_value <> after_value)
);

create index if not exists idx_employee_change_logs_employee_effective
on public.employee_change_logs(employee_id, effective_date desc);

create index if not exists idx_employee_change_logs_company_type
on public.employee_change_logs(company_id, change_type, effective_date desc);

drop trigger if exists trg_employee_change_logs_updated_at on public.employee_change_logs;
create trigger trg_employee_change_logs_updated_at before update on public.employee_change_logs
for each row execute function public.set_updated_at();

alter table public.employee_change_logs enable row level security;

drop policy if exists "employee data managers can manage company employee changes" on public.employee_change_logs;
create policy "employee data managers can manage company employee changes"
on public.employee_change_logs for all
to authenticated
using (
  public.can_manage_employee_data()
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
)
with check (
  public.can_manage_employee_data()
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
);

drop policy if exists "employees can view own employee changes" on public.employee_change_logs;
create policy "employees can view own employee changes"
on public.employee_change_logs for select
to authenticated
using (
  auth.uid() is not null
  and deleted_at is null
  and employee_id = public.current_employee_id()
);
