-- 正式 / 測試資料分離
-- 目的：讓 production 與 test 的申請、發票、傳票、分類帳、附件與 audit log 不互相混用。

create or replace function public.finance_valid_data_environment(env text)
returns boolean
language sql
immutable
as $$
  select coalesce(env, 'production') in ('production', 'test');
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'expense_requests',
    'invoices',
    'vouchers',
    'ledger_entries',
    'bills',
    'notifications',
    'draft_requests',
    'application_accounting_lines',
    'file_attachments',
    'period_closes',
    'compliance_archives',
    'annual_reviews',
    'compliance_audit_logs'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I add column if not exists data_environment text not null default %L', t, 'production');
      execute format('update public.%I set data_environment = %L where data_environment is null', t, 'production');
      begin
        execute format(
          'alter table public.%I add constraint %I check (public.finance_valid_data_environment(data_environment))',
          t,
          t || '_data_environment_check'
        );
      exception
        when duplicate_object then null;
      end;
      execute format('create index if not exists %I on public.%I(data_environment)', 'idx_' || t || '_data_environment', t);
    end if;
  end loop;
end $$;

-- 防重複入帳：正式與測試各自有 posting key namespace，同一環境內仍不可重複。
drop index if exists public.idx_ledger_entries_posting_key;
create unique index if not exists idx_ledger_entries_data_env_posting_key
  on public.ledger_entries(data_environment, posting_key)
  where posting_key is not null;

drop index if exists public.idx_expense_requests_voucher_id;
create unique index if not exists idx_expense_requests_data_env_voucher_id
  on public.expense_requests(data_environment, voucher_id)
  where voucher_id is not null;

drop index if exists public.idx_vouchers_no;
create unique index if not exists idx_vouchers_data_env_no
  on public.vouchers(data_environment, no)
  where no is not null;

drop index if exists public.idx_invoices_no;
create unique index if not exists idx_invoices_data_env_no
  on public.invoices(data_environment, no)
  where no is not null;

drop index if exists public.idx_file_attachments_storage_path;
create unique index if not exists idx_file_attachments_data_env_storage_path
  on public.file_attachments(data_environment, storage_path)
  where storage_path is not null;

-- 常用報表查詢索引：三表、儀表板、傳票查詢都先鎖 data_environment。
create index if not exists idx_ledger_entries_env_entity_date
  on public.ledger_entries(data_environment, entity_id, entry_date);

create index if not exists idx_ledger_entries_env_dept_date
  on public.ledger_entries(data_environment, department_code, entry_date);

create index if not exists idx_expense_requests_env_status_step
  on public.expense_requests(data_environment, status, step);

create index if not exists idx_invoices_env_status_date
  on public.invoices(data_environment, status, invoice_date);

create index if not exists idx_draft_requests_env_owner
  on public.draft_requests(data_environment, owner_id, owner_email);

-- Storage 路徑新規則：
-- {record_type}/{data_environment}/{yyyy}/{mm}/{entity}/{department}/{record_no}/{kind}/{file}
-- 舊路徑仍可保留，但新檔案會自動帶 production/test 分層。
drop policy if exists "finance attachment read scoped" on storage.objects;
create policy "finance attachment read scoped"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'finance-attachments'
  and (
    exists (
      select 1
      from public.file_attachments fa
      where fa.bucket_id = storage.objects.bucket_id
        and fa.storage_path = storage.objects.name
        and fa.data_environment in ('production', 'test')
    )
    or (storage.foldername(name))[1] in ('expense_requests', 'invoices', 'draft_requests', 'vouchers')
  )
);

drop policy if exists "finance attachment upload scoped" on storage.objects;
create policy "finance attachment upload scoped"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'finance-attachments'
  and (storage.foldername(name))[1] in ('expense_requests', 'invoices', 'draft_requests', 'vouchers')
  and coalesce((storage.foldername(name))[2], 'production') in ('production', 'test')
);

-- 提供正式報表用 view：後續 BI / 會計師查帳可直接讀 production，不碰測試資料。
create or replace view public.finance_production_ledger_entries as
select *
from public.ledger_entries
where data_environment = 'production';

create or replace view public.finance_test_ledger_entries as
select *
from public.ledger_entries
where data_environment = 'test';
