create table if not exists public.employee_payroll_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  salary_type text not null
    check (salary_type in ('monthly','hourly','daily','piece_rate')),
  base_salary numeric(14,2) not null default 0,
  meal_allowance numeric(14,2) not null default 0,
  position_allowance numeric(14,2) not null default 0,
  license_allowance numeric(14,2) not null default 0,
  transportation_allowance numeric(14,2) not null default 0,
  attendance_bonus numeric(14,2) not null default 0,
  supervisor_allowance numeric(14,2) not null default 0,
  labor_insurance_grade numeric(12,2) not null default 0,
  health_insurance_grade numeric(12,2) not null default 0,
  labor_pension_rate numeric(5,2) not null default 6,
  tax_setting text not null default 'standard'
    check (tax_setting in ('standard','fixed_rate','exempt','employee_declaration')),
  supplementary_nhi_setting text not null default 'bonus_threshold'
    check (supplementary_nhi_setting in ('disabled','bonus_threshold','part_time_income','all_enabled')),
  bank_code text,
  bank_account text,
  bank_account_last_five text generated always as (
    case
      when bank_account is null or length(regexp_replace(bank_account, '\D', '', 'g')) < 5 then null
      else right(regexp_replace(bank_account, '\D', '', 'g'), 5)
    end
  ) stored,
  effective_from date not null default current_date,
  effective_to date,
  status text not null default 'active'
    check (status in ('draft','active','inactive')),
  note text,
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(company_id, employee_id)
);

create index if not exists idx_employee_payroll_settings_company on public.employee_payroll_settings(company_id, status, deleted_at);
create index if not exists idx_employee_payroll_settings_employee on public.employee_payroll_settings(employee_id);

drop trigger if exists trg_employee_payroll_settings_updated_at on public.employee_payroll_settings;
create trigger trg_employee_payroll_settings_updated_at before update on public.employee_payroll_settings
for each row execute function public.set_updated_at();

alter table public.employee_payroll_settings enable row level security;

drop policy if exists "payroll managers can view company employee payroll settings" on public.employee_payroll_settings;
create policy "payroll managers can view company employee payroll settings"
on public.employee_payroll_settings for select
to authenticated
using (
  public.can_manage_payroll()
  and deleted_at is null
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
);

drop policy if exists "payroll managers can manage company employee payroll settings" on public.employee_payroll_settings;
create policy "payroll managers can manage company employee payroll settings"
on public.employee_payroll_settings for all
to authenticated
using (
  public.can_manage_payroll()
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
)
with check (
  public.can_manage_payroll()
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
);
