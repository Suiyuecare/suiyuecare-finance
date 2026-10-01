-- Fail the protected frontend release if the adopted Storage cleanup helper
-- or either half of the SELECT/DELETE policy pair changes without review.
do $finance_attachment_cleanup$
declare
  helper pg_proc%rowtype;
  delete_policy record;
  select_policy record;
begin
  select * into helper
  from pg_proc
  where oid = to_regprocedure('public.finance_can_mutate_attachment_object_v2(text,text,timestamptz)');

  if helper.oid is null
     or md5(helper.prosrc) <> 'b7552f6a6199614a0ac46c6854402a95'
     or not helper.prosecdef
     or helper.provolatile <> 's'
     or pg_get_userbyid(helper.proowner) <> 'postgres'
     or helper.proconfig is distinct from array['search_path=""']::text[]
     or not has_function_privilege('authenticated', helper.oid, 'EXECUTE') then
    raise exception 'Finance staged attachment cleanup helper changed or is unavailable';
  end if;

  select * into delete_policy from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname = 'finance_attachments_delete_verified_google_v2';
  select * into select_policy from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname = 'finance_attachments_select_verified_owner_staged_cleanup_v3';

  if delete_policy.policyname is null or select_policy.policyname is null
     or delete_policy.cmd <> 'DELETE' or select_policy.cmd <> 'SELECT'
     or delete_policy.roles <> array['authenticated']::name[]
     or select_policy.roles <> array['authenticated']::name[]
     or delete_policy.qual is distinct from select_policy.qual
     or delete_policy.qual not like '%finance_can_mutate_attachment_object_v2(name, owner_id, created_at)%'
     or delete_policy.qual not like '%finance-attachments%' then
    raise exception 'Finance staged attachment SELECT/DELETE policies are missing or differ';
  end if;
end;
$finance_attachment_cleanup$;
