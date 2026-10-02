\set ON_ERROR_STOP on

-- Inspect function source, ownership, ACL and the operation-status constraint.
do $postflight$
declare
  v_begin oid := pg_catalog.to_regprocedure(
    'private.finance_income_begin_operation(uuid,text,text,text,text,text)')::oid;
  v_reconcile oid := pg_catalog.to_regprocedure(
    'public.finance_income_reconcile_submission_v1(text,text,text)')::oid;
begin
  if v_begin is null or v_reconcile is null
     or not exists (
       select 1 from pg_catalog.pg_proc p where p.oid = v_begin
         and pg_catalog.md5(p.prosrc) = '3f303a874405e8bf113d648dcf0d11ae'
         and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
         and not p.prosecdef
         and p.proconfig = array['search_path=""']::text[]
     )
     or not exists (
       select 1 from pg_catalog.pg_proc p where p.oid = v_reconcile
         and pg_catalog.md5(p.prosrc) = 'daa241c67fe189f12deea6977050a523'
         and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
         and p.prosecdef
         and p.proconfig = array['search_path=""']::text[]
     )
     or not pg_catalog.has_function_privilege('authenticated', v_reconcile, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_reconcile, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_reconcile, 'EXECUTE')
     or not exists (
       select 1 from pg_catalog.pg_constraint c
       where c.conrelid = 'private.finance_income_document_operations'::pg_catalog.regclass
         and c.conname = 'finance_income_document_operations_operation_status_check'
         and c.contype = 'c' and c.convalidated
         and pg_catalog.pg_get_constraintdef(c.oid) like '%in_progress%'
         and pg_catalog.pg_get_constraintdef(c.oid) like '%completed%'
         and pg_catalog.pg_get_constraintdef(c.oid) like '%canceled%'
     ) then
    raise exception 'income reconciliation RPC, ACL or operation status drifted';
  end if;
end;
$postflight$;

select 'FINANCE_INCOME_RECONCILE_POSTFLIGHT_OK' as marker;
