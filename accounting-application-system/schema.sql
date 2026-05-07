-- Enterprise accounting application system schema
-- Target: PostgreSQL / Supabase

create extension if not exists pgcrypto;

create type application_type as enum (
  'expense_reimbursement',
  'payment_request',
  'advance_request',
  'petty_cash_request',
  'travel_request',
  'welfare_request',
  'purchase_request',
  'refund_request',
  'hr_expense_request'
);

create type application_status as enum (
  'draft',
  'submitted',
  'manager_review',
  'accounting_review',
  'finance_review',
  'approved',
  'pending_payment',
  'paid',
  'pending_settlement',
  'partially_settled',
  'settled',
  'closed',
  'returned',
  'rejected',
  'cancelled',
  'payment_failed',
  'overdue_settlement'
);

create table applications (
  id uuid primary key default gen_random_uuid(),
  application_no text unique not null,
  application_type application_type not null,
  applicant_id uuid not null,
  department_id uuid not null,
  amount numeric(14,2) not null check (amount >= 0),
  currency text not null default 'TWD',
  payment_method text,
  payee_type text,
  payee_name text,
  accounting_month date,
  project_id uuid,
  location_id uuid,
  description text,
  accounting_subject_suggestion text,
  status application_status not null default 'draft',
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  paid_at timestamptz,
  closed_at timestamptz
);

create table approval_steps (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  step_order int not null check (step_order > 0),
  approver_role text not null,
  approver_id uuid,
  status text not null default 'pending' check (status in ('pending','approved','rejected','returned')),
  comment text,
  approved_at timestamptz,
  unique (application_id, step_order)
);

create table attachments (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  file_name text not null,
  file_url text not null,
  file_type text,
  uploaded_by uuid not null,
  uploaded_at timestamptz not null default now()
);

create table payment_records (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  payment_date date not null,
  payment_amount numeric(14,2) not null check (payment_amount >= 0),
  payment_method text not null,
  bank_account text,
  transaction_reference text,
  payment_status text not null default 'paid',
  paid_by uuid not null,
  note text
);

create table accounting_entries (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  debit_account text not null,
  credit_account text not null,
  amount numeric(14,2) not null check (amount >= 0),
  description text,
  accounting_month date not null,
  export_status text not null default 'not_exported',
  created_at timestamptz not null default now()
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references applications(id) on delete cascade,
  actor_id uuid,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create table expense_reimbursement_details (
  application_id uuid primary key references applications(id) on delete cascade,
  expense_date date not null,
  expense_category text not null,
  payment_method text not null,
  employee_bank_account_id uuid,
  invoice_type text,
  invoice_number text,
  tax_id text,
  project_id uuid,
  location_id uuid
);

create table payment_request_details (
  application_id uuid primary key references applications(id) on delete cascade,
  payee_type text not null,
  payee_name text not null,
  payee_tax_id text,
  payee_bank_name text,
  payee_bank_branch text,
  payee_bank_account text,
  payee_bank_account_name text,
  payment_category text not null,
  due_date date not null,
  is_withholding_required boolean not null default false,
  contract_id uuid,
  purchase_order_id uuid
);

create table advance_request_details (
  application_id uuid primary key references applications(id) on delete cascade,
  advance_purpose text not null,
  expected_usage_date date not null,
  expected_settlement_date date not null,
  employee_bank_account_id uuid,
  project_id uuid,
  event_id uuid,
  reason text not null
);

create table advance_items (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  item_name text not null,
  estimated_amount numeric(14,2) not null check (estimated_amount >= 0),
  purpose text,
  expected_payee text
);

create table petty_cash_request_details (
  application_id uuid primary key references applications(id) on delete cascade,
  petty_cash_location_id uuid not null,
  request_type text not null check (request_type in ('new','replenish','close','adjust_limit')),
  requested_amount numeric(14,2) not null check (requested_amount >= 0),
  approved_limit numeric(14,2) check (approved_limit >= 0),
  current_balance numeric(14,2) not null default 0 check (current_balance >= 0),
  custodian_id uuid not null,
  custody_location text,
  usage_scope text,
  period_start date,
  period_end date
);

create table petty_cash_expense_items (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  expense_date date not null,
  category text not null,
  amount numeric(14,2) not null check (amount >= 0),
  receipt_number text,
  description text,
  attachment_id uuid references attachments(id)
);

create table travel_request_details (
  application_id uuid primary key references applications(id) on delete cascade,
  travel_type text not null check (travel_type in ('domestic','international','cross_county','same_day')),
  purpose text not null,
  destination text not null,
  start_datetime timestamptz not null,
  end_datetime timestamptz not null,
  transportation_method text,
  requires_accommodation boolean not null default false,
  requires_advance boolean not null default false,
  estimated_transportation_fee numeric(14,2) default 0 check (estimated_transportation_fee >= 0),
  estimated_lodging_fee numeric(14,2) default 0 check (estimated_lodging_fee >= 0),
  estimated_meal_fee numeric(14,2) default 0 check (estimated_meal_fee >= 0),
  estimated_misc_fee numeric(14,2) default 0 check (estimated_misc_fee >= 0),
  project_id uuid,
  substitute_employee_id uuid,
  check (end_datetime >= start_datetime)
);

create table welfare_request_details (
  application_id uuid primary key references applications(id) on delete cascade,
  welfare_type text not null,
  reason text not null,
  event_date date not null,
  eligibility_status text,
  employee_start_date date,
  seniority_months int check (seniority_months is null or seniority_months >= 0),
  employee_bank_account_id uuid,
  include_in_payroll boolean not null default false,
  is_withholding_required boolean not null default false
);

create table purchase_request_details (
  application_id uuid primary key references applications(id) on delete cascade,
  purchase_type text not null,
  reason text not null,
  is_fixed_asset boolean not null default false,
  is_urgent boolean not null default false,
  required_date date,
  budget_source text,
  suggested_vendor_id uuid,
  requires_quotation_comparison boolean not null default false
);

create table purchase_items (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  item_name text not null,
  specification text,
  quantity numeric(12,2) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  subtotal numeric(14,2) generated always as (quantity * unit_price) stored,
  purpose text,
  usage_location_id uuid
);

create table refund_request_details (
  application_id uuid primary key references applications(id) on delete cascade,
  refundee_type text not null,
  refundee_name text not null,
  refundee_contact text,
  original_payment_date date not null,
  original_payment_amount numeric(14,2) not null check (original_payment_amount >= 0),
  refund_amount numeric(14,2) not null check (refund_amount >= 0),
  refund_reason text not null,
  refund_method text not null,
  refund_bank_name text,
  refund_bank_branch text,
  refund_bank_account text,
  refund_bank_account_name text,
  requires_allowance_note boolean not null default false,
  related_income_record_id uuid,
  check (refund_amount <= original_payment_amount)
);

create table hr_expense_request_details (
  application_id uuid primary key references applications(id) on delete cascade,
  payee_type text not null,
  payee_id uuid,
  payee_name text not null,
  expense_type text not null,
  payroll_month date,
  calculation_start_date date,
  calculation_end_date date,
  calculation_description text,
  include_in_payroll boolean not null default false,
  is_withholding_required boolean not null default false,
  requires_labor_insurance_action boolean not null default false,
  expected_payment_date date,
  check (calculation_end_date is null or calculation_start_date is null or calculation_end_date >= calculation_start_date)
);

create index idx_applications_filters on applications(application_type, status, applicant_id, department_id, created_at, amount);
create index idx_approval_steps_pending on approval_steps(approver_id, approver_role, status);
create index idx_audit_logs_application on audit_logs(application_id, created_at);

