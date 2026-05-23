-- Module HR schema for Suiyue Care Group.
-- Designed to share identity, entity, department, audit and finance handoff data
-- with Module Finance and future business modules.

create extension if not exists pgcrypto;

do $$
begin
  create type hr_role as enum (
    'super_admin',
    'company_admin',
    'hr_manager',
    'hr_staff',
    'accountant',
    'department_manager',
    'employee',
    'homecare_supervisor',
    'homecare_worker',
    'daycare_staff'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists companies (
  id text primary key,
  code text unique not null,
  name text not null,
  legal_name text,
  tax_id text unique,
  industry text not null default 'long_term_care',
  status text not null default 'active' check (status in ('active','inactive','suspended')),
  timezone text not null default 'Asia/Taipei',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists branches (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  parent_branch_id text references branches(id),
  code text not null,
  name text not null,
  branch_type text not null default 'branch'
    check (branch_type in ('headquarters','branch','site','homecare_station','daycare_center')),
  phone text,
  address jsonb not null default '{}'::jsonb,
  geo_location jsonb not null default '{}'::jsonb,
  manager_id text,
  status text not null default 'active' check (status in ('active','inactive','closed')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, code)
);

create table if not exists departments (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  branch_id text references branches(id),
  parent_department_id text references departments(id),
  code text not null,
  name text not null,
  department_type text not null default 'administration'
    check (department_type in ('administration','hr','finance','homecare','daycare','operations','support')),
  manager_id text,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, code)
);

create table if not exists teams (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  branch_id text references branches(id),
  department_id text not null references departments(id) on delete cascade,
  code text not null,
  name text not null,
  team_type text not null default 'general'
    check (team_type in ('general','homecare_supervision','homecare_worker','daycare_shift','admin')),
  supervisor_id text,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, code)
);

