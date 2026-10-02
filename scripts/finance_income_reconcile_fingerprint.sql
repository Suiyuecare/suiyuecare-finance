\set ON_ERROR_STOP on

-- Schema-only rollback fingerprint; never exports income documents or operations.
with parts as (
  select 'function'::text as kind, p.oid::regprocedure::text as object_name,
    pg_catalog.concat_ws('|', pg_catalog.pg_get_userbyid(p.proowner),
      p.prosecdef::text, p.proconfig::text, p.proacl::text, p.prosrc) as definition
  from pg_catalog.pg_proc p
  where p.oid in (
    pg_catalog.to_regprocedure('private.finance_income_begin_operation(uuid,text,text,text,text,text)'),
    pg_catalog.to_regprocedure('public.finance_income_reconcile_submission_v1(text,text,text)')
  )
  union all
  select 'constraint', c.conname,
    pg_catalog.concat_ws('|', c.convalidated::text, pg_catalog.pg_get_constraintdef(c.oid))
  from pg_catalog.pg_constraint c
  where c.conrelid = pg_catalog.to_regclass('private.finance_income_document_operations')
    and c.conname = 'finance_income_document_operations_operation_status_check'
)
select pg_catalog.md5(coalesce(pg_catalog.string_agg(
  kind || '|' || object_name || '|' || definition, E'\n' order by kind, object_name), '')) as fingerprint
from parts;
