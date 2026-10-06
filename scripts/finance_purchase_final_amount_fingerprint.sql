\set ON_ERROR_STOP on

-- Schema-only rollback fingerprint; no purchase or accounting rows are read.
with finalizer as (
  select
    p.oid::pg_catalog.regprocedure::text as signature,
    pg_catalog.pg_get_userbyid(p.proowner) as owner_name,
    p.prosecdef::text as security_definer,
    p.proconfig::text as settings,
    p.proacl::text as acl,
    pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) as definition_md5
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure(
    'public.finalize_expense_request(text,text,integer,jsonb,numeric,numeric,text,text,text,jsonb,numeric,text,date,jsonb)'
  )
)
select pg_catalog.md5(coalesce(pg_catalog.string_agg(
  pg_catalog.concat_ws('|', signature, owner_name, security_definer,
    settings, acl, definition_md5), E'\n' order by signature), '')) as fingerprint
from finalizer;
