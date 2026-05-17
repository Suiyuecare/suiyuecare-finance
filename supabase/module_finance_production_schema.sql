-- Module Finance production schema for the current single-page app.
-- Run this in Supabase SQL Editor before deploying the HTML app.

create extension if not exists pgcrypto;

create table if not exists finance_users (
  id text primary key,
  name text not null,
  email text unique not null,
  demo_password text,
  role text not null check (role in ('employee','section_chief','dept_manager','admin_director','general_affairs','hr','accountant','ceo')),
  role_label text,
  entity_id text,
  department_code text not null,
  init text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table finance_users add column if not exists entity_id text;

create table if not exists system_settings (
  key text primary key,
  value jsonb not null,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists voucher_serials (
  kind text not null,
  year int not null,
  last_no int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (kind, year)
);

create table if not exists expense_requests (
  id text primary key,
  no text unique not null,
  entity_id text not null,
  department_code text not null,
  applicant text not null,
  applicant_id text,
  applicant_email text,
  type text not null,
  type_label text,
  amount numeric(14,2) not null check (amount >= 0),
  estimated_amount numeric(14,2) check (estimated_amount is null or estimated_amount >= 0),
  actual_amount numeric(14,2) check (actual_amount is null or actual_amount >= 0),
  description text,
  payee text,
  bank_type text,
  bank_name text,
  bank_branch text,
  bank_no text,
  expected_pay_date date,
  bank_account text,
  fee_bearer text,
  bank_fee_amount numeric(14,2) not null default 0 check (bank_fee_amount >= 0),
  status text not null,
  step int not null default 1,
  ver int not null default 1,
  request_date date,
  debit_account text,
  debit_account_name text,
  credit_account text,
  credit_account_name text,
  files jsonb not null default '[]'::jsonb,
  actual_files jsonb not null default '[]'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  petty_mode text,
  form_payload jsonb not null default '{}'::jsonb,
  voucher_id text,
  cash_posted_at timestamptz,
  ledger_posted_at timestamptz,
  posting_locked_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table expense_requests add column if not exists payee text;
alter table expense_requests add column if not exists bank_type text;
alter table expense_requests add column if not exists bank_name text;
alter table expense_requests add column if not exists bank_branch text;
alter table expense_requests add column if not exists bank_no text;
alter table expense_requests add column if not exists applicant_id text;
alter table expense_requests add column if not exists applicant_email text;
alter table expense_requests add column if not exists expected_pay_date date;
alter table expense_requests add column if not exists fee_bearer text;
alter table expense_requests add column if not exists bank_fee_amount numeric(14,2) not null default 0;
alter table expense_requests add column if not exists estimated_amount numeric(14,2);
alter table expense_requests add column if not exists actual_amount numeric(14,2);
alter table expense_requests add column if not exists actual_files jsonb not null default '[]'::jsonb;
alter table expense_requests add column if not exists petty_mode text;
alter table expense_requests add column if not exists form_payload jsonb not null default '{}'::jsonb;
alter table expense_requests add column if not exists cash_posted_at timestamptz;
alter table expense_requests add column if not exists ledger_posted_at timestamptz;
alter table expense_requests add column if not exists posting_locked_at timestamptz;
alter table expense_requests add column if not exists voided_at timestamptz;
do $$
begin
  alter table expense_requests add constraint expense_requests_bank_fee_amount_nonnegative check (bank_fee_amount >= 0);
exception
  when duplicate_object then null;
end $$;
do $$
begin
  alter table expense_requests add constraint expense_requests_estimated_amount_nonnegative check (estimated_amount is null or estimated_amount >= 0);
exception
  when duplicate_object then null;
end $$;
do $$
begin
  alter table expense_requests add constraint expense_requests_actual_amount_nonnegative check (actual_amount is null or actual_amount >= 0);
exception
  when duplicate_object then null;
end $$;

create table if not exists invoices (
  id text primary key,
  no text unique not null,
  entity_id text not null,
  entity_name text,
  department_code text,
  buyer text not null,
  tax_id text,
  applicant text,
  applicant_id text,
  batch_id text,
  amount numeric(14,2) not null check (amount >= 0),
  tax numeric(14,2) not null default 0 check (tax >= 0),
  total numeric(14,2) not null check (total >= 0),
  invoice_date date,
  paid_at timestamptz,
  status text not null default 'unpaid' check (status in ('unpaid','pending_receipt_review','paid','partial','void')),
  approval_status text not null default 'pending_section_chief',
  approval_step int not null default 1,
  steps jsonb not null default '[]'::jsonb,
  description text,
  receipt_files jsonb not null default '[]'::jsonb,
  receipt_note text,
  receipt_submitted_at timestamptz,
  receipt_submitted_by text,
  receipt_reviewed_at timestamptz,
  receipt_reviewed_by text,
  receipt_review_note text,
  revenue_posted boolean not null default false,
  revenue_posted_at timestamptz,
  cash_receipt_posted_at timestamptz,
  posting_locked_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table invoices add column if not exists batch_id text;
alter table invoices add column if not exists department_code text;
alter table invoices add column if not exists applicant text;
alter table invoices add column if not exists approval_status text not null default 'pending_section_chief';
alter table invoices add column if not exists approval_step int not null default 1;
alter table invoices add column if not exists steps jsonb not null default '[]'::jsonb;
alter table invoices add column if not exists description text;
alter table invoices add column if not exists paid_at timestamptz;
alter table invoices add column if not exists receipt_files jsonb not null default '[]'::jsonb;
alter table invoices add column if not exists receipt_note text;
alter table invoices add column if not exists receipt_submitted_at timestamptz;
alter table invoices add column if not exists receipt_submitted_by text;
alter table invoices add column if not exists receipt_reviewed_at timestamptz;
alter table invoices add column if not exists receipt_reviewed_by text;
alter table invoices add column if not exists receipt_review_note text;
alter table invoices add column if not exists revenue_posted boolean not null default false;
alter table invoices add column if not exists revenue_posted_at timestamptz;
alter table invoices add column if not exists cash_receipt_posted_at timestamptz;
alter table invoices add column if not exists posting_locked_at timestamptz;
alter table invoices add column if not exists voided_at timestamptz;
alter table invoices add column if not exists applicant_id text;
alter table invoices add column if not exists tax_id text;

create table if not exists vouchers (
  id text primary key,
  no text unique not null,
  request_id text,
  entity_id text,
  entity_name text,
  voucher_date date,
  description text,
  entries jsonb not null default '[]'::jsonb,
  total numeric(14,2) not null default 0,
  creator text,
  posted boolean not null default true,
  posted_at timestamptz not null default now(),
  posting_locked_at timestamptz,
  voided_at timestamptz,
  adjusts_voucher_no text,
  adjustment_type text check (adjustment_type is null or adjustment_type in ('reversal','adjustment')),
  created_at timestamptz not null default now()
);
alter table vouchers add column if not exists posted_at timestamptz not null default now();
alter table vouchers add column if not exists posting_locked_at timestamptz;
alter table vouchers add column if not exists voided_at timestamptz;
alter table vouchers add column if not exists adjusts_voucher_no text;
alter table vouchers add column if not exists adjustment_type text;
do $$
begin
  alter table vouchers add constraint vouchers_adjustment_type_check check (adjustment_type is null or adjustment_type in ('reversal','adjustment'));
exception
  when duplicate_object then null;
end $$;

create table if not exists bills (
  id text primary key,
  item text not null,
  item_key text,
  entity_id text not null,
  entity_name text,
  amount numeric(14,2) not null check (amount >= 0),
  due_date date,
  method text,
  note text,
  status text not null default 'unpaid',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists notifications (
  id text primary key,
  type text not null default 'system',
  title text not null,
  body text,
  time text,
  read boolean not null default false,
  request_id text,
  created_at timestamptz not null default now()
);

create table if not exists ledger_entries (
  id bigint generated by default as identity primary key,
  entry_date date not null,
  description text,
  entity_id text,
  department_code text,
  debit numeric(14,2) not null default 0 check (debit >= 0),
  credit numeric(14,2) not null default 0 check (credit >= 0),
  account_code text not null,
  account_name text,
  reference_no text,
  posting_key text,
  source_type text,
  source_id text,
  source_no text,
  voucher_no text,
  voided_at timestamptz,
  created_at timestamptz not null default now()
);
alter table ledger_entries add column if not exists entity_id text;
alter table ledger_entries add column if not exists posting_key text;
alter table ledger_entries add column if not exists source_type text;
alter table ledger_entries add column if not exists source_id text;
alter table ledger_entries add column if not exists source_no text;
alter table ledger_entries add column if not exists voucher_no text;
alter table ledger_entries add column if not exists voided_at timestamptz;

create table if not exists module_audit_logs (
  id bigint generated by default as identity primary key,
  table_name text not null,
  row_id text,
  action text not null,
  actor_email text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function prevent_posted_voucher_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op in ('UPDATE','DELETE') and old.posted = true and old.voided_at is null then
    raise exception 'Posted vouchers are immutable; create a reversal or adjustment voucher instead.';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function prevent_posted_ledger_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op in ('UPDATE','DELETE') and old.posting_key is not null and old.voided_at is null then
    raise exception 'Posted ledger entries are immutable; create a reversal or adjustment voucher instead.';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_expense_requests_updated_at on expense_requests;
create trigger trg_expense_requests_updated_at before update on expense_requests
for each row execute function set_updated_at();

drop trigger if exists trg_invoices_updated_at on invoices;
create trigger trg_invoices_updated_at before update on invoices
for each row execute function set_updated_at();

drop trigger if exists trg_bills_updated_at on bills;
create trigger trg_bills_updated_at before update on bills
for each row execute function set_updated_at();

drop trigger if exists trg_prevent_posted_voucher_mutation on vouchers;
create trigger trg_prevent_posted_voucher_mutation before update or delete on vouchers
for each row execute function prevent_posted_voucher_mutation();

drop trigger if exists trg_prevent_posted_ledger_mutation on ledger_entries;
create trigger trg_prevent_posted_ledger_mutation before update or delete on ledger_entries
for each row execute function prevent_posted_ledger_mutation();

create or replace function write_module_audit_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rid text;
begin
  if tg_table_name = 'system_settings' then
    rid := case when tg_op = 'DELETE' then old.key::text else new.key::text end;
  elsif tg_op = 'DELETE' then
    rid := old.id::text;
  else
    rid := new.id::text;
  end if;
  insert into module_audit_logs(table_name,row_id,action,actor_email,before_data,after_data)
  values (tg_table_name, rid, tg_op, auth.jwt()->>'email', to_jsonb(old), to_jsonb(new));
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_expense_requests_audit on expense_requests;
create trigger trg_expense_requests_audit after insert or update or delete on expense_requests
for each row execute function write_module_audit_log();

drop trigger if exists trg_invoices_audit on invoices;
create trigger trg_invoices_audit after insert or update or delete on invoices
for each row execute function write_module_audit_log();

drop trigger if exists trg_ledger_entries_audit on ledger_entries;
create trigger trg_ledger_entries_audit after insert or update or delete on ledger_entries
for each row execute function write_module_audit_log();

drop trigger if exists trg_vouchers_audit on vouchers;
create trigger trg_vouchers_audit after insert or update or delete on vouchers
for each row execute function write_module_audit_log();

drop trigger if exists trg_bills_audit on bills;
create trigger trg_bills_audit after insert or update or delete on bills
for each row execute function write_module_audit_log();

drop trigger if exists trg_notifications_audit on notifications;
create trigger trg_notifications_audit after insert or update or delete on notifications
for each row execute function write_module_audit_log();

drop trigger if exists trg_finance_users_audit on finance_users;
create trigger trg_finance_users_audit after insert or update or delete on finance_users
for each row execute function write_module_audit_log();

drop trigger if exists trg_system_settings_updated_at on system_settings;
create trigger trg_system_settings_updated_at before update on system_settings
for each row execute function set_updated_at();

drop trigger if exists trg_system_settings_audit on system_settings;
create trigger trg_system_settings_audit after insert or update or delete on system_settings
for each row execute function write_module_audit_log();

create index if not exists idx_expense_requests_status on expense_requests(status, step);
create index if not exists idx_expense_requests_entity_date on expense_requests(entity_id, request_date);
create index if not exists idx_invoices_status on invoices(status, approval_status);
create index if not exists idx_invoices_batch on invoices(batch_id);
create index if not exists idx_invoices_entity_date on invoices(entity_id, invoice_date);
create index if not exists idx_ledger_entries_date on ledger_entries(entry_date);
create index if not exists idx_ledger_entries_reference on ledger_entries(reference_no);
create index if not exists idx_ledger_entries_source on ledger_entries(source_type, source_no);
create index if not exists idx_ledger_entries_voucher_no on ledger_entries(voucher_no);
create unique index if not exists idx_ledger_entries_posting_key on ledger_entries(posting_key) where posting_key is not null;
create unique index if not exists idx_expense_requests_voucher_id on expense_requests(voucher_id) where voucher_id is not null;
create index if not exists idx_notifications_read on notifications(read, created_at);

do $$
begin
  alter publication supabase_realtime add table finance_users;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table expense_requests;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table invoices;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table ledger_entries;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table bills;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table vouchers;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table notifications;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table system_settings;
exception when duplicate_object then null;
end $$;

alter table finance_users enable row level security;
alter table system_settings enable row level security;
alter table voucher_serials enable row level security;
alter table expense_requests enable row level security;
alter table invoices enable row level security;
alter table vouchers enable row level security;
alter table bills enable row level security;
alter table notifications enable row level security;
alter table ledger_entries enable row level security;
alter table module_audit_logs enable row level security;

alter table finance_users force row level security;
alter table system_settings force row level security;
alter table voucher_serials force row level security;
alter table expense_requests force row level security;
alter table invoices force row level security;
alter table vouchers force row level security;
alter table bills force row level security;
alter table notifications force row level security;
alter table ledger_entries force row level security;
alter table module_audit_logs force row level security;

drop policy if exists finance_users_authenticated on finance_users;
drop policy if exists system_settings_authenticated on system_settings;
drop policy if exists system_settings_read on system_settings;
create policy system_settings_read on system_settings for select to authenticated using (true);
drop policy if exists system_settings_admin_insert on system_settings;
create policy system_settings_admin_insert on system_settings for insert to authenticated with check (
  exists (select 1 from finance_users fu where fu.email = (auth.jwt() ->> 'email') and fu.active = true and fu.role in ('ceo','admin_director'))
);
drop policy if exists system_settings_admin_update on system_settings;
create policy system_settings_admin_update on system_settings for update to authenticated using (
  exists (select 1 from finance_users fu where fu.email = (auth.jwt() ->> 'email') and fu.active = true and fu.role in ('ceo','admin_director'))
) with check (
  exists (select 1 from finance_users fu where fu.email = (auth.jwt() ->> 'email') and fu.active = true and fu.role in ('ceo','admin_director'))
);
drop policy if exists system_settings_admin_delete on system_settings;
create policy system_settings_admin_delete on system_settings for delete to authenticated using (
  exists (select 1 from finance_users fu where fu.email = (auth.jwt() ->> 'email') and fu.active = true and fu.role in ('ceo','admin_director'))
);
drop policy if exists voucher_serials_accounting on voucher_serials;
create policy voucher_serials_accounting on voucher_serials for all to authenticated using (
  exists (select 1 from finance_users fu where fu.email = (auth.jwt() ->> 'email') and fu.active = true and fu.role in ('ceo','admin_director','accountant'))
) with check (
  exists (select 1 from finance_users fu where fu.email = (auth.jwt() ->> 'email') and fu.active = true and fu.role in ('ceo','admin_director','accountant'))
);
drop policy if exists expense_requests_authenticated on expense_requests;
drop policy if exists invoices_authenticated on invoices;
drop policy if exists vouchers_authenticated on vouchers;
drop policy if exists bills_authenticated on bills;
drop policy if exists notifications_authenticated on notifications;
drop policy if exists ledger_entries_authenticated on ledger_entries;
drop policy if exists module_audit_logs_authenticated_read on module_audit_logs;
-- Do not recreate broad authenticated policies here. Apply rls_hardening.sql
-- after this schema file to install role-aware policies. Without those scoped
-- policies, RLS denies access by default.

create extension if not exists supabase_vault with schema vault;

create or replace function public.get_openai_invoice_key()
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  claims jsonb;
begin
  claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;

  if coalesce(claims ->> 'role', '') <> 'service_role' then
    raise exception 'forbidden';
  end if;

  return (
    select decrypted_secret
    from vault.decrypted_secrets
    where name = 'openai_api_key'
    limit 1
  );
end;
$$;

revoke all on function public.get_openai_invoice_key() from public, anon, authenticated;
grant execute on function public.get_openai_invoice_key() to service_role;
