\set ON_ERROR_STOP on

-- Schema and authority metadata only. Never reads ledger, voucher or attachment rows.
with relations as (
  select c.oid::pg_catalog.regclass::text as signature, c.relkind::text as kind,
    coalesce(c.relacl::text, '') as acl, coalesce(c.reloptions::text, '') as options,
    coalesce((select pg_catalog.string_agg(a.attname || ':' || a.attacl::text, ',' order by a.attnum)
      from pg_catalog.pg_attribute a where a.attrelid = c.oid and a.attacl is not null), '') as column_acl
  from pg_catalog.pg_class c
  where c.oid in (
    pg_catalog.to_regclass('public.ledger_entries'), pg_catalog.to_regclass('public.vouchers'),
    pg_catalog.to_regclass('public.finance_production_ledger_entries'),
    pg_catalog.to_regclass('public.finance_test_ledger_entries'))
), storage_policies as (
  select 'storage.objects:' || p.polname as signature, p.polcmd::text as kind,
    p.polpermissive::text as acl, p.polroles::text as options,
    coalesce(pg_catalog.md5(pg_catalog.pg_get_expr(p.polqual, p.polrelid)), '') || '/' ||
    coalesce(pg_catalog.md5(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid)), '') as column_acl
  from pg_catalog.pg_policy p
  where p.polrelid = pg_catalog.to_regclass('storage.objects')
), table_policies as (
  select p.polrelid::pg_catalog.regclass::text || ':' || p.polname as signature, p.polcmd::text as kind,
    p.polpermissive::text as acl, p.polroles::text as options,
    coalesce(pg_catalog.md5(pg_catalog.pg_get_expr(p.polqual, p.polrelid)), '') || '/' ||
    coalesce(pg_catalog.md5(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid)), '') as column_acl
  from pg_catalog.pg_policy p
  where p.polrelid in (pg_catalog.to_regclass('public.payee_bank_accounts'), pg_catalog.to_regclass('public.draft_requests'))
), all_metadata as (
  select * from relations union all select * from storage_policies union all select * from table_policies
)
select pg_catalog.md5(coalesce(pg_catalog.string_agg(
  pg_catalog.concat_ws('|', signature, kind, acl, options, column_acl), E'\n' order by signature), '')) as fingerprint
from all_metadata;
