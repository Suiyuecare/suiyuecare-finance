\set ON_ERROR_STOP on

-- Schema-only rollback fingerprint; no invoice or accounting rows are read.
with parts as (
  select 'function'::text as kind,
    p.oid::pg_catalog.regprocedure::text as object_name,
    pg_catalog.concat_ws('|', pg_catalog.pg_get_userbyid(p.proowner),
      p.prosecdef::text, p.provolatile::text, p.proconfig::text,
      p.proacl::text, p.prosrc) as definition
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure(
    'public.finance_invoice_revenue_result_v1(text,text)'
  )
)
select pg_catalog.md5(coalesce(pg_catalog.string_agg(
  kind || '|' || object_name || '|' || definition,
  E'\n' order by kind, object_name), '')) as fingerprint
from parts;
