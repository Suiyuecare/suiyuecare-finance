\set ON_ERROR_STOP on

-- Read only: verify the ledger, the RPC privilege boundary, and both final
-- posting allowlists after the atomic migration transaction commits.
do $postflight$
declare
  v_rpc oid := pg_catalog.to_regprocedure(
    'public.finance_bind_expense_invoice_item_v1(text,integer,integer,text,text,text)'
  )::oid;
  v_final_count integer;
begin
  select pg_catalog.count(*) into v_final_count from pg_catalog.pg_proc p
  where p.oid in (
    'private.finance_finalize_accounting_patch_v1(public.expense_requests,jsonb,jsonb,numeric,text)'::pg_catalog.regprocedure,
    'private.finance_finalize_utility_advance_patch_v1(public.expense_requests,jsonb,jsonb,numeric,text)'::pg_catalog.regprocedure
  ) and pg_catalog.pg_get_userbyid(p.proowner)='postgres'
    and p.proconfig=array['search_path=""']::text[]
    and p.prosrc like '%array[''id'',''sourceItemId'',''source'',''description''%';
  if not exists (
       select 1 from supabase_migrations.schema_migrations
       where version='20261008031845' and name='finance_bind_expense_invoice_item_v1'
     )
     or v_rpc is null or v_final_count<>2
     or not exists (
       select 1 from pg_catalog.pg_proc p where p.oid=v_rpc
         and pg_catalog.pg_get_userbyid(p.proowner)='postgres'
         and p.prosecdef and p.proconfig=array['search_path=""']::text[]
         and p.prosrc like '%INVOICE_ITEM_MANUAL_BIND%'
         and p.prosrc like '%app.finance_expense_write_context%'
     )
     or pg_catalog.has_function_privilege('anon',v_rpc,'EXECUTE')
     or pg_catalog.has_function_privilege('service_role',v_rpc,'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated',v_rpc,'EXECUTE') then
    raise exception 'invoice item binding postflight found incomplete installation or changed authority';
  end if;
end;
$postflight$;

select 'FINANCE_INVOICE_ITEM_BIND_POSTFLIGHT_OK' as marker;
