\set ON_ERROR_STOP on

-- Function definitions and authority metadata only. Never reads employee or business rows.
with selected_functions as (
  select p.oid::pg_catalog.regprocedure::text as signature,
    pg_catalog.pg_get_userbyid(p.proowner) as owner_name,
    p.prosecdef::text as security_definer, p.proconfig::text as settings,
    p.proacl::text as acl, pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) as definition_md5
  from pg_catalog.pg_proc p
  where p.oid in (
    pg_catalog.to_regprocedure('public.finance_approval_tasks_for_current_user(text)'),
    pg_catalog.to_regprocedure('public.current_finance_user()'),
    pg_catalog.to_regprocedure('public.finance_auth_session_active()')
  )
)
select pg_catalog.md5(coalesce(pg_catalog.string_agg(
  pg_catalog.concat_ws('|',signature,owner_name,security_definer,settings,acl,definition_md5),
  E'\n' order by signature),'')) as fingerprint from selected_functions;
