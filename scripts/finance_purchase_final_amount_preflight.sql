\set ON_ERROR_STOP on

-- Read-only authority and ledger check before locking the purchase principal.
do $preflight$
declare
  v_finalizer oid := pg_catalog.to_regprocedure(
    'public.finalize_expense_request(text,text,integer,jsonb,numeric,numeric,text,text,text,jsonb,numeric,text,date,jsonb)'
  )::oid;
begin
  if not exists (
       select 1 from supabase_migrations.schema_migrations
       where version = '20261005173534'
     )
     or exists (
       select 1 from supabase_migrations.schema_migrations
       where version = '20261006153719'
     )
     or v_finalizer is null
     or pg_catalog.to_regclass('public.expense_requests') is null
     or pg_catalog.to_regclass('public.application_accounting_lines') is null
     or pg_catalog.to_regclass('public.vouchers') is null
     or pg_catalog.to_regclass('public.ledger_entries') is null
     or not exists (
       select 1 from pg_catalog.pg_proc p
       where p.oid = v_finalizer
         and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
         and p.prosecdef
         and p.proconfig = array['search_path=""']::text[]
         and pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) =
           '5a205c5dab0c9a521f09f2dc2c053be6'
     ) then
    raise exception 'purchase final amount baseline or migration ledger drifted';
  end if;
end;
$preflight$;

select 'FINANCE_PURCHASE_FINAL_AMOUNT_PREFLIGHT_OK' as marker;
