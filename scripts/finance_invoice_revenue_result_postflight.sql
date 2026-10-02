\set ON_ERROR_STOP on

-- Inspect only schema and migration metadata; never expose ledger contents.
do $postflight$
declare
  v_result oid := pg_catalog.to_regprocedure(
    'public.finance_invoice_revenue_result_v1(text,text)'
  )::oid;
begin
  if not exists (
       select 1 from supabase_migrations.schema_migrations
       where version = '20261002151725'
         and name = 'finance_invoice_revenue_result_v1'
     )
     or v_result is null
     or not exists (
       select 1 from pg_catalog.pg_proc p
       where p.oid = v_result
         and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
         and p.prosecdef
         and p.provolatile = 's'
         and p.proconfig = array['search_path=""']::text[]
         and p.prorettype = 'jsonb'::pg_catalog.regtype
         and p.prosrc like '%public.can_read_invoice(i)%'
         and p.prosrc like '%public.ledger_entries%'
         and p.prosrc like '%v_matches=1%'
     )
     or not pg_catalog.has_function_privilege(
       'authenticated', v_result, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege('public', v_result, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_result, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_result, 'EXECUTE') then
    raise exception 'invoice revenue result RPC, ACL or ledger drifted';
  end if;
end;
$postflight$;

select 'FINANCE_INVOICE_REVENUE_RESULT_POSTFLIGHT_OK' as marker;
