-- HRIS/HRM Supabase PostgreSQL schema live deployment build.
-- Generated from hris_schema_v1.sql with table order fixed for forward references.

-- HRIS/HRM Supabase PostgreSQL schema v1.
-- This file uses public tables designed for Supabase Auth + RLS.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  legal_name text,
  tax_id text unique,
  industry text not null default 'long_term_care',
  phone text,
  email text,
  address jsonb not null default '{}'::jsonb,
  timezone text not null default 'Asia/Taipei',
  status text not null default 'active' check (status in ('active','inactive','suspended')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  parent_branch_id uuid references public.branches(id),
  code text not null,
  name text not null,
  branch_type text not null default 'branch'
    check (branch_type in ('headquarters','branch','site','homecare_station','daycare_center')),
  phone text,
  email text,
  address jsonb not null default '{}'::jsonb,
  geo_location jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','inactive','closed')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(company_id, code)
);

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  branch_id uuid references public.branches(id),
  parent_department_id uuid references public.departments(id),
  code text not null,
  name text not null,
  department_type text not null default 'administration'
    check (department_type in ('administration','hr','finance','homecare','daycare','operations','support')),
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(company_id, code)
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  branch_id uuid references public.branches(id),
  department_id uuid not null references public.departments(id),
  code text not null,
  name text not null,
  team_type text not null default 'general'
    check (team_type in ('general','homecare_supervision','homecare_worker','daycare_shift','admin')),
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(company_id, code)
);

create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  department_id uuid references public.departments(id),
  code text not null,
  title text not null,
  level text,
  employment_type text not null default 'full_time'
    check (employment_type in ('full_time','part_time','contract','intern','temporary')),
  is_manager boolean not null default false,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(company_id, code)
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  key text not null,
  name text not null,
  description text,
  permissions jsonb not null default '[]'::jsonb,
  data_scope text not null default 'self'
    check (data_scope in ('all_companies','company','branch','department','team','self')),
  is_system_role boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(company_id, key)
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  primary_branch_id uuid references public.branches(id),
  primary_department_id uuid references public.departments(id),
  primary_team_id uuid references public.teams(id),
  position_id uuid references public.positions(id),
  manager_employee_id uuid references public.employees(id),
  employee_no text not null,
  full_name text not null,
  preferred_name text,
  national_id_cipher text,
  birthday date,
  gender text check (gender in ('female','male','non_binary','not_disclosed')),
  phone text,
  email text,
  address jsonb not null default '{}'::jsonb,
  emergency_contact jsonb not null default '{}'::jsonb,
  hire_date date,
  termination_date date,
  employment_status text not null default 'active'
    check (employment_status in ('active','on_leave','suspended','terminated')),
  labor_insurance_salary numeric(12,2),
  health_insurance_salary numeric(12,2),
  pension_salary numeric(12,2),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(company_id, employee_no)
);

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  company_id uuid references public.companies(id),
  employee_id uuid references public.employees(id),
  role_id uuid references public.roles(id),
  email text not null unique,
  display_name text not null,
  avatar_url text,
  status text not null default 'active' check (status in ('active','invited','disabled')),
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.employee_branch_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  employee_id uuid not null references public.employees(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  department_id uuid references public.departments(id),
  team_id uuid references public.teams(id),
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
  deleted_at timestamptz,
  check (effective_to is null or effective_to >= effective_from)
);

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

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  title text not null,
  category text not null default 'company'
    check (category in ('company','system','hr','schedule','payroll','training')),
  content text not null,
  summary text,
  is_pinned boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft','published','expired','archived')),
  published_at timestamptz,
  expires_at timestamptz,
  attachment_document_ids jsonb not null default '[]'::jsonb,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.announcement_targets (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  branch_id uuid references public.branches(id),
  department_id uuid references public.departments(id),
  role_id uuid references public.roles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.announcement_reads (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  user_id uuid references public.users(id),
  read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(announcement_id, employee_id)
);

create table if not exists public.hr_requests (
  id text primary key,
  no text not null,
  request_type text not null,
  applicant_id uuid not null references public.users(id) on delete cascade,
  entity_id text not null default 'hr',
  department_code text,
  status text not null default '草稿'
    check (status in ('草稿','待我簽核','簽核中','已核准','已駁回','已取消','被退回')),
  current_step text not null default '草稿',
  current_owner_role text not null default 'applicant',
  reason text,
  payload jsonb not null default '{}'::jsonb,
  files text[] not null default '{}'::text[],
  timeline jsonb not null default '[]'::jsonb,
  audit_logs text[] not null default '{}'::text[],
  submitted_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.hr_approval_events (
  id uuid primary key default gen_random_uuid(),
  request_id text not null references public.hr_requests(id) on delete cascade,
  actor_user_id uuid not null references public.users(id),
  actor_role text not null,
  actor_name text not null,
  action text not null
    check (action in ('submit','approve','return','reject','cancel','resubmit','delegate','comment')),
  step_name text not null,
  decision_reason text not null,
  decision_snapshot jsonb not null default '{}'::jsonb,
  before_status text,
  after_status text,
  before_owner_role text,
  after_owner_role text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  branch_id uuid references public.branches(id),
  code text not null,
  name text not null,
  start_time time not null,
  end_time time not null,
  break_minutes int not null default 60,
  crosses_midnight boolean not null default false,
  is_active boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(company_id, code)
);

create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  branch_id uuid references public.branches(id),
  department_id uuid references public.departments(id),
  team_id uuid references public.teams(id),
  employee_id uuid not null references public.employees(id),
  shift_id uuid references public.shifts(id),
  work_date date not null,
  planned_start timestamptz,
  planned_end timestamptz,
  schedule_type text not null default 'regular'
    check (schedule_type in ('regular','support','temporary','training','leave','holiday')),
  source_module text not null default 'hr',
  source_reference_id text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(employee_id, work_date)
);

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

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  branch_id uuid references public.branches(id),
  employee_id uuid not null references public.employees(id),
  schedule_id uuid references public.schedules(id),
  work_date date not null,
  clock_in_at timestamptz,
  clock_out_at timestamptz,
  clock_in_location jsonb,
  clock_out_location jsonb,
  source text not null default 'web' check (source in ('web','mobile','device','import','system')),
  status text not null default 'normal'
    check (status in ('normal','late','early_leave','absent','missing_punch','overtime','exception')),
  anomaly_code text,
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(employee_id, work_date)
);

create table if not exists public.approval_flows (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null,
  request_type text not null
    check (request_type in ('leave','overtime','punch_correction','document','license','training','payroll','general')),
  applies_to jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(company_id, request_type, name)
);

