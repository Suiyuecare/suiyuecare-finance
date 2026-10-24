\set ON_ERROR_STOP on

with schema_parts as (
  select 'namespace:'||n.nspname as key,concat_ws('|',n.nspowner::text,n.nspacl::text) as value from pg_namespace n where n.nspname in ('public','auth','logout_private','portal_handoff_private')
  union all
  select 'function:'||p.oid::regprocedure::text as key,
    concat_ws('|',p.proowner::text,p.prosecdef::text,p.proconfig::text,p.proacl::text,md5(pg_get_functiondef(p.oid))) as value
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','auth','logout_private','portal_handoff_private') and p.prokind='f'
  union all
  select 'relation:'||c.oid::regclass::text,concat_ws('|',c.relowner::text,c.relkind::text,c.relrowsecurity::text,c.relforcerowsecurity::text,c.relacl::text)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','logout_private','portal_handoff_private')
  union all
  select 'policy:'||schemaname||'.'||tablename||'.'||policyname,concat_ws('|',permissive,roles::text,cmd,qual,with_check)
  from pg_policies where schemaname in ('public','auth','logout_private','portal_handoff_private')
  union all
  select 'column:'||a.attrelid::regclass::text||'.'||a.attname,concat_ws('|',format_type(a.atttypid,a.atttypmod),a.attnotnull::text,pg_get_expr(d.adbin,d.adrelid))
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
  left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where n.nspname in ('public','auth','logout_private','portal_handoff_private') and a.attnum>0 and not a.attisdropped
), data_parts as (
  select 'auth.sessions'::text as key,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) as value from auth.sessions r
  union all
  select 'auth.identities'::text as key,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) as value from auth.identities r
  union all
  select 'auth.users'::text as key,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) as value from auth.users r
  union all
  select 'public.finance_users'::text as key,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) as value from public.finance_users r
  union all
  select 'supabase_migrations.schema_migrations'::text as key,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) as value from supabase_migrations.schema_migrations r
), private_relations(schema_name,table_name) as (
  values ('logout_private','module_receipts'),('portal_handoff_private','consumed')
), private_data_parts as (
  -- Fixed identifiers only; a row digest is returned, never identity data.
  select schema_name||'.'||table_name as key,
    case when to_regclass(format('%I.%I',schema_name,table_name)) is null then 'absent'
    else md5(query_to_xml(format(
      'select md5(coalesce(string_agg(to_jsonb(r)::text,E''\n'' order by to_jsonb(r)::text),'''')) as row_digest from %I.%I r',
      schema_name,table_name),true,false,'')::text) end as value
  from private_relations
), parts as (select * from schema_parts union all select * from data_parts union all select * from private_data_parts)
select md5(string_agg(key||'='||coalesce(value,''),E'\n' order by key)) as fingerprint from parts;
