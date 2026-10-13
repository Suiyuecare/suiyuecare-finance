\set ON_ERROR_STOP on

with functions as (
  select p.oid::regprocedure::text signature,pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) definition_md5,
    pg_catalog.pg_get_userbyid(p.proowner) owner_name,p.proacl::text acl,p.prosecdef,p.proconfig::text settings
  from pg_catalog.pg_proc p where p.oid in (
    pg_catalog.to_regprocedure('private.finance_personal_bill_group_key_v1(public.bills)'),
    pg_catalog.to_regprocedure('private.finance_personal_document_authorized_v1(public.finance_users,text,text,text)'),
    pg_catalog.to_regprocedure('public.finance_personal_document_summary_v1(text,integer,integer,text,text)'),
    pg_catalog.to_regprocedure('public.finance_personal_document_detail_v1(text,text)'),
    pg_catalog.to_regprocedure('private.finance_history_actor_v1()'),
    pg_catalog.to_regprocedure('private.finance_personal_history_page_allows_v1(public.finance_users)')
  )
), data_fingerprints as (
  select 'public.finance_users' relation_name,pg_catalog.md5(coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by pg_catalog.to_jsonb(r)::text)::text,'')) row_md5 from public.finance_users r
  union all
  select 'public.tenant_members' relation_name,pg_catalog.md5(coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by pg_catalog.to_jsonb(r)::text)::text,'')) row_md5 from public.tenant_members r
  union all
  select 'auth.identities' relation_name,pg_catalog.md5(coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by pg_catalog.to_jsonb(r)::text)::text,'')) row_md5 from auth.identities r
  union all
  select 'auth.sessions' relation_name,pg_catalog.md5(coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by pg_catalog.to_jsonb(r)::text)::text,'')) row_md5 from auth.sessions r
  union all
  select 'public.expense_requests' relation_name,pg_catalog.md5(coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by pg_catalog.to_jsonb(r)::text)::text,'')) row_md5 from public.expense_requests r
  union all
  select 'public.bills' relation_name,pg_catalog.md5(coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by pg_catalog.to_jsonb(r)::text)::text,'')) row_md5 from public.bills r
  union all
  select 'public.invoices' relation_name,pg_catalog.md5(coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by pg_catalog.to_jsonb(r)::text)::text,'')) row_md5 from public.invoices r
  union all
  select 'public.approval_step_actor_snapshots' relation_name,pg_catalog.md5(coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by pg_catalog.to_jsonb(r)::text)::text,'')) row_md5 from public.approval_step_actor_snapshots r
  union all
  select 'private.finance_history_source_projection_v1' relation_name,pg_catalog.md5(coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by pg_catalog.to_jsonb(r)::text)::text,'')) row_md5 from private.finance_history_source_projection_v1 r
  union all
  select 'private.finance_history_group_projection_v1' relation_name,pg_catalog.md5(coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by pg_catalog.to_jsonb(r)::text)::text,'')) row_md5 from private.finance_history_group_projection_v1 r
), fingerprints as (
  select signature name,pg_catalog.concat_ws('|',definition_md5,owner_name,acl,prosecdef::text,settings) value from functions
  union all select relation_name,row_md5 from data_fingerprints
)
select pg_catalog.md5(coalesce(pg_catalog.string_agg(name||'|'||value,E'\n' order by name),'')) as fingerprint from fingerprints;
