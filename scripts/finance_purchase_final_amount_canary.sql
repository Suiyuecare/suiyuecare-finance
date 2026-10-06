-- Metadata-only canary for the locked purchase finalizer.
begin isolation level repeatable read read only;
set local statement_timeout = '20s';

-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $canary$
declare
  v_finalizer oid := pg_catalog.to_regprocedure(
    'public.finalize_expense_request(text,text,integer,jsonb,numeric,numeric,text,text,text,jsonb,numeric,text,date,jsonb)'
  )::oid;
begin
  if auth.uid() is not null then
    raise exception 'purchase final amount canary must run without a user identity';
  end if;
  if v_finalizer is null or not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = v_finalizer
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and p.prosecdef
      and p.proconfig = array['search_path=""']::text[]
      and pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) =
        '3f0bbc58dfcca1a293bc1abb4cefbdb4'
  ) then
    raise exception 'purchase final amount canary found an unreviewed finalizer';
  end if;
end;
$canary$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END

rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $rollback_check$
begin
  if pg_catalog.current_setting('transaction_read_only') = 'on' then
    raise exception 'purchase final amount canary transaction remained open';
  end if;
end;
$rollback_check$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select
  'FINANCE_PURCHASE_FINAL_AMOUNT_CANARY_ROLLED_BACK' as marker,
  pg_catalog.jsonb_build_object(
    'canary', 'readonly_purchase_final_amount_v1',
    'ok', true,
    'rolled_back', true,
    'identity_scope_preserved', true
  ) as purchase_final_amount_canary_result;