create table if not exists public.approval_steps (
  id uuid primary key default gen_random_uuid(),
  approval_flow_id uuid not null references public.approval_flows(id) on delete cascade,
  step_order int not null,
  step_name text not null,
  approver_role_id uuid references public.roles(id),
  approver_employee_id uuid references public.employees(id),
  approver_policy text not null default 'direct_manager'
    check (approver_policy in ('direct_manager','department_manager','branch_manager','role','employee','hr','accounting')),
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(approval_flow_id, step_order)
);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  employee_id uuid not null references public.employees(id),
  approval_flow_id uuid references public.approval_flows(id),
  leave_type text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  total_hours numeric(8,2) not null default 0,
  reason text,
  attachment_ids jsonb not null default '[]'::jsonb,
  status text not null default 'draft'
    check (status in ('draft','pending','approved','rejected','cancelled')),
  submitted_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (ends_at > starts_at)
);

create table if not exists public.overtime_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  employee_id uuid not null references public.employees(id),
  approval_flow_id uuid references public.approval_flows(id),
  work_date date not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  total_hours numeric(8,2) not null default 0,
  overtime_type text not null default 'weekday'
    check (overtime_type in ('weekday','rest_day','holiday','regular_holiday')),
  compensation_type text not null default 'overtime_pay'
    check (compensation_type in ('overtime_pay','compensatory_leave')),
  attachment_ids jsonb not null default '[]'::jsonb,
  workflow_stage text not null default 'applicant_submitted'
    check (workflow_stage in ('draft','applicant_submitted','direct_manager','department_manager','admin_director','hr_confirm','completed','rejected','cancelled')),
  review_note text,
  reason text,
  status text not null default 'draft'
    check (status in ('draft','pending','approved','rejected','cancelled')),
  submitted_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (ends_at > starts_at)
);

create table if not exists public.punch_correction_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  employee_id uuid not null references public.employees(id),
  attendance_record_id uuid references public.attendance_records(id),
  approval_flow_id uuid references public.approval_flows(id),
  work_date date not null,
  correction_type text not null check (correction_type in ('clock_in','clock_out','both')),
  requested_clock_in_at timestamptz,
  requested_clock_out_at timestamptz,
  reason text not null,
  status text not null default 'draft'
    check (status in ('draft','pending','approved','rejected','cancelled')),
  submitted_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.payroll_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  branch_id uuid references public.branches(id),
  payroll_month date not null,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft'
    check (status in ('draft','calculating','reviewing','approved','paid','void')),
  gross_pay_total numeric(14,2) not null default 0,
  deduction_total numeric(14,2) not null default 0,
  employer_cost_total numeric(14,2) not null default 0,
  net_pay_total numeric(14,2) not null default 0,
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  finance_reference_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(company_id, branch_id, payroll_month)
);

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

