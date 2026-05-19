-- P0 production hardening applied on 2026-05-19.
-- Purpose:
--   1. Align live Supabase schema with Finance OS V3 frontend fields.
--   2. Force RLS on finance tables.
--   3. Restore immutable posted voucher / ledger triggers.
--   4. Fix Storage RLS for the V3 archive path:
--      <record_type>/<data_environment>/<YYYY>/<MM>/<entity>/<department>/<record_no>/<kind>/<file>

begin;

alter table public.expense_requests add column if not exists applicant_id text;
alter table public.expense_requests add column if not exists applicant_email text;
alter table public.expense_requests add column if not exists estimated_amount numeric;
alter table public.expense_requests add column if not exists actual_amount numeric;
alter table public.expense_requests add column if not exists actual_files jsonb not null default '[]'::jsonb;
alter table public.expense_requests add column if not exists petty_mode text;
alter table public.expense_requests add column if not exists form_payload jsonb not null default '{}'::jsonb;
alter table public.expense_requests add column if not exists bank_type text;
alter table public.expense_requests add column if not exists cash_posted_at timestamptz;
alter table public.expense_requests add column if not exists ledger_posted_at timestamptz;
alter table public.expense_requests add column if not exists posting_locked_at timestamptz;
alter table public.expense_requests add column if not exists voided_at timestamptz;
alter table public.expense_requests add column if not exists data_environment text not null default 'production';

alter table public.invoices add column if not exists applicant_id text;
alter table public.invoices add column if not exists receipt_note text;
alter table public.invoices add column if not exists receipt_submitted_at timestamptz;
alter table public.invoices add column if not exists receipt_submitted_by text;
alter table public.invoices add column if not exists receipt_reviewed_at timestamptz;
alter table public.invoices add column if not exists receipt_reviewed_by text;
alter table public.invoices add column if not exists receipt_review_note text;
alter table public.invoices add column if not exists revenue_posted boolean not null default false;
alter table public.invoices add column if not exists revenue_posted_at timestamptz;
alter table public.invoices add column if not exists cash_receipt_posted_at timestamptz;
alter table public.invoices add column if not exists posting_locked_at timestamptz;
alter table public.invoices add column if not exists voided_at timestamptz;
alter table public.invoices add column if not exists data_environment text not null default 'production';

alter table public.ledger_entries add column if not exists posting_key text;
alter table public.ledger_entries add column if not exists source_type text;
alter table public.ledger_entries add column if not exists source_id text;
alter table public.ledger_entries add column if not exists source_no text;
alter table public.ledger_entries add column if not exists voucher_no text;
alter table public.ledger_entries add column if not exists voided_at timestamptz;
alter table public.ledger_entries add column if not exists data_environment text not null default 'production';

alter table public.vouchers add column if not exists posted_at timestamptz not null default now();
alter table public.vouchers add column if not exists posting_locked_at timestamptz;
alter table public.vouchers add column if not exists voided_at timestamptz;
alter table public.vouchers add column if not exists adjusts_voucher_no text;
alter table public.vouchers add column if not exists adjustment_type text;
alter table public.vouchers add column if not exists data_environment text not null default 'production';

do $$
begin
  if to_regclass('public.draft_requests') is not null then
    alter table public.draft_requests add column if not exists data_environment text not null default 'production';
  end if;
  if to_regclass('public.file_attachments') is not null then
    alter table public.file_attachments add column if not exists archive_year text;
    alter table public.file_attachments add column if not exists archive_month text;
    alter table public.file_attachments add column if not exists entity_id text;
    alter table public.file_attachments add column if not exists department_code text;
    alter table public.file_attachments add column if not exists record_date date;
    alter table public.file_attachments add column if not exists archive_path text;
    alter table public.file_attachments add column if not exists retention_policy text not null default 'finance_supporting_docs_10y';
    alter table public.file_attachments add column if not exists retention_until date;
    alter table public.file_attachments add column if not exists data_environment text not null default 'production';
  end if;
end $$;

