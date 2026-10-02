\set ON_ERROR_STOP on

-- Schema-only rollback fingerprint; does not read or export request contents.
with parts as (
  select
    'function'::text as kind,
    proc_row.oid::regprocedure::text as object_name,
    pg_catalog.concat_ws('|',
      pg_catalog.pg_get_userbyid(proc_row.proowner),
      proc_row.prosecdef::text,
      proc_row.proconfig::text,
      proc_row.proacl::text,
      proc_row.prosrc
    ) as definition
  from pg_catalog.pg_proc proc_row
  where proc_row.oid in (
    'private.finance_accounting_line_is_human(jsonb)'::regprocedure,
    'private.finance_merge_human_accounting_line(jsonb,jsonb)'::regprocedure,
    'private.finance_merge_human_accounting_lines(jsonb,jsonb)'::regprocedure,
    'private.finance_preserve_human_accounting_authority()'::regprocedure
  )
  union all
  select
    'trigger',
    trigger_row.tgname,
    pg_catalog.concat_ws('|', trigger_row.tgenabled,
      pg_catalog.pg_get_triggerdef(trigger_row.oid, true))
  from pg_catalog.pg_trigger trigger_row
  where trigger_row.tgrelid = 'public.expense_requests'::regclass
    and trigger_row.tgname = 'trg_zz_finance_preserve_human_accounting_authority'
)
select pg_catalog.md5(coalesce(
  pg_catalog.string_agg(kind || '|' || object_name || '|' || definition,
    E'\n' order by kind, object_name), ''
)) as fingerprint
from parts;
