-- Metadata-only canary for the authenticated invoice-item binding boundary.
begin isolation level repeatable read read only;
set local statement_timeout='20s';

-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $canary$
declare
  v_rpc oid := pg_catalog.to_regprocedure(
    'public.finance_bind_expense_invoice_item_v1(text,integer,integer,text,text,text)'
  )::oid;
begin
  if auth.uid() is not null or v_rpc is null then
    raise exception 'invoice item binding canary identity or RPC is not in its reviewed state';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_proc p where p.oid=v_rpc
      and pg_catalog.pg_get_userbyid(p.proowner)='postgres'
      and p.prosecdef and p.proconfig=array['search_path=""']::text[]
      and p.prosrc like '%INVOICE_ITEM_MANUAL_BIND%'
  ) or pg_catalog.has_function_privilege('anon',v_rpc,'EXECUTE')
    or pg_catalog.has_function_privilege('service_role',v_rpc,'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated',v_rpc,'EXECUTE') then
    raise exception 'invoice item binding canary found changed RPC authority';
  end if;
end;
$canary$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END

rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $rollback_check$
begin
  if pg_catalog.current_setting('transaction_read_only')='on' then
    raise exception 'invoice item binding canary transaction remained open';
  end if;
end;
$rollback_check$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select 'FINANCE_INVOICE_ITEM_BIND_CANARY_ROLLED_BACK' as marker,
  pg_catalog.jsonb_build_object(
    'canary','readonly_invoice_item_bind_v1','ok',true,'rolled_back',true,
    'identity_scope_preserved',true
  ) as invoice_item_bind_canary_result;