create unique index if not exists idx_expense_requests_voucher_id
on public.expense_requests(voucher_id)
where voucher_id is not null;

create unique index if not exists idx_ledger_entries_posting_key
on public.ledger_entries(posting_key)
where posting_key is not null;

create index if not exists idx_expense_requests_applicant_id on public.expense_requests(applicant_id);
create index if not exists idx_expense_requests_environment on public.expense_requests(data_environment);
create index if not exists idx_invoices_environment on public.invoices(data_environment);
create index if not exists idx_ledger_entries_environment on public.ledger_entries(data_environment);

create or replace function public.prevent_posted_voucher_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op in ('UPDATE','DELETE') and old.posted = true and old.voided_at is null then
    raise exception 'Posted vouchers are immutable; create a reversal or adjustment voucher instead.';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.prevent_posted_ledger_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op in ('UPDATE','DELETE') and old.posting_key is not null and old.voided_at is null then
    raise exception 'Posted ledger entries are immutable; create a reversal or adjustment voucher instead.';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_prevent_posted_voucher_mutation on public.vouchers;
create trigger trg_prevent_posted_voucher_mutation
before update or delete on public.vouchers
for each row execute function public.prevent_posted_voucher_mutation();

drop trigger if exists trg_prevent_posted_ledger_mutation on public.ledger_entries;
create trigger trg_prevent_posted_ledger_mutation
before update or delete on public.ledger_entries
for each row execute function public.prevent_posted_ledger_mutation();

alter table public.finance_users force row level security;
alter table public.system_settings force row level security;
alter table public.expense_requests force row level security;
alter table public.invoices force row level security;
alter table public.vouchers force row level security;
alter table public.bills force row level security;
alter table public.notifications force row level security;
alter table public.ledger_entries force row level security;
alter table public.module_audit_logs force row level security;

do $$
begin
  if to_regclass('public.voucher_serials') is not null then execute 'alter table public.voucher_serials force row level security'; end if;
  if to_regclass('public.draft_requests') is not null then execute 'alter table public.draft_requests force row level security'; end if;
  if to_regclass('public.file_attachments') is not null then execute 'alter table public.file_attachments force row level security'; end if;
  if to_regclass('public.period_closes') is not null then execute 'alter table public.period_closes force row level security'; end if;
  if to_regclass('public.compliance_audit_logs') is not null then execute 'alter table public.compliance_audit_logs force row level security'; end if;
  if to_regclass('public.system_setting_versions') is not null then execute 'alter table public.system_setting_versions force row level security'; end if;
  if to_regclass('public.account_change_requests') is not null then execute 'alter table public.account_change_requests force row level security'; end if;
end $$;

drop policy if exists finance_attachments_select_scoped on storage.objects;
create policy finance_attachments_select_scoped
on storage.objects
for select
to authenticated
using (
  bucket_id = 'finance-attachments'
  and (
    (
      (storage.foldername(name))[1] = 'draft_requests'
      and exists (
        select 1 from public.draft_requests d
        where d.id in ((storage.foldername(name))[3], (storage.foldername(name))[6], (storage.foldername(name))[7])
          and (
            lower(d.owner_email) = lower(auth.jwt() ->> 'email')
            or d.owner_id = public.current_finance_user_id()
            or public.is_finance_admin()
          )
      )
    )
    or (
      (storage.foldername(name))[1] = 'expense_requests'
      and exists (
        select 1 from public.expense_requests r
        where r.no in ((storage.foldername(name))[3], (storage.foldername(name))[6], (storage.foldername(name))[7])
          and public.can_read_expense_request(r)
      )
    )
    or (
      (storage.foldername(name))[1] = 'invoices'
      and exists (
        select 1 from public.invoices i
        where i.no in ((storage.foldername(name))[3], (storage.foldername(name))[6], (storage.foldername(name))[7])
          and public.can_read_invoice(i)
      )
    )
    or (
      (storage.foldername(name))[1] = 'vouchers'
      and public.is_finance_accounting()
    )
  )
);

commit;
