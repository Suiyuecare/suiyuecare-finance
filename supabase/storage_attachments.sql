-- Module Finance attachment storage.
-- Apply after module_finance_production_schema.sql, rls_hardening.sql, and compliance_and_drafts.sql.
--
-- File path format used by index.html:
--   <record_type>/<data_environment>/<YYYY>/<MM>/<entity_id>/<department_code>/<record_no>/<file_kind>/<file>
-- Examples:
--   draft_requests/production/2026/05/E1/A1101/draft_123/draft_file/file.png
--   expense_requests/production/2026/05/E1/A1101/EXP-2026-0001/request_files/file.xls
--   expense_requests/production/2026/05/E1/A1101/EXP-2026-0001/passbook/file.png
--   invoices/production/2026/05/E1/A1101/AA-123456/receipt_proof/file.pdf
--
-- Archive rule:
--   - Year/month are based on the form/request/invoice date, not upload time.
--   - Entity and department are copied from the request/invoice so reporting and file audit match.
--   - Supporting documents are retained for 10 years by default.
--   - Old YYYY-MM paths remain readable for backward compatibility.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'finance-attachments',
  'finance-attachments',
  false,
  52428800,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream',
    'text/csv',
    'text/html',
    'text/plain'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.file_attachments (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null default 'finance-attachments',
  storage_path text not null unique,
  record_type text not null check (record_type in ('draft_requests','expense_requests','invoices','vouchers')),
  record_no text not null,
  file_kind text not null,
  file_name text not null,
  file_type text,
  file_size bigint,
  uploaded_by text,
  archive_year text,
  archive_month text,
  entity_id text,
  department_code text,
  record_date date,
  archive_path text,
  retention_policy text not null default 'finance_supporting_docs_10y',
  retention_until date,
  data_environment text not null default 'production',
  uploaded_at timestamptz not null default now()
);

do $$
begin
  alter table public.file_attachments add column if not exists archive_year text;
  alter table public.file_attachments add column if not exists archive_month text;
  alter table public.file_attachments add column if not exists entity_id text;
  alter table public.file_attachments add column if not exists department_code text;
  alter table public.file_attachments add column if not exists record_date date;
  alter table public.file_attachments add column if not exists archive_path text;
  alter table public.file_attachments add column if not exists retention_policy text not null default 'finance_supporting_docs_10y';
  alter table public.file_attachments add column if not exists retention_until date;
  alter table public.file_attachments add column if not exists data_environment text not null default 'production';

  if exists (
    select 1
    from pg_constraint
    where conname = 'file_attachments_record_type_check'
      and conrelid = 'public.file_attachments'::regclass
  ) then
    alter table public.file_attachments drop constraint file_attachments_record_type_check;
  end if;
  alter table public.file_attachments
    add constraint file_attachments_record_type_check
    check (record_type in ('draft_requests','expense_requests','invoices','vouchers'));
end $$;

create index if not exists file_attachments_archive_lookup_idx
on public.file_attachments (record_type, archive_year, archive_month, entity_id, department_code, record_no);

create index if not exists file_attachments_retention_idx
on public.file_attachments (retention_until)
where retention_until is not null;

alter table public.file_attachments enable row level security;
alter table public.file_attachments force row level security;

revoke all on table public.file_attachments from anon;
revoke all on table public.file_attachments from authenticated;
grant select, insert, delete on table public.file_attachments to authenticated;

drop policy if exists file_attachments_select_scoped on public.file_attachments;
drop policy if exists file_attachments_insert_authenticated on public.file_attachments;
drop policy if exists file_attachments_delete_ceo_only on public.file_attachments;

create policy file_attachments_select_scoped
on public.file_attachments
for select
to authenticated
using (
  (
    record_type = 'draft_requests'
    and exists (
      select 1
      from public.draft_requests d
      where d.id = file_attachments.record_no
        and (
          lower(d.owner_email) = lower(auth.jwt() ->> 'email')
          or d.owner_id = public.current_finance_user_id()
          or public.is_finance_admin()
        )
    )
  )
  or (
    record_type = 'expense_requests'
    and exists (
      select 1
      from public.expense_requests r
      where r.no = file_attachments.record_no
        and public.can_read_expense_request(r)
    )
  )
  or (
    record_type = 'invoices'
    and exists (
      select 1
      from public.invoices i
      where i.no = file_attachments.record_no
        and public.can_read_invoice(i)
    )
  )
);

create policy file_attachments_insert_authenticated
on public.file_attachments
for insert
to authenticated
with check (public.current_finance_user_id() is not null);

create policy file_attachments_delete_ceo_only
on public.file_attachments
for delete
to authenticated
using (public.current_finance_role() = 'ceo');

drop policy if exists finance_attachments_select_scoped on storage.objects;
drop policy if exists finance_attachments_insert_authenticated on storage.objects;
drop policy if exists finance_attachments_update_owner_or_ceo on storage.objects;
drop policy if exists finance_attachments_delete_ceo_only on storage.objects;

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
        select 1
        from public.draft_requests d
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
        select 1
        from public.expense_requests r
        where r.no in ((storage.foldername(name))[3], (storage.foldername(name))[6], (storage.foldername(name))[7])
          and public.can_read_expense_request(r)
      )
    )
    or (
      (storage.foldername(name))[1] = 'invoices'
      and exists (
        select 1
        from public.invoices i
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

create policy finance_attachments_insert_authenticated
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'finance-attachments'
  and public.current_finance_user_id() is not null
  and (storage.foldername(name))[1] in ('draft_requests','expense_requests','invoices','vouchers')
);

create policy finance_attachments_update_owner_or_ceo
on storage.objects
for update
to authenticated
using (
  bucket_id = 'finance-attachments'
  and (owner = auth.uid() or public.current_finance_role() = 'ceo')
)
with check (
  bucket_id = 'finance-attachments'
  and (owner = auth.uid() or public.current_finance_role() = 'ceo')
);

create policy finance_attachments_delete_ceo_only
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'finance-attachments'
  and public.current_finance_role() = 'ceo'
);

commit;
