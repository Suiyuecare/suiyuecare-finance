\set ON_ERROR_STOP on

-- Read only: the installed finalizer must be the exact reviewed definition.
do $postflight$
declare
  v_finalizer oid := pg_catalog.to_regprocedure(
    'public.finalize_expense_request(text,text,integer,jsonb,numeric,numeric,text,text,text,jsonb,numeric,text,date,jsonb)'
  )::oid;
begin
  if not exists (
       select 1 from supabase_migrations.schema_migrations
       where version = '20261006153719'
         and name = 'purchase_final_amount_exact_lock_v1'
     )
     or v_finalizer is null
     or not exists (
       select 1 from pg_catalog.pg_proc p
       where p.oid = v_finalizer
         and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
         and p.prosecdef
         and p.proconfig = array['search_path=""']::text[]
         and pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) =
           '3f0bbc58dfcca1a293bc1abb4cefbdb4'
     ) then
    raise exception 'purchase final amount finalizer, authority or migration ledger drifted';
  end if;
end;
$postflight$;

select 'FINANCE_PURCHASE_FINAL_AMOUNT_POSTFLIGHT_OK' as marker;