create table if not exists public.payroll_payslips (
  id uuid primary key default gen_random_uuid(),
  payroll_record_id uuid not null references public.payroll_records(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  branch_id uuid references public.branches(id),
  employee_id uuid not null references public.employees(id),
  payroll_month date not null,
  payment_date date,
  bank_account_last_five text not null check (bank_account_last_five ~ '^[0-9]{5}$'),
  gross_pay_total numeric(14,2) not null default 0,
  deduction_total numeric(14,2) not null default 0,
  employer_cost_total numeric(14,2) not null default 0,
  net_pay_total numeric(14,2) not null default 0,
  remark text,
  status text not null default 'draft'
    check (status in ('draft','reviewing','released','void')),
  released_at timestamptz,
  released_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(employee_id, payroll_month)
);

create table if not exists public.payroll_items (
  id uuid primary key default gen_random_uuid(),
  payroll_record_id uuid not null references public.payroll_records(id) on delete cascade,
  payroll_payslip_id uuid references public.payroll_payslips(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  item_type text not null
    check (item_type in ('earning','deduction','employer_cost','tax','memo')),
  item_code text not null,
  item_name text not null,
  quantity numeric(12,2),
  unit_amount numeric(14,2),
  amount numeric(14,2) not null default 0,
  taxable boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.payroll_item_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  category text not null
    check (category in ('fixed_earning','variable_earning','fixed_deduction','variable_deduction','employer_cost','employee_contribution')),
  calculation_basis text not null
    check (calculation_basis in ('fixed_amount','attendance','overtime','rate_table','percentage','manual')),
  default_amount numeric(14,2) not null default 0,
  taxable boolean not null default true,
  include_in_insurance_wage boolean not null default false,
  is_active boolean not null default true,
  legal_basis text,
  description text,
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(company_id, code)
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  employee_id uuid references public.employees(id),
  uploaded_by uuid references public.users(id),
  document_type text not null
    check (document_type in ('employment_certificate','salary_certificate','labor_health_certificate','contract','id_document','attachment','other')),
  title text not null,
  storage_bucket text not null default 'hr-documents',
  storage_path text not null,
  mime_type text,
  file_size bigint,
  issued_at date,
  expires_at date,
  status text not null default 'active' check (status in ('active','expired','revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.licenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  employee_id uuid not null references public.employees(id),
  document_id uuid references public.documents(id),
  license_type text not null
    check (license_type in (
      'care_worker_certificate',
      'long_term_care_card',
      'cpr_certificate',
      'dementia_training_certificate',
      'disability_support_training',
      'nurse_license',
      'social_worker_license',
      'driver_license',
      'other_professional_license'
    )),
  license_name text not null,
  license_no text,
  issuing_authority text,
  issued_at date,
  expires_at date,
  reminder_days int not null default 30,
  attachment_status text not null default 'missing'
    check (attachment_status in ('missing','uploaded','verified','rejected')),
  verified_by uuid references public.users(id),
  verified_at timestamptz,
  status text not null default 'active'
    check (status in ('active','expiring','expired','pending_review','missing_attachment','revoked')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.training_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  employee_id uuid not null references public.employees(id),
  branch_id uuid references public.branches(id),
  department_id uuid references public.departments(id),
  course_code text,
  course_name text not null,
  provider text,
  instructor text,
  training_type text not null default 'internal'
    check (training_type in ('orientation','long_term_care_professional','compliance_required','license_refresh','infection_control','online','external','internal','license')),
  started_at timestamptz,
  completed_at timestamptz,
  class_date date,
  hours numeric(8,2) not null default 0,
  attendees jsonb not null default '[]'::jsonb,
  attendance_status text not null default 'not_signed'
    check (attendance_status in ('signed','not_signed','makeup_signed')),
  score numeric(8,2),
  certificate_document_id uuid references public.documents(id),
  status text not null default 'planned'
    check (status in ('planned','in_progress','completed','failed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.employee_retention_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  branch_id uuid references public.branches(id),
  department_id uuid references public.departments(id),
  employee_id uuid not null references public.employees(id) on delete cascade,
  milestone text not null
    check (milestone in ('under_7_days','under_30_days','under_90_days','under_180_days','leaving_soon','terminated')),
  risk_level text not null default 'low'
    check (risk_level in ('low','medium','high')),
  risk_score int not null default 0 check (risk_score between 0 and 100),
  care_status text not null default 'not_started'
    check (care_status in ('not_started','scheduled','completed','follow_up_required')),
  retention_bonus_status text not null default 'observing'
    check (retention_bonus_status in ('eligible','observing','not_eligible')),
  retention_bonus_rule text,
  termination_reason text,
  expected_termination_date date,
  status text not null default 'active'
    check (status in ('active','watching','retained','leaving','terminated')),
  next_care_date date,
  owner_user_id uuid references public.users(id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.employee_care_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  retention_record_id uuid references public.employee_retention_records(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  care_type text not null default 'supervisor_check_in'
    check (care_type in ('new_hire_check_in','supervisor_check_in','hr_interview','retention_interview','exit_interview','follow_up')),
  care_date date not null default current_date,
  care_by uuid references public.users(id),
  summary text not null,
  action_items jsonb not null default '[]'::jsonb,
  next_follow_up_date date,
  attachment_document_id uuid references public.documents(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.assessment_export_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  branch_id uuid references public.branches(id),
  date_start date not null,
  date_end date not null,
  export_types jsonb not null default '[]'::jsonb,
  file_count int not null default 0,
  record_count int not null default 0,
  package_name text not null,
  storage_path text,
  status text not null default 'pending'
    check (status in ('pending','processing','completed','failed','cancelled')),
  requested_by uuid references public.users(id),
  completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (date_end >= date_start)
);

create table if not exists public.report_export_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  report_key text not null,
  report_name text not null,
  filters jsonb not null default '{}'::jsonb,
  sort_by text,
  format text not null default 'excel' check (format in ('excel','csv','pdf')),
  record_count int not null default 0,
  storage_path text,
  status text not null default 'pending'
    check (status in ('pending','processing','completed','failed','cancelled')),
  requested_by uuid references public.users(id),
  completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.excel_import_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  import_type text not null
    check (import_type in ('employees','departments','shifts','monthly_schedules','payroll_items','licenses','training_records')),
  template_name text not null,
  source_file_name text,
  source_file_path text,
  target_table text not null,
  required_fields jsonb not null default '[]'::jsonb,
  field_check_result jsonb not null default '{}'::jsonb,
  error_rows jsonb not null default '[]'::jsonb,
  preview_rows jsonb not null default '[]'::jsonb,
  row_count int not null default 0,
  error_count int not null default 0,
  status text not null default 'template_ready'
    check (status in ('template_ready','uploaded','validated','has_errors','previewed','confirmed','imported','failed','cancelled')),
  confirmed_by uuid references public.users(id),
  confirmed_at timestamptz,
  imported_at timestamptz,
  created_by uuid references public.users(id),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.system_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  setting_key text not null,
  category text not null
    check (category in ('company_profile','branch_profile','department_profile','role_permissions','punch_rules','shift_rules','leave_rules','overtime_rules','payroll_rules','insurance_grades','approval_flows','notification_settings','report_formats','system_parameters')),
  display_name text not null,
  description text,
  settings jsonb not null default '{}'::jsonb,
  validation_schema jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft','active','needs_review','archived')),
  version int not null default 1,
  effective_from date,
  effective_to date,
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(company_id, setting_key)
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  actor_user_id uuid references public.users(id),
  actor_employee_id uuid references public.employees(id),
  action text not null,
  resource_type text not null,
  resource_id text,
  request_id text,
  ip_address inet,
  user_agent text,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.login_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  user_id uuid references public.users(id),
  employee_id uuid references public.employees(id),
  email text,
  login_at timestamptz not null default now(),
  ip_address inet,
  user_agent text,
  auth_provider text,
  success boolean not null default false,
  failure_reason text,
  session_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.error_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  user_id uuid references public.users(id),
  employee_id uuid references public.employees(id),
  severity text not null default 'error'
    check (severity in ('debug','info','warning','error','critical')),
  source text not null default 'server'
    check (source in ('client','server','api','database','integration','cron')),
  message text not null,
  stack_trace text,
  request_id text,
  route text,
  ip_address inet,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_users_auth_user_id on public.users(auth_user_id);
create index if not exists idx_users_company_id on public.users(company_id);
create index if not exists idx_announcements_company_status on public.announcements(company_id, status);
create index if not exists idx_announcements_pinned_expires on public.announcements(is_pinned, expires_at);
create index if not exists idx_announcement_targets_announcement on public.announcement_targets(announcement_id);
create index if not exists idx_announcement_targets_scope on public.announcement_targets(company_id, branch_id, department_id, role_id);
create index if not exists idx_announcement_reads_employee on public.announcement_reads(employee_id, announcement_id);
create index if not exists idx_hr_requests_applicant_status on public.hr_requests(applicant_id, status, created_at desc);
create index if not exists idx_hr_requests_owner_status on public.hr_requests(current_owner_role, status, created_at desc);
create index if not exists idx_hr_requests_type_status on public.hr_requests(request_type, status);
create index if not exists idx_hr_approval_events_request_created on public.hr_approval_events(request_id, created_at);
create index if not exists idx_hr_approval_events_actor_created on public.hr_approval_events(actor_user_id, created_at desc);
create index if not exists idx_hr_approval_events_action on public.hr_approval_events(action, created_at desc);
create index if not exists idx_employees_company_id on public.employees(company_id);
create index if not exists idx_employees_primary_branch_id on public.employees(primary_branch_id);
create index if not exists idx_branches_company_id on public.branches(company_id);
create index if not exists idx_departments_company_branch on public.departments(company_id, branch_id);
create index if not exists idx_teams_company_department on public.teams(company_id, department_id);
create index if not exists idx_positions_company_department on public.positions(company_id, department_id);
create index if not exists idx_employee_branch_assignments_employee on public.employee_branch_assignments(employee_id);
create index if not exists idx_employee_branch_assignments_branch on public.employee_branch_assignments(branch_id);
create unique index if not exists idx_employee_branch_assignments_primary_active
on public.employee_branch_assignments(employee_id)
where assignment_type = 'primary' and is_active = true and deleted_at is null;
create index if not exists idx_employee_change_logs_employee_effective
on public.employee_change_logs(employee_id, effective_date desc);
create index if not exists idx_employee_change_logs_company_type
on public.employee_change_logs(company_id, change_type, effective_date desc);
create index if not exists idx_employee_retention_employee_status on public.employee_retention_records(employee_id, status);
create index if not exists idx_employee_retention_company_risk on public.employee_retention_records(company_id, risk_level);
create index if not exists idx_employee_care_logs_employee_date on public.employee_care_logs(employee_id, care_date);
create index if not exists idx_schedules_employee_work_date on public.schedules(employee_id, work_date);
create index if not exists idx_shift_change_requests_company_status
on public.shift_change_requests(company_id, status, created_at desc);
create index if not exists idx_shift_change_requests_applicant
on public.shift_change_requests(applicant_employee_id, created_at desc);
create index if not exists idx_shift_change_requests_counterpart
on public.shift_change_requests(counterpart_employee_id, created_at desc);
create index if not exists idx_attendance_employee_work_date on public.attendance_records(employee_id, work_date);
create index if not exists idx_leave_requests_employee_status on public.leave_requests(employee_id, status);
create index if not exists idx_overtime_requests_employee_status on public.overtime_requests(employee_id, status);
create index if not exists idx_punch_correction_employee_status on public.punch_correction_requests(employee_id, status);
create index if not exists idx_payroll_records_company_month on public.payroll_records(company_id, payroll_month);
create index if not exists idx_employee_payroll_settings_company on public.employee_payroll_settings(company_id, status, deleted_at);
create index if not exists idx_employee_payroll_settings_employee on public.employee_payroll_settings(employee_id);
create index if not exists idx_payroll_payslips_employee_month on public.payroll_payslips(employee_id, payroll_month);
create index if not exists idx_payroll_payslips_company_status on public.payroll_payslips(company_id, status);
create index if not exists idx_payroll_items_employee_id on public.payroll_items(employee_id);
create index if not exists idx_payroll_items_payslip_id on public.payroll_items(payroll_payslip_id);
create index if not exists idx_payroll_item_settings_company on public.payroll_item_settings(company_id, is_active, deleted_at);
create index if not exists idx_payroll_item_settings_category on public.payroll_item_settings(company_id, category);
create index if not exists idx_documents_employee_id on public.documents(employee_id);
create index if not exists idx_licenses_employee_expires_at on public.licenses(employee_id, expires_at);
create index if not exists idx_training_records_employee_id on public.training_records(employee_id);
create index if not exists idx_training_records_employee_class_date on public.training_records(employee_id, class_date);
create index if not exists idx_training_records_company_type on public.training_records(company_id, training_type);
create index if not exists idx_assessment_export_batches_company_date on public.assessment_export_batches(company_id, date_start, date_end);
create index if not exists idx_assessment_export_batches_branch_status on public.assessment_export_batches(branch_id, status);
create index if not exists idx_report_export_batches_company_report on public.report_export_batches(company_id, report_key);
create index if not exists idx_report_export_batches_status on public.report_export_batches(status, created_at);
create index if not exists idx_excel_import_batches_company_type on public.excel_import_batches(company_id, import_type);
create index if not exists idx_excel_import_batches_status on public.excel_import_batches(status, created_at);
create index if not exists idx_system_settings_company_category on public.system_settings(company_id, category);
create index if not exists idx_system_settings_status on public.system_settings(status, updated_at);
create index if not exists idx_audit_logs_company_resource on public.audit_logs(company_id, resource_type, resource_id);
create index if not exists idx_audit_logs_actor_created on public.audit_logs(actor_user_id, created_at);
create index if not exists idx_login_logs_user_created on public.login_logs(user_id, login_at);
create index if not exists idx_login_logs_company_success on public.login_logs(company_id, success, login_at);
create index if not exists idx_error_logs_company_severity on public.error_logs(company_id, severity, created_at);

drop trigger if exists trg_companies_updated_at on public.companies;
create trigger trg_companies_updated_at before update on public.companies
for each row execute function public.set_updated_at();

drop trigger if exists trg_branches_updated_at on public.branches;
create trigger trg_branches_updated_at before update on public.branches
for each row execute function public.set_updated_at();

drop trigger if exists trg_departments_updated_at on public.departments;
create trigger trg_departments_updated_at before update on public.departments
for each row execute function public.set_updated_at();

drop trigger if exists trg_positions_updated_at on public.positions;
create trigger trg_positions_updated_at before update on public.positions
for each row execute function public.set_updated_at();

drop trigger if exists trg_teams_updated_at on public.teams;
create trigger trg_teams_updated_at before update on public.teams
for each row execute function public.set_updated_at();

drop trigger if exists trg_roles_updated_at on public.roles;
create trigger trg_roles_updated_at before update on public.roles
for each row execute function public.set_updated_at();

drop trigger if exists trg_employees_updated_at on public.employees;
create trigger trg_employees_updated_at before update on public.employees
for each row execute function public.set_updated_at();

drop trigger if exists trg_users_updated_at on public.users;
create trigger trg_users_updated_at before update on public.users
for each row execute function public.set_updated_at();

drop trigger if exists trg_announcements_updated_at on public.announcements;
create trigger trg_announcements_updated_at before update on public.announcements
for each row execute function public.set_updated_at();

drop trigger if exists trg_announcement_targets_updated_at on public.announcement_targets;
create trigger trg_announcement_targets_updated_at before update on public.announcement_targets
for each row execute function public.set_updated_at();

drop trigger if exists trg_announcement_reads_updated_at on public.announcement_reads;
create trigger trg_announcement_reads_updated_at before update on public.announcement_reads
for each row execute function public.set_updated_at();

drop trigger if exists trg_hr_requests_updated_at on public.hr_requests;
create trigger trg_hr_requests_updated_at before update on public.hr_requests
for each row execute function public.set_updated_at();

drop trigger if exists trg_employee_branch_assignments_updated_at on public.employee_branch_assignments;
create trigger trg_employee_branch_assignments_updated_at before update on public.employee_branch_assignments
for each row execute function public.set_updated_at();

drop trigger if exists trg_employee_change_logs_updated_at on public.employee_change_logs;
create trigger trg_employee_change_logs_updated_at before update on public.employee_change_logs
for each row execute function public.set_updated_at();

drop trigger if exists trg_employee_retention_records_updated_at on public.employee_retention_records;
create trigger trg_employee_retention_records_updated_at before update on public.employee_retention_records
for each row execute function public.set_updated_at();

drop trigger if exists trg_employee_care_logs_updated_at on public.employee_care_logs;
create trigger trg_employee_care_logs_updated_at before update on public.employee_care_logs
for each row execute function public.set_updated_at();

drop trigger if exists trg_shifts_updated_at on public.shifts;
create trigger trg_shifts_updated_at before update on public.shifts
for each row execute function public.set_updated_at();

drop trigger if exists trg_schedules_updated_at on public.schedules;
create trigger trg_schedules_updated_at before update on public.schedules
for each row execute function public.set_updated_at();

drop trigger if exists trg_shift_change_requests_updated_at on public.shift_change_requests;
create trigger trg_shift_change_requests_updated_at before update on public.shift_change_requests
for each row execute function public.set_updated_at();

drop trigger if exists trg_attendance_records_updated_at on public.attendance_records;
create trigger trg_attendance_records_updated_at before update on public.attendance_records
for each row execute function public.set_updated_at();

drop trigger if exists trg_approval_flows_updated_at on public.approval_flows;
create trigger trg_approval_flows_updated_at before update on public.approval_flows
for each row execute function public.set_updated_at();

drop trigger if exists trg_approval_steps_updated_at on public.approval_steps;
create trigger trg_approval_steps_updated_at before update on public.approval_steps
for each row execute function public.set_updated_at();

drop trigger if exists trg_leave_requests_updated_at on public.leave_requests;
create trigger trg_leave_requests_updated_at before update on public.leave_requests
for each row execute function public.set_updated_at();

drop trigger if exists trg_overtime_requests_updated_at on public.overtime_requests;
create trigger trg_overtime_requests_updated_at before update on public.overtime_requests
for each row execute function public.set_updated_at();

drop trigger if exists trg_punch_correction_requests_updated_at on public.punch_correction_requests;
create trigger trg_punch_correction_requests_updated_at before update on public.punch_correction_requests
for each row execute function public.set_updated_at();

drop trigger if exists trg_payroll_records_updated_at on public.payroll_records;
create trigger trg_payroll_records_updated_at before update on public.payroll_records
for each row execute function public.set_updated_at();

drop trigger if exists trg_employee_payroll_settings_updated_at on public.employee_payroll_settings;
create trigger trg_employee_payroll_settings_updated_at before update on public.employee_payroll_settings
for each row execute function public.set_updated_at();

drop trigger if exists trg_payroll_payslips_updated_at on public.payroll_payslips;
create trigger trg_payroll_payslips_updated_at before update on public.payroll_payslips
for each row execute function public.set_updated_at();

drop trigger if exists trg_payroll_items_updated_at on public.payroll_items;
create trigger trg_payroll_items_updated_at before update on public.payroll_items
for each row execute function public.set_updated_at();

drop trigger if exists trg_payroll_item_settings_updated_at on public.payroll_item_settings;
create trigger trg_payroll_item_settings_updated_at before update on public.payroll_item_settings
for each row execute function public.set_updated_at();

drop trigger if exists trg_documents_updated_at on public.documents;
create trigger trg_documents_updated_at before update on public.documents
for each row execute function public.set_updated_at();

drop trigger if exists trg_licenses_updated_at on public.licenses;
create trigger trg_licenses_updated_at before update on public.licenses
for each row execute function public.set_updated_at();

drop trigger if exists trg_training_records_updated_at on public.training_records;
create trigger trg_training_records_updated_at before update on public.training_records
for each row execute function public.set_updated_at();

drop trigger if exists trg_assessment_export_batches_updated_at on public.assessment_export_batches;
create trigger trg_assessment_export_batches_updated_at before update on public.assessment_export_batches
for each row execute function public.set_updated_at();

drop trigger if exists trg_report_export_batches_updated_at on public.report_export_batches;
create trigger trg_report_export_batches_updated_at before update on public.report_export_batches
for each row execute function public.set_updated_at();

drop trigger if exists trg_excel_import_batches_updated_at on public.excel_import_batches;
create trigger trg_excel_import_batches_updated_at before update on public.excel_import_batches
for each row execute function public.set_updated_at();

drop trigger if exists trg_system_settings_updated_at on public.system_settings;
create trigger trg_system_settings_updated_at before update on public.system_settings
for each row execute function public.set_updated_at();

drop trigger if exists trg_audit_logs_updated_at on public.audit_logs;
create trigger trg_audit_logs_updated_at before update on public.audit_logs
for each row execute function public.set_updated_at();

drop trigger if exists trg_login_logs_updated_at on public.login_logs;
create trigger trg_login_logs_updated_at before update on public.login_logs
for each row execute function public.set_updated_at();

drop trigger if exists trg_error_logs_updated_at on public.error_logs;
create trigger trg_error_logs_updated_at before update on public.error_logs
for each row execute function public.set_updated_at();

alter table public.users enable row level security;
alter table public.employees enable row level security;
alter table public.companies enable row level security;
alter table public.announcements enable row level security;
alter table public.announcement_targets enable row level security;
alter table public.announcement_reads enable row level security;
alter table public.hr_requests enable row level security;
alter table public.hr_approval_events enable row level security;
alter table public.branches enable row level security;
alter table public.departments enable row level security;
alter table public.teams enable row level security;
alter table public.positions enable row level security;
alter table public.roles enable row level security;
alter table public.employee_branch_assignments enable row level security;
alter table public.employee_change_logs enable row level security;
alter table public.employee_retention_records enable row level security;
alter table public.employee_care_logs enable row level security;
alter table public.attendance_records enable row level security;
alter table public.shifts enable row level security;
alter table public.schedules enable row level security;
alter table public.shift_change_requests enable row level security;
alter table public.leave_requests enable row level security;
alter table public.overtime_requests enable row level security;
alter table public.punch_correction_requests enable row level security;
alter table public.payroll_records enable row level security;
alter table public.employee_payroll_settings enable row level security;
alter table public.payroll_payslips enable row level security;
alter table public.payroll_items enable row level security;
alter table public.payroll_item_settings enable row level security;
alter table public.approval_flows enable row level security;
alter table public.approval_steps enable row level security;
alter table public.documents enable row level security;
alter table public.licenses enable row level security;
alter table public.training_records enable row level security;
alter table public.assessment_export_batches enable row level security;
alter table public.report_export_batches enable row level security;
alter table public.excel_import_batches enable row level security;
alter table public.system_settings enable row level security;
alter table public.audit_logs enable row level security;
alter table public.login_logs enable row level security;
alter table public.error_logs enable row level security;

create or replace function public.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select employee_id
  from public.users
  where auth_user_id = auth.uid()
    and deleted_at is null
    and status = 'active'
  limit 1
$$;

create or replace function public.current_role_key()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select roles.key
  from public.users
  join public.roles on roles.id = users.role_id
  where users.auth_user_id = auth.uid()
    and users.deleted_at is null
    and users.status = 'active'
  limit 1
$$;

create or replace function public.can_manage_payroll()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_role_key() in ('super_admin','company_admin','hr_manager','hr_staff','accountant','hr','admin_director','ceo'),
    false
  )
$$;

create or replace function public.can_manage_licenses()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_role_key() in ('super_admin','company_admin','hr_manager','hr_staff','department_manager','homecare_supervisor'),
    false
  )
$$;

create or replace function public.can_manage_training()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_role_key() in ('super_admin','company_admin','hr_manager','hr_staff','department_manager','homecare_supervisor','daycare_staff'),
    false
  )
$$;

create or replace function public.can_manage_assessment_exports()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_role_key() in ('super_admin','company_admin','hr_manager','hr_staff','department_manager','homecare_supervisor','daycare_staff'),
    false
  )
$$;

create or replace function public.can_manage_retention()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_role_key() in ('super_admin','company_admin','hr_manager','hr_staff','department_manager','homecare_supervisor','daycare_staff'),
    false
  )
$$;

create or replace function public.can_manage_announcements()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_role_key() in ('super_admin','company_admin','hr_manager','hr_staff'),
    false
  )
$$;

create or replace function public.can_view_analytics()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_role_key() in ('super_admin','company_admin','hr_manager','hr_staff','accountant','department_manager','homecare_supervisor','daycare_staff'),
    false
  )
$$;

create or replace function public.can_manage_excel_imports()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_role_key() in ('super_admin','company_admin','hr_manager','hr_staff','accountant'),
    false
  )
$$;

create or replace function public.can_manage_system_settings()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_role_key() in ('super_admin','company_admin','hr_manager'),
    false
  )
$$;

create or replace function public.can_manage_employee_data()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_role_key() in ('super_admin','company_admin','hr_manager','hr_staff'),
    false
  )
