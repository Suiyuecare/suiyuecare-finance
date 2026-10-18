\set ON_ERROR_STOP on

-- Only schema/authority metadata. Existing requests and private recipients are never read.
with selected_functions as (
  select 'function'::text as kind,p.oid::pg_catalog.regprocedure::text as key,
    pg_catalog.jsonb_build_object('owner',pg_catalog.pg_get_userbyid(p.proowner),
      'definer',p.prosecdef,'volatility',p.provolatile,'settings',p.proconfig,
      'acl',p.proacl::text,'definition',pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)))::text as value
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where (n.nspname in ('private','public') and p.proname like 'finance_mega_%')
    or p.oid in (pg_catalog.to_regprocedure('public.current_finance_user()'),
      pg_catalog.to_regprocedure('public.can_read_expense_request(public.expense_requests)'),
      pg_catalog.to_regprocedure('private.finance_income_active_step_index(jsonb)'),
      pg_catalog.to_regprocedure('private.finance_income_step_role(jsonb)'),
      pg_catalog.to_regprocedure('private.finance_income_step_user_id(jsonb)'))
), selected_relations as (
  select 'relation'::text as kind,c.oid::pg_catalog.regclass::text as key,
    pg_catalog.jsonb_build_object('owner',pg_catalog.pg_get_userbyid(c.relowner),'kind',c.relkind,
      'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',c.relacl::text,
      'columns',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',a.attname,
        'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'required',a.attnotnull,'identity',a.attidentity)
        order by a.attnum) from pg_catalog.pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
      'constraints',(select pg_catalog.jsonb_agg(pg_catalog.pg_get_constraintdef(co.oid) order by co.conname)
        from pg_catalog.pg_constraint co where co.conrelid=c.oid),
      'policies',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(po) order by po.polname)
        from pg_catalog.pg_policy po where po.polrelid=c.oid),
      'triggers',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('definition',pg_catalog.pg_get_triggerdef(t.oid),'enabled',t.tgenabled) order by t.tgname)
        from pg_catalog.pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal))::text as value
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='private' and c.relname like 'finance_mega_%'
), selected_schema as (
  select 'schema'::text as kind,n.nspname as key,
    pg_catalog.jsonb_build_object('owner',pg_catalog.pg_get_userbyid(n.nspowner),'acl',n.nspacl::text)::text as value
  from pg_catalog.pg_namespace n where n.nspname='private'
), combined as (
  select * from selected_functions union all select * from selected_relations union all select * from selected_schema
)
select pg_catalog.md5(coalesce(pg_catalog.string_agg(kind||'|'||key||'|'||value,E'\n' order by kind,key),'')) as fingerprint
from combined;
