-- Module Finance attachment storage.
-- Apply after module_finance_production_schema.sql, rls_hardening.sql, and compliance_and_drafts.sql.
--
-- File path format used by index.html:
--   draft_requests/YYYY-MM/draft_123/draft_file/file.png
--   expense_requests/YYYY-MM/EXP-2026-0001/request_files/file.xls
--   expense_requests/YYYY-MM/EXP-2026-0001/passbook/file.png
--   invoices/YYYY-MM/AA-123456/receipt_proof/file.pdf

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
  record_type text not null check (record_type in ('draft_requests','expense_requests','invoices')),
  record_no text not null,
  file_kind text not null,
  file_name text not null,
  file_type text,
  file_size bigint,
  uploaded_by text,
  uploaded_at timestamptz not null default now()
);

do $$
begin
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
    check (record_type in ('draft_requests','expense_requests','invoices'));
end $$;

alter table public.file_attachments enable row level security;

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
        where d.id = (storage.foldername(name))[3]
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
        where r.no = (storage.foldername(name))[3]
          and public.can_read_expense_request(r)
      )
    )
    or (
      (storage.foldername(name))[1] = 'invoices'
      and exists (
        select 1
        from public.invoices i
        where i.no = (storage.foldername(name))[3]
          and public.can_read_invoice(i)
      )
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
  and (storage.foldername(name))[1] in ('draft_requests','expense_requests','invoices')
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
