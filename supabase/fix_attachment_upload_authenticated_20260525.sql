-- Keep finance attachments private, but do not block upload only because
-- finance_users.active is temporarily out of sync with Supabase Auth.

begin;

update storage.buckets
set allowed_mime_types = array[
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
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
where id = 'finance-attachments';

drop policy if exists finance_attachments_insert_authenticated on storage.objects;

create policy finance_attachments_insert_authenticated
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'finance-attachments'
  and auth.uid() is not null
  and (storage.foldername(name))[1] in ('draft_requests','expense_requests','invoices','vouchers')
);

commit;
