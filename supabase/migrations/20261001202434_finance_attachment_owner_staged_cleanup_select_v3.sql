-- Supabase Storage remove requires SELECT as well as DELETE. The existing
-- finance_can_mutate_attachment_object_v2 predicate already limits DELETE to
-- the verified Google user who owns a staged object, or an unclaimed object
-- they uploaded in the last 30 minutes. Give that exact scope SELECT so a
-- failed formal upload can be cleaned without exposing claimed evidence.
create policy finance_attachments_select_verified_owner_staged_cleanup_v3
on storage.objects
for select
to authenticated
using (
  bucket_id = 'finance-attachments'
  and public.finance_can_mutate_attachment_object_v2(name, owner_id, created_at)
);