$$;

create or replace function public.can_view_security_logs()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_role_key() in ('super_admin','company_admin','hr_manager'),
    false
  )
$$;

revoke all on function public.current_employee_id() from public;
revoke all on function public.current_role_key() from public;
revoke all on function public.can_manage_payroll() from public;
revoke all on function public.can_manage_licenses() from public;
revoke all on function public.can_manage_training() from public;
revoke all on function public.can_manage_assessment_exports() from public;
revoke all on function public.can_manage_retention() from public;
revoke all on function public.can_manage_announcements() from public;
revoke all on function public.can_view_analytics() from public;
revoke all on function public.can_manage_excel_imports() from public;
revoke all on function public.can_manage_system_settings() from public;
revoke all on function public.can_manage_employee_data() from public;
revoke all on function public.can_view_security_logs() from public;
grant execute on function public.current_employee_id() to authenticated;
grant execute on function public.current_role_key() to authenticated;
grant execute on function public.can_manage_payroll() to authenticated;
grant execute on function public.can_manage_licenses() to authenticated;
grant execute on function public.can_manage_training() to authenticated;
grant execute on function public.can_manage_assessment_exports() to authenticated;
grant execute on function public.can_manage_retention() to authenticated;
grant execute on function public.can_manage_announcements() to authenticated;
grant execute on function public.can_view_analytics() to authenticated;
grant execute on function public.can_manage_excel_imports() to authenticated;
grant execute on function public.can_manage_system_settings() to authenticated;
grant execute on function public.can_manage_employee_data() to authenticated;
grant execute on function public.can_view_security_logs() to authenticated;

