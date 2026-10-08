\set ON_ERROR_STOP on

-- Schema and authority metadata only. Never reads bill/customer rows.
with selected_functions as (
  select p.oid::pg_catalog.regprocedure::text as signature,
    pg_catalog.pg_get_userbyid(p.proowner) as owner_name,
    p.prosecdef::text as security_definer, p.proconfig::text as settings,
    p.proacl::text as acl, pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) as definition_md5
  from pg_catalog.pg_proc p
  where p.oid in (
    pg_catalog.to_regprocedure('public.finance_submit_bill_batch(text,jsonb,text)'),
    pg_catalog.to_regprocedure('private.finance_income_begin_operation(uuid,text,text,text,text,text)'),
    pg_catalog.to_regprocedure('private.finance_income_next_number(uuid,text,text,text)'),
    pg_catalog.to_regprocedure('private.finance_income_finish_operation(uuid,text,text,text,jsonb)'),
    pg_catalog.to_regprocedure('private.finance_history_projection_source_trigger_v1()')
  )
), selected_triggers as (
  select t.tgname as signature, t.tgenabled::text as owner_name,
    pg_catalog.pg_get_triggerdef(t.oid) as security_definer,
    t.tgnewtable::text as settings, ''::text as acl, ''::text as definition_md5
  from pg_catalog.pg_trigger t
  where t.tgrelid=pg_catalog.to_regclass('public.bills')
), all_metadata as (
  select * from selected_functions union all select * from selected_triggers
)
select pg_catalog.md5(coalesce(pg_catalog.string_agg(
  pg_catalog.concat_ws('|',signature,owner_name,security_definer,settings,acl,definition_md5),
  E'\n' order by signature),'')) as fingerprint from all_metadata;
