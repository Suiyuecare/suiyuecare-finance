\set ON_ERROR_STOP on

-- Read only: require the reviewed workflow, request guard, sync trigger and
-- operation helper before the new RPC can become callable.
do $preflight$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version='20261006153719')
     or exists (select 1 from supabase_migrations.schema_migrations where version='20261008031845')
     or pg_catalog.to_regclass('public.expense_requests') is null
     or pg_catalog.to_regclass('public.application_accounting_lines') is null
     or pg_catalog.to_regclass('public.module_audit_logs') is null
     or pg_catalog.to_regprocedure('private.finance_income_begin_operation(uuid,text,text,text,text,text)') is null
     or pg_catalog.to_regprocedure('private.finance_expense_actor_can_act(uuid,public.expense_requests,integer,jsonb,text,text,text)') is null
     or not exists (
       select 1 from pg_catalog.pg_trigger t
       where t.tgrelid='public.expense_requests'::pg_catalog.regclass
         and t.tgname='trg_finance_expense_controlled_write' and t.tgenabled='O'
     )
     or not exists (
       select 1 from pg_catalog.pg_trigger t
       where t.tgrelid='public.expense_requests'::pg_catalog.regclass
         and t.tgname='trg_zz_finance_sync_request_accounting_lines' and t.tgenabled='O'
     )
     or exists (
       select 1 from pg_catalog.pg_proc p
       where p.oid in (
         'private.finance_finalize_accounting_patch_v1(public.expense_requests,jsonb,jsonb,numeric,text)'::pg_catalog.regprocedure,
         'private.finance_finalize_utility_advance_patch_v1(public.expense_requests,jsonb,jsonb,numeric,text)'::pg_catalog.regprocedure
       ) and (pg_catalog.pg_get_userbyid(p.proowner)<>'postgres'
         or p.prosrc not like '%v_keys constant text[]%'
         or p.prosrc not like '%array[''id'',''source'',''description''%')
     ) then
    raise exception 'invoice item binding preflight found an unreviewed database baseline';
  end if;
end;
$preflight$;

select 'FINANCE_INVOICE_ITEM_BIND_PREFLIGHT_OK' as marker;