drop policy if exists "employees can view own employee profile" on public.employees;
create policy "employees can view own employee profile"
on public.employees for select
to authenticated
using (
  auth.uid() is not null
  and deleted_at is null
  and id = public.current_employee_id()
);

drop policy if exists "employee data managers can manage company employees" on public.employees;
create policy "employee data managers can manage company employees"
on public.employees for all
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

drop policy if exists "users can view own user record" on public.users;
create policy "users can view own user record"
on public.users for select
to authenticated
using (
  auth.uid() is not null
  and deleted_at is null
  and auth_user_id = auth.uid()
);

drop policy if exists "user managers can manage company users" on public.users;
create policy "user managers can manage company users"
on public.users for all
to authenticated
using (
  public.can_manage_employee_data()
  and company_id = (
    select scoped_users.company_id
    from public.users scoped_users
    where scoped_users.auth_user_id = auth.uid()
      and scoped_users.deleted_at is null
    limit 1
  )
)
with check (
  public.can_manage_employee_data()
  and company_id = (
    select scoped_users.company_id
    from public.users scoped_users
    where scoped_users.auth_user_id = auth.uid()
      and scoped_users.deleted_at is null
    limit 1
  )
);

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

drop policy if exists "employees can manage own overtime requests" on public.overtime_requests;
create policy "employees can manage own overtime requests"
on public.overtime_requests for all
to authenticated
using (
  auth.uid() is not null
  and deleted_at is null
  and employee_id = public.current_employee_id()
)
with check (
  auth.uid() is not null
  and employee_id = public.current_employee_id()
);

