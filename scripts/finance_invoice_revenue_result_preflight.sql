\set ON_ERROR_STOP on

-- Read-only gate before adding the invoice revenue result RPC.
do $preflight$
begin
  if not exists (
       select 1 from supabase_migrations.schema_migrations
       where version = '20261002130327'
     )
     or exists (
       select 1 from supabase_migrations.schema_migrations
       where version = '20261002151725'
     )
     or pg_catalog.to_regprocedure(
       'public.finance_invoice_revenue_result_v1(text,text)'
     ) is not null
     or pg_catalog.to_regprocedure('public.current_tenant_id()') is null
     or pg_catalog.to_regprocedure('public.current_finance_user_id()') is null
     or pg_catalog.to_regprocedure(
       'public.can_read_invoice(public.invoices)'
     ) is null
     or pg_catalog.to_regclass('public.invoices') is null
     or pg_catalog.to_regclass('public.ledger_entries') is null then
    raise exception 'invoice revenue result baseline or migration ledger drifted';
  end if;
end;
$preflight$;

select 'FINANCE_INVOICE_REVENUE_RESULT_PREFLIGHT_OK' as marker;
