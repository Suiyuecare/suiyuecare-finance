-- Module Finance attachment download permissions hardening.
-- Apply after rls_hardening.sql and storage_attachments.sql.
--
-- Goal:
--   Attachment metadata and Storage objects are readable only by people who can
--   read the related request / invoice / voucher / own draft. The frontend also
--   checks this before asking Supabase for a signed URL, but these policies are
--   the authoritative database-side protection.

begin;

alter table public.file_attachments enable row level security;
alter table public.file_attachments force row level security;

revoke all on table public.file_attachments from anon;
revoke all on table public.file_attachments from authenticated;
grant select, insert, delete on table public.file_attachments to authenticated;

create or replace function public.can_read_file_attachment(p_file public.file_attachments)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (
      p_file.record_type = 'draft_requests'
      and exists (
        select 1
        from public.draft_requests d
        where d.id = p_file.record_no
          and (
            lower(d.owner_email) = lower(auth.jwt() ->> 'email')
            or d.owner_id = public.current_finance_user_id()
            or public.is_finance_admin()
          )
      )
    )
    or (
      p_file.record_type = 'expense_requests'
      and exists (
        select 1
        from public.expense_requests r
        where r.no = p_file.record_no
          and public.can_read_expense_request(r)
      )
    )
    or (
      p_file.record_type = 'invoices'
      and exists (
        select 1
        from public.invoices i
        where i.no = p_file.record_no
          and public.can_read_invoice(i)
      )
    )
    or (
      p_file.record_type = 'vouchers'
      and public.is_finance_accounting()
    )
$$;

drop policy if exists file_attachments_select_scoped on public.file_attachments;
drop policy if exists file_attachments_insert_authenticated on public.file_attachments;
drop policy if exists file_attachments_delete_ceo_only on public.file_attachments;

create policy file_attachments_select_scoped
on public.file_attachments
for select
to authenticated
using (public.can_read_file_attachment(file_attachments));

create policy file_attachments_insert_authenticated
on public.file_attachments
for insert
to authenticated
with check (
  public.current_finance_user_id() is not null
  and (
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
    or (
      record_type = 'vouchers'
      and public.is_finance_accounting()
    )
  )
);

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
    exists (
      select 1
      from public.file_attachments fa
      where fa.bucket_id = storage.objects.bucket_id
        and fa.storage_path = storage.objects.name
        and public.can_read_file_attachment(fa)
    )
    or (
      (storage.foldername(name))[1] = 'draft_requests'
      and exists (
        select 1
        from public.draft_requests d
        where d.id in ((storage.foldername(name))[3], (storage.foldername(name))[6])
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
        where r.no in ((storage.foldername(name))[3], (storage.foldername(name))[6])
          and public.can_read_expense_request(r)
      )
    )
    or (
      (storage.foldername(name))[1] = 'invoices'
      and exists (
        select 1
        from public.invoices i
        where i.no in ((storage.foldername(name))[3], (storage.foldername(name))[6])
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

revoke all on function public.can_read_file_attachment(public.file_attachments) from public, anon;
grant execute on function public.can_read_file_attachment(public.file_attachments) to authenticated;

commit;
