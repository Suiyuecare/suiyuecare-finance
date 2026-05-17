-- Hardening for duplicate-posting prevention.
-- Apply after module_finance_production_schema.sql, then re-apply accounting_rpc.sql.

begin;

alter table public.expense_requests add column if not exists cash_posted_at timestamptz;
alter table public.expense_requests add column if not exists ledger_posted_at timestamptz;
alter table public.expense_requests add column if not exists posting_locked_at timestamptz;
alter table public.expense_requests add column if not exists voided_at timestamptz;

alter table public.invoices add column if not exists revenue_posted_at timestamptz;
alter table public.invoices add column if not exists cash_receipt_posted_at timestamptz;
alter table public.invoices add column if not exists posting_locked_at timestamptz;
alter table public.invoices add column if not exists voided_at timestamptz;

alter table public.vouchers add column if not exists posted_at timestamptz not null default now();
alter table public.vouchers add column if not exists posting_locked_at timestamptz;
alter table public.vouchers add column if not exists voided_at timestamptz;

alter table public.ledger_entries add column if not exists posting_key text;
alter table public.ledger_entries add column if not exists source_type text;
alter table public.ledger_entries add column if not exists source_id text;
alter table public.ledger_entries add column if not exists source_no text;
alter table public.ledger_entries add column if not exists voucher_no text;
alter table public.ledger_entries add column if not exists voided_at timestamptz;

create unique index if not exists idx_ledger_entries_posting_key
on public.ledger_entries(posting_key)
where posting_key is not null;

create index if not exists idx_ledger_entries_source
on public.ledger_entries(source_type, source_no);

create index if not exists idx_ledger_entries_voucher_no
on public.ledger_entries(voucher_no);

create unique index if not exists idx_expense_requests_voucher_id
on public.expense_requests(voucher_id)
where voucher_id is not null;

commit;