create table if not exists module_users (
  id text primary key,
  auth_user_id uuid unique,
  employee_no text,
  name text not null,
  email text unique not null,
  entity_id text not null,
  company_id text references companies(id),
  primary_branch_id text references branches(id),
  primary_department_id text references departments(id),
  primary_team_id text references teams(id),
  department_code text not null,
  role hr_role not null default 'employee',
  role_label text,
  status text not null default 'active' check (status in ('active','on_leave','suspended','terminated')),
  hire_date date,
  termination_date date,
  manager_id text references module_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table module_users
  add column if not exists company_id text references companies(id),
  add column if not exists primary_branch_id text references branches(id),
  add column if not exists primary_department_id text references departments(id),
  add column if not exists primary_team_id text references teams(id);

alter table branches
  drop constraint if exists branches_manager_id_fkey,
  add constraint branches_manager_id_fkey foreign key (manager_id) references module_users(id);

alter table departments
  drop constraint if exists departments_manager_id_fkey,
  add constraint departments_manager_id_fkey foreign key (manager_id) references module_users(id);

alter table teams
  drop constraint if exists teams_supervisor_id_fkey,
  add constraint teams_supervisor_id_fkey foreign key (supervisor_id) references module_users(id);

create table if not exists employee_branch_assignments (
  id text primary key default gen_random_uuid()::text,
  employee_id text not null references module_users(id) on delete cascade,
  company_id text not null references companies(id) on delete cascade,
  branch_id text not null references branches(id) on delete cascade,
  department_id text references departments(id),
  team_id text references teams(id),
  assignment_type text not null default 'support'
    check (assignment_type in ('primary','support','temporary','training')),
  position_title text,
  effective_from date not null default current_date,
  effective_to date,
  weekly_hours numeric(6,2),
  is_active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create unique index if not exists idx_employee_primary_branch_assignment
on employee_branch_assignments(employee_id)
where assignment_type = 'primary' and is_active = true;

create index if not exists idx_branches_company_id on branches(company_id);
create index if not exists idx_departments_company_branch on departments(company_id, branch_id);
create index if not exists idx_teams_department_id on teams(department_id);
create index if not exists idx_employee_branch_assignments_employee on employee_branch_assignments(employee_id);
create index if not exists idx_employee_branch_assignments_branch on employee_branch_assignments(branch_id);

alter table module_users drop constraint if exists module_users_employee_no_key;
create unique index if not exists idx_module_users_company_employee_no
on module_users(company_id, employee_no)
where employee_no is not null;

create table if not exists hr_employee_profiles (
  employee_id text primary key references module_users(id),
  national_id_cipher text,
  birthday date,
  emergency_contact jsonb not null default '{}'::jsonb,
  address jsonb not null default '{}'::jsonb,
  job_title text,
  grade text,
  employment_type text not null default 'full_time',
  labor_insurance_salary numeric(12,2),
  health_insurance_salary numeric(12,2),
  pension_salary numeric(12,2),
  pension_employee_rate numeric(5,2) not null default 0,
  pension_employer_rate numeric(5,2) not null default 6,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists hr_work_schedules (
  id text primary key default gen_random_uuid()::text,
  employee_id text not null references module_users(id),
  work_date date not null,
  shift_code text,
  planned_start timestamptz,
  planned_end timestamptz,
  rest_minutes int not null default 60,
  is_regular_day boolean not null default true,
  is_rest_day boolean not null default false,
  is_holiday boolean not null default false,
  source_module text not null default 'hr',
  source_id text,
  created_at timestamptz not null default now(),
  unique(employee_id, work_date)
);

create table if not exists hr_attendance_records (
  id text primary key default gen_random_uuid()::text,
  employee_id text not null references module_users(id),
  work_date date not null,
  clock_in timestamptz,
  clock_out timestamptz,
  location_in jsonb,
  location_out jsonb,
  status text not null default 'normal',
  anomaly_code text,
  source text not null default 'web',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, work_date)
);

create table if not exists hr_leave_balances (
  id text primary key default gen_random_uuid()::text,
  employee_id text not null references module_users(id),
  leave_year int not null,
  leave_type text not null,
  entitlement_hours numeric(8,2) not null default 0,
  used_hours numeric(8,2) not null default 0,
  pending_hours numeric(8,2) not null default 0,
  expired_hours numeric(8,2) not null default 0,
  rule_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, leave_year, leave_type)
);

create table if not exists hr_requests (
  id text primary key,
  no text unique not null,
  request_type text not null,
  applicant_id text not null references module_users(id),
  entity_id text not null,
  department_code text not null,
  status text not null default 'draft',
  current_step int not null default 0,
  started_at timestamptz,
  ended_at timestamptz,
  total_hours numeric(8,2),
  payload jsonb not null default '{}'::jsonb,
  files jsonb not null default '[]'::jsonb,
  compliance_result jsonb not null default '{}'::jsonb,
  finance_handoff_status text not null default 'none',
  finance_reference_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists hr_approval_steps (
  id text primary key default gen_random_uuid()::text,
  request_id text not null references hr_requests(id) on delete cascade,
  step_no int not null,
  role_key text not null,
  approver_id text references module_users(id),
  status text not null default 'pending',
  action text,
  note text,
  acted_at timestamptz,
  created_at timestamptz not null default now(),
  unique(request_id, step_no)
);

create table if not exists hr_work_logs (
  id text primary key default gen_random_uuid()::text,
  employee_id text not null references module_users(id),
  work_date date not null,
  visibility text not null default 'manager',
  content text not null,
  manager_reply text,
  replied_by text references module_users(id),
  replied_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists hr_payroll_runs (
  id text primary key,
  payroll_month text not null,
  entity_id text not null,
  status text not null default 'draft',
  gross_pay numeric(14,2) not null default 0,
  overtime_pay numeric(14,2) not null default 0,
  employee_deductions numeric(14,2) not null default 0,
  employer_cost numeric(14,2) not null default 0,
  net_pay numeric(14,2) not null default 0,
  finance_voucher_id text,
  created_by text references module_users(id),
  approved_by text references module_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(payroll_month, entity_id)
);

create table if not exists hr_payroll_items (
  id text primary key default gen_random_uuid()::text,
  payroll_run_id text not null references hr_payroll_runs(id) on delete cascade,
  employee_id text not null references module_users(id),
  base_salary numeric(14,2) not null default 0,
  allowance jsonb not null default '{}'::jsonb,
  overtime_pay numeric(14,2) not null default 0,
  leave_deduction numeric(14,2) not null default 0,
  labor_insurance_fee numeric(14,2) not null default 0,
  health_insurance_fee numeric(14,2) not null default 0,
  pension_employee numeric(14,2) not null default 0,
  pension_employer numeric(14,2) not null default 0,
  tax_withholding numeric(14,2) not null default 0,
  net_pay numeric(14,2) not null default 0,
  payslip jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(payroll_run_id, employee_id)
);

create table if not exists hr_compliance_rules (
  id text primary key,
  rule_key text unique not null,
  law_name text not null,
  article_ref text,
  effective_from date not null,
  effective_to date,
  severity text not null default 'warning',
  rule_config jsonb not null default '{}'::jsonb,
  source_url text,
  created_at timestamptz not null default now()
);

create table if not exists module_audit_logs (
  id bigint generated by default as identity primary key,
  module text not null default 'hr',
  table_name text not null,
  row_id text,
  action text not null,
  actor_email text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create or replace function module_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_module_users_updated_at on module_users;
create trigger trg_module_users_updated_at before update on module_users
for each row execute function module_set_updated_at();

drop trigger if exists trg_companies_updated_at on companies;
create trigger trg_companies_updated_at before update on companies
for each row execute function module_set_updated_at();

drop trigger if exists trg_branches_updated_at on branches;
create trigger trg_branches_updated_at before update on branches
for each row execute function module_set_updated_at();

drop trigger if exists trg_departments_updated_at on departments;
create trigger trg_departments_updated_at before update on departments
for each row execute function module_set_updated_at();

drop trigger if exists trg_teams_updated_at on teams;
create trigger trg_teams_updated_at before update on teams
for each row execute function module_set_updated_at();

drop trigger if exists trg_employee_branch_assignments_updated_at on employee_branch_assignments;
create trigger trg_employee_branch_assignments_updated_at before update on employee_branch_assignments
for each row execute function module_set_updated_at();

drop trigger if exists trg_hr_employee_profiles_updated_at on hr_employee_profiles;
create trigger trg_hr_employee_profiles_updated_at before update on hr_employee_profiles
for each row execute function module_set_updated_at();

drop trigger if exists trg_hr_attendance_records_updated_at on hr_attendance_records;
create trigger trg_hr_attendance_records_updated_at before update on hr_attendance_records
for each row execute function module_set_updated_at();

drop trigger if exists trg_hr_requests_updated_at on hr_requests;
create trigger trg_hr_requests_updated_at before update on hr_requests
for each row execute function module_set_updated_at();

drop trigger if exists trg_hr_payroll_runs_updated_at on hr_payroll_runs;
create trigger trg_hr_payroll_runs_updated_at before update on hr_payroll_runs
for each row execute function module_set_updated_at();

insert into hr_compliance_rules(id, rule_key, law_name, article_ref, effective_from, severity, rule_config, source_url)
values
('rule-lsa-work-hours','work_hours_daily_weekly','勞動基準法','第30條、第32條、第36條','2026-01-01','block','{"daily_regular_hours":8,"weekly_regular_hours":40,"monthly_overtime_hours":46}'::jsonb,'https://laws.mol.gov.tw/FLAW/FLAWDAT0201.aspx?id=FL014930'),
('rule-lsa-special-leave','annual_leave_by_seniority','勞動基準法','第38條','2026-01-01','warning','{"requires_seniority_calculation":true}'::jsonb,'https://laws.mol.gov.tw/FLAW/FLAWDAT0201.aspx?id=FL014930'),
('rule-leave-regulation','ordinary_sick_personal_leave','勞工請假規則','全條文','2026-01-01','warning','{"requires_leave_type_limits":true}'::jsonb,'https://laws.mol.gov.tw/FLAW/FLAWDAT0201.aspx?id=FL014949'),
('rule-gender-equality','maternity_parental_family_leave','性別平等工作法','全條文','2026-01-01','block','{"supports_maternity_paternity_parental_family_leave":true}'::jsonb,'https://laws.mol.gov.tw/FLAW/FLAWDAT0201.aspx?id=FL015149'),
('rule-pension-6pct','labor_pension_employer_rate','勞工退休金條例','第14條','2026-01-01','block','{"employer_min_rate":6}'::jsonb,'https://laws.mol.gov.tw/FLAW/FLAWDAT0201.aspx?id=FL030634')
on conflict (id) do nothing;