drop policy if exists "request approvers can manage company overtime requests" on public.overtime_requests;
create policy "request approvers can manage company overtime requests"
on public.overtime_requests for all
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

drop policy if exists "security managers can view company audit logs" on public.audit_logs;
create policy "security managers can view company audit logs"
on public.audit_logs for select
to authenticated
using (
  public.can_view_security_logs()
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
);

drop policy if exists "authenticated users can insert own audit logs" on public.audit_logs;
create policy "authenticated users can insert own audit logs"
on public.audit_logs for insert
to authenticated
with check (
  auth.uid() is not null
  and actor_user_id = (
    select users.id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
);

drop policy if exists "security managers can view company login logs" on public.login_logs;
create policy "security managers can view company login logs"
on public.login_logs for select
to authenticated
using (
  public.can_view_security_logs()
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
);

drop policy if exists "users can view own login logs" on public.login_logs;
create policy "users can view own login logs"
on public.login_logs for select
to authenticated
using (
  auth.uid() is not null
  and user_id = (
    select users.id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
);

drop policy if exists "authenticated users can insert own login logs" on public.login_logs;
create policy "authenticated users can insert own login logs"
on public.login_logs for insert
to authenticated
with check (
  auth.uid() is not null
  and user_id = (
    select users.id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
);

drop policy if exists "security managers can manage company error logs" on public.error_logs;
create policy "security managers can manage company error logs"
on public.error_logs for all
to authenticated
using (
  public.can_view_security_logs()
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
)
with check (
  public.can_view_security_logs()
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
);

drop policy if exists "authenticated users can insert own error logs" on public.error_logs;
create policy "authenticated users can insert own error logs"
on public.error_logs for insert
to authenticated
with check (
  auth.uid() is not null
  and user_id = (
    select users.id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
);

drop policy if exists "analytics users can manage company report exports" on public.report_export_batches;
create policy "analytics users can manage company report exports"
on public.report_export_batches for all
to authenticated
using (
  public.can_view_analytics()
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
)
with check (
  public.can_view_analytics()
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
);

drop policy if exists "employees can view targeted published announcements" on public.announcements;
create policy "employees can view targeted published announcements"
on public.announcements for select
to authenticated
using (
  auth.uid() is not null
  and deleted_at is null
  and status = 'published'
  and (expires_at is null or expires_at >= now())
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
  and (
    not exists (
      select 1
      from public.announcement_targets
      where announcement_targets.announcement_id = announcements.id
        and announcement_targets.deleted_at is null
    )
    or exists (
      select 1
      from public.announcement_targets
      join public.users on users.auth_user_id = auth.uid()
      left join public.employees on employees.id = users.employee_id
      where announcement_targets.announcement_id = announcements.id
        and announcement_targets.deleted_at is null
        and announcement_targets.company_id = users.company_id
        and (announcement_targets.branch_id is null or announcement_targets.branch_id = employees.primary_branch_id)
        and (announcement_targets.department_id is null or announcement_targets.department_id = employees.primary_department_id)
        and (announcement_targets.role_id is null or announcement_targets.role_id = users.role_id)
    )
  )
);

drop policy if exists "announcement managers can manage company announcements" on public.announcements;
create policy "announcement managers can manage company announcements"
on public.announcements for all
to authenticated
using (
  public.can_manage_announcements()
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
)
with check (
  public.can_manage_announcements()
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
);

drop policy if exists "announcement managers can manage company targets" on public.announcement_targets;
create policy "announcement managers can manage company targets"
on public.announcement_targets for all
to authenticated
using (
  public.can_manage_announcements()
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
)
with check (
  public.can_manage_announcements()
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
);

drop policy if exists "employees can manage own announcement reads" on public.announcement_reads;
create policy "employees can manage own announcement reads"
on public.announcement_reads for all
to authenticated
using (
  auth.uid() is not null
  and employee_id = public.current_employee_id()
)
with check (
  auth.uid() is not null
  and employee_id = public.current_employee_id()
);

drop policy if exists "employees can manage own hr requests" on public.hr_requests;
create policy "employees can manage own hr requests"
on public.hr_requests for all
to authenticated
using (
  auth.uid() is not null
  and deleted_at is null
  and applicant_id = (
    select users.id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
)
with check (
  auth.uid() is not null
  and applicant_id = (
    select users.id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
);

drop policy if exists "request approvers can manage company hr requests" on public.hr_requests;
create policy "request approvers can manage company hr requests"
on public.hr_requests for all
to authenticated
using (
  public.current_role_key() in ('super_admin','company_admin','hr_manager','hr_staff','department_manager','homecare_supervisor','admin_director','ceo','hr','supervisor')
  and exists (
    select 1
    from public.users applicant
    join public.users actor on actor.auth_user_id = auth.uid()
    where applicant.id = hr_requests.applicant_id
      and applicant.company_id = actor.company_id
      and applicant.deleted_at is null
      and actor.deleted_at is null
  )
)
with check (
  public.current_role_key() in ('super_admin','company_admin','hr_manager','hr_staff','department_manager','homecare_supervisor','admin_director','ceo','hr','supervisor')
  and exists (
    select 1
    from public.users applicant
    join public.users actor on actor.auth_user_id = auth.uid()
    where applicant.id = hr_requests.applicant_id
      and applicant.company_id = actor.company_id
      and applicant.deleted_at is null
      and actor.deleted_at is null
  )
);

drop policy if exists "employees can view own request approval events" on public.hr_approval_events;
create policy "employees can view own request approval events"
on public.hr_approval_events for select
to authenticated
using (
  exists (
    select 1
    from public.hr_requests
    join public.users applicant on applicant.id = hr_requests.applicant_id
    where hr_requests.id = hr_approval_events.request_id
      and hr_requests.deleted_at is null
      and applicant.auth_user_id = auth.uid()
      and applicant.deleted_at is null
  )
);

drop policy if exists "request approvers can manage company approval events" on public.hr_approval_events;
create policy "request approvers can manage company approval events"
on public.hr_approval_events for all
to authenticated
using (
  public.current_role_key() in ('super_admin','company_admin','hr_manager','hr_staff','department_manager','homecare_supervisor','admin_director','ceo','hr','supervisor')
  and exists (
    select 1
    from public.hr_requests
    join public.users applicant on applicant.id = hr_requests.applicant_id
    join public.users actor on actor.auth_user_id = auth.uid()
    where hr_requests.id = hr_approval_events.request_id
      and applicant.company_id = actor.company_id
      and applicant.deleted_at is null
      and actor.deleted_at is null
  )
)
with check (
  public.current_role_key() in ('super_admin','company_admin','hr_manager','hr_staff','department_manager','homecare_supervisor','admin_director','ceo','hr','supervisor')
  and actor_user_id = (
    select users.id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
  and exists (
    select 1
    from public.hr_requests
    join public.users applicant on applicant.id = hr_requests.applicant_id
    join public.users actor on actor.auth_user_id = auth.uid()
    where hr_requests.id = hr_approval_events.request_id
      and applicant.company_id = actor.company_id
      and applicant.deleted_at is null
      and actor.deleted_at is null
  )
);

drop policy if exists "retention managers can manage scoped retention records" on public.employee_retention_records;
create policy "retention managers can manage scoped retention records"
on public.employee_retention_records for all
to authenticated
using (
  public.can_manage_retention()
  and exists (
    select 1
    from public.employees
    where employees.id = employee_retention_records.employee_id
      and employees.company_id = (
        select users.company_id
        from public.users
        where users.auth_user_id = auth.uid()
          and users.deleted_at is null
        limit 1
      )
  )
)
with check (
  public.can_manage_retention()
  and exists (
    select 1
    from public.employees
    where employees.id = employee_retention_records.employee_id
      and employees.company_id = (
        select users.company_id
        from public.users
        where users.auth_user_id = auth.uid()
          and users.deleted_at is null
        limit 1
      )
  )
);

drop policy if exists "retention managers can manage scoped care logs" on public.employee_care_logs;
create policy "retention managers can manage scoped care logs"
on public.employee_care_logs for all
to authenticated
using (
  public.can_manage_retention()
  and exists (
    select 1
    from public.employees
    where employees.id = employee_care_logs.employee_id
      and employees.company_id = (
        select users.company_id
        from public.users
        where users.auth_user_id = auth.uid()
          and users.deleted_at is null
        limit 1
      )
  )
)
with check (
  public.can_manage_retention()
  and exists (
    select 1
    from public.employees
    where employees.id = employee_care_logs.employee_id
      and employees.company_id = (
        select users.company_id
        from public.users
        where users.auth_user_id = auth.uid()
          and users.deleted_at is null
        limit 1
      )
  )
);

drop policy if exists "assessment managers can manage company export batches" on public.assessment_export_batches;
create policy "assessment managers can manage company export batches"
on public.assessment_export_batches for all
to authenticated
using (
  public.can_manage_assessment_exports()
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
)
with check (
  public.can_manage_assessment_exports()
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
);

drop policy if exists "import managers can manage company excel imports" on public.excel_import_batches;
create policy "import managers can manage company excel imports"
on public.excel_import_batches for all
to authenticated
using (
  public.can_manage_excel_imports()
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
)
with check (
  public.can_manage_excel_imports()
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
);

drop policy if exists "system setting managers can manage company settings" on public.system_settings;
create policy "system setting managers can manage company settings"
on public.system_settings for all
to authenticated
using (
  public.can_manage_system_settings()
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
)
with check (
  public.can_manage_system_settings()
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
);

drop policy if exists "employees can view own training records" on public.training_records;
create policy "employees can view own training records"
on public.training_records for select
to authenticated
using (
  auth.uid() is not null
  and deleted_at is null
  and employee_id = public.current_employee_id()
);

drop policy if exists "training managers can manage scoped records" on public.training_records;
create policy "training managers can manage scoped records"
on public.training_records for all
to authenticated
using (
  public.can_manage_training()
  and exists (
    select 1
    from public.employees
    where employees.id = training_records.employee_id
      and employees.company_id = (
        select users.company_id
        from public.users
        where users.auth_user_id = auth.uid()
          and users.deleted_at is null
        limit 1
      )
  )
)
with check (
  public.can_manage_training()
  and exists (
    select 1
    from public.employees
    where employees.id = training_records.employee_id
      and employees.company_id = (
        select users.company_id
        from public.users
        where users.auth_user_id = auth.uid()
          and users.deleted_at is null
        limit 1
      )
  )
);

drop policy if exists "employees can view own licenses" on public.licenses;
create policy "employees can view own licenses"
on public.licenses for select
to authenticated
using (
  auth.uid() is not null
  and deleted_at is null
  and employee_id = public.current_employee_id()
);

drop policy if exists "employees can submit own licenses" on public.licenses;
create policy "employees can submit own licenses"
on public.licenses for insert
to authenticated
with check (
  auth.uid() is not null
  and employee_id = public.current_employee_id()
  and status in ('pending_review','missing_attachment')
);

drop policy if exists "license managers can manage scoped licenses" on public.licenses;
create policy "license managers can manage scoped licenses"
on public.licenses for all
to authenticated
using (
  public.can_manage_licenses()
  and exists (
    select 1
    from public.employees
    where employees.id = licenses.employee_id
      and employees.company_id = (
        select users.company_id
        from public.users
        where users.auth_user_id = auth.uid()
          and users.deleted_at is null
        limit 1
      )
  )
)
with check (
  public.can_manage_licenses()
  and exists (
    select 1
    from public.employees
    where employees.id = licenses.employee_id
      and employees.company_id = (
        select users.company_id
        from public.users
        where users.auth_user_id = auth.uid()
          and users.deleted_at is null
        limit 1
      )
  )
);

drop policy if exists "users can view own license documents" on public.documents;
create policy "users can view own license documents"
on public.documents for select
to authenticated
using (
  auth.uid() is not null
  and deleted_at is null
  and document_type = 'attachment'
  and (
    employee_id = public.current_employee_id()
    or (
      public.can_manage_licenses()
      and exists (
        select 1
        from public.employees
        where employees.id = documents.employee_id
          and employees.company_id = (
            select users.company_id
            from public.users
            where users.auth_user_id = auth.uid()
              and users.deleted_at is null
            limit 1
          )
      )
    )
  )
);

drop policy if exists "employees can view own released payslips" on public.payroll_payslips;
create policy "employees can view own released payslips"
on public.payroll_payslips for select
to authenticated
using (
  auth.uid() is not null
  and deleted_at is null
  and status = 'released'
  and employee_id = public.current_employee_id()
);

drop policy if exists "payroll managers can manage company payslips" on public.payroll_payslips;
create policy "payroll managers can manage company payslips"
on public.payroll_payslips for all
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

drop policy if exists "employees can view own released payslip items" on public.payroll_items;
create policy "employees can view own released payslip items"
on public.payroll_items for select
to authenticated
using (
  auth.uid() is not null
  and deleted_at is null
  and employee_id = public.current_employee_id()
  and exists (
    select 1
    from public.payroll_payslips
    where payroll_payslips.id = payroll_items.payroll_payslip_id
      and payroll_payslips.employee_id = payroll_items.employee_id
      and payroll_payslips.status = 'released'
      and payroll_payslips.deleted_at is null
  )
);

drop policy if exists "payroll managers can manage company payslip items" on public.payroll_items;
create policy "payroll managers can manage company payslip items"
on public.payroll_items for all
to authenticated
using (
  public.can_manage_payroll()
  and exists (
    select 1
    from public.employees
    where employees.id = payroll_items.employee_id
      and employees.company_id = (
        select users.company_id
        from public.users
        where users.auth_user_id = auth.uid()
          and users.deleted_at is null
        limit 1
      )
  )
)
with check (
  public.can_manage_payroll()
  and exists (
    select 1
    from public.employees
    where employees.id = payroll_items.employee_id
      and employees.company_id = (
        select users.company_id
        from public.users
        where users.auth_user_id = auth.uid()
          and users.deleted_at is null
        limit 1
      )
  )
);

drop policy if exists "payroll managers can view company payroll item settings" on public.payroll_item_settings;
create policy "payroll managers can view company payroll item settings"
on public.payroll_item_settings for select
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

drop policy if exists "payroll managers can manage company payroll item settings" on public.payroll_item_settings;
create policy "payroll managers can manage company payroll item settings"
on public.payroll_item_settings for all
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

insert into public.payroll_item_settings (
  company_id,
  code,
  name,
  category,
  calculation_basis,
  default_amount,
  taxable,
  include_in_insurance_wage,
  is_active,
  legal_basis,
  description
)
select
  companies.id,
  item.code,
  item.name,
  item.category,
  item.calculation_basis,
  item.default_amount,
  item.taxable,
  item.include_in_insurance_wage,
  true,
  item.legal_basis,
  item.description
from public.companies
cross join (
  values
    ('BASE', '本薪', 'fixed_earning', 'fixed_amount', 0::numeric, true, true, '勞動契約、工資清冊', '員工主要薪資基礎，依薪資型態與員工薪資設定帶入。'),
    ('OT', '加班費', 'variable_earning', 'overtime', 0::numeric, true, false, '勞動基準法第24條、第39條', '依平日、休息日、例假日、國定假日加班規則計算。'),
    ('ALLOWANCE', '津貼', 'fixed_earning', 'fixed_amount', 0::numeric, true, true, '勞動契約、公司薪資規則', '伙食津貼、職務津貼、證照津貼、交通津貼等可彙總或拆項。'),
    ('BONUS', '獎金', 'variable_earning', 'manual', 0::numeric, true, false, '公司獎金辦法或核准紀錄', '績效獎金、留任獎金或專案獎金。'),
    ('ATTENDANCE', '全勤', 'fixed_earning', 'attendance', 2000::numeric, true, true, '公司全勤獎金規則', '依出勤異常、請假扣全勤規則判斷。'),
    ('LEAVE_DEDUCT', '請假扣薪', 'variable_deduction', 'attendance', 0::numeric, false, false, '勞動基準法、性別平等工作法、公司假別規則', '依假別支薪比例與請假時數計算扣薪。'),
    ('LATE_DEDUCT', '遲到扣款', 'variable_deduction', 'attendance', 0::numeric, false, false, '公司出勤規則、工資扣款同意紀錄', '依遲到早退與公司扣款規則計算。'),
    ('LABOR_SELF', '勞保自付', 'employee_contribution', 'rate_table', 0::numeric, false, false, '勞工保險條例與級距表', '依勞保級距與員工負擔比例計算。'),
    ('NHI_SELF', '健保自付', 'employee_contribution', 'rate_table', 0::numeric, false, false, '全民健康保險法與級距表', '依健保級距、眷屬人數與員工負擔比例計算。'),
    ('PENSION_COMPANY', '勞退公司提繳', 'employer_cost', 'percentage', 0::numeric, false, false, '勞工退休金條例', '依勞退提繳工資與公司提繳比例計算。'),
    ('SUPPLEMENT_NHI', '補充保費', 'employee_contribution', 'rate_table', 0::numeric, false, false, '全民健康保險法補充保險費規定', '依二代健保補充保費規則計算。'),
    ('INCOME_TAX', '所得稅', 'fixed_deduction', 'percentage', 0::numeric, false, false, '所得稅法與扣繳辦法', '依員工所得稅設定與扣繳規則計算。')
) as item(code, name, category, calculation_basis, default_amount, taxable, include_in_insurance_wage, legal_basis, description)
where companies.deleted_at is null
on conflict (company_id, code) do nothing;
