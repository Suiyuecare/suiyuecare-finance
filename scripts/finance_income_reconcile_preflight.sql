\set ON_ERROR_STOP on

-- Schema-only guard before installing the reconciliation/tombstone RPC.
do $preflight$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations
                 where version = '20261002035707')
     or exists (select 1 from supabase_migrations.schema_migrations
                    where version = '20261002130327')
     or pg_catalog.to_regclass('private.finance_income_document_operations') is null
     or pg_catalog.to_regprocedure('public.finance_income_reconcile_submission_v1(text,text,text)') is not null
     or not exists (
       select 1 from pg_catalog.pg_proc p
       where p.oid = pg_catalog.to_regprocedure(
         'private.finance_income_begin_operation(uuid,text,text,text,text,text)')
         and pg_catalog.md5(p.prosrc) = 'bbf7e2d060c8de355e5ff375f52a80e9'
     )
     or not exists (
       select 1 from pg_catalog.pg_constraint c
       where c.conrelid = 'private.finance_income_document_operations'::pg_catalog.regclass
         and c.conname = 'finance_income_document_operations_operation_status_check'
         and c.contype = 'c' and c.convalidated
         and pg_catalog.pg_get_constraintdef(c.oid) like '%in_progress%'
         and pg_catalog.pg_get_constraintdef(c.oid) like '%completed%'
     ) then
    raise exception 'income reconciliation baseline or migration ledger drifted';
  end if;
end;
$preflight$;

select 'FINANCE_INCOME_RECONCILE_PREFLIGHT_OK' as marker;
