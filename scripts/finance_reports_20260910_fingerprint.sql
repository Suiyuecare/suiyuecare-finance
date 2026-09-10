\set ON_ERROR_STOP on

with schema_parts as (
  select 'function:'||p.oid::regprocedure::text as key,
    concat_ws('|',p.proowner::text,p.prosecdef::text,p.proconfig::text,p.proacl::text,md5(pg_get_functiondef(p.oid))) as value
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.prokind='f'
  union all
  select 'relation:'||c.oid::regclass::text,concat_ws('|',c.relkind::text,c.relrowsecurity::text,c.relforcerowsecurity::text,c.relacl::text)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private')
  union all
  select 'policy:'||schemaname||'.'||tablename||'.'||policyname,concat_ws('|',permissive,roles::text,cmd,qual,with_check)
  from pg_policies where schemaname in ('public','private')
  union all
  select 'column:'||a.attrelid::regclass::text||'.'||a.attname,concat_ws('|',format_type(a.atttypid,a.atttypmod),a.attnotnull::text,pg_get_expr(d.adbin,d.adrelid))
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
  left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where n.nspname in ('public','private') and a.attnum>0 and not a.attisdropped
  union all
  select 'constraint:'||c.conrelid::regclass::text||'.'||c.conname,pg_get_constraintdef(c.oid,true)
  from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname in ('public','private')
  union all
  select 'trigger:'||t.tgrelid::regclass::text||'.'||t.tgname,concat_ws('|',t.tgenabled::text,pg_get_triggerdef(t.oid,true))
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private') and not t.tgisinternal
), data_parts as (
  select 'public.finance_users'::text as key, md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) as value from public.finance_users r
  union all
  select 'public.tenant_members'::text as key, md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) as value from public.tenant_members r
  union all
  select 'public.employee_department_roles'::text as key, md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) as value from public.employee_department_roles r
  union all
  select 'public.system_settings'::text as key, md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) as value from public.system_settings r
  union all
  select 'public.departments'::text as key, md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) as value from public.departments r
  union all
  select 'public.finance_department_units'::text as key, md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) as value from public.finance_department_units r
  union all
  select 'public.finance_department_entity_scopes'::text as key, md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) as value from public.finance_department_entity_scopes r
  union all
  select 'public.users'::text as key, md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) as value from public.users r
  union all
  select 'public.attendance_punches'::text as key, md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) as value from public.attendance_punches r
  union all
  select 'public.punch_correction_requests'::text as key, md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) as value from public.punch_correction_requests r
  union all
  select 'public.module_audit_logs'::text as key, md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) as value from public.module_audit_logs r
  union all
  select 'public.compliance_audit_logs'::text as key, md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) as value from public.compliance_audit_logs r
  union all
  select 'public.invoices'::text as key, md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) as value from public.invoices r
  union all
  select 'public.expense_requests'::text as key, md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) as value from public.expense_requests r
  union all
  select 'public.application_accounting_lines'::text as key, md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) as value from public.application_accounting_lines r
  union all
  select 'public.ledger_entries'::text as key, md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) as value from public.ledger_entries r
  union all
  select 'public.vouchers'::text as key, md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) as value from public.vouchers r
  union all
  select 'public.notifications'::text as key, md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) as value from public.notifications r
  union all
  select 'private.finance_membership_org_versions_v1'::text as key, md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) as value from private.finance_membership_org_versions_v1 r
  union all
  select 'supabase_migrations.schema_migrations'::text as key, md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) as value from supabase_migrations.schema_migrations r
), report_relations(schema_name,table_name) as (
  values ('public','invoice_lifecycle_events'),
         ('public','bank_transactions'),
         ('public','bank_reconciliation_matches'),
         ('public','collection_followups'),
         ('public','receivable_followup_events'),
         ('public','notification_delivery_events'),
         ('private','finance_receipt_operations_v1'),
         ('private','finance_ar_terms_v1'),
         ('private','finance_ar_operations_v1'),
         ('private','finance_ar_receipts_v1'),
         ('private','finance_ar_refunds_v1'),
         ('private','finance_ar_audit_v1'),
         ('public','finance_reporting_profiles'),
         ('private','finance_reporting_profile_revisions_v1')
), report_data_parts as (
  -- Fixed identifiers only. CASE permits a fingerprint before the new tables
  -- exist and after migration rollback. The inner query returns a row hash,
  -- never raw financial data, and detects edits as well as row count changes.
  select schema_name||'.'||table_name as key,
    case when to_regclass(format('%I.%I',schema_name,table_name)) is null then 'absent'
    else md5(query_to_xml(format(
      'select md5(coalesce(string_agg(to_jsonb(r)::text,E''\n'' order by to_jsonb(r)::text),'''')) as row_digest from %I.%I r',
      schema_name,table_name),true,false,'')::text) end as value
  from report_relations
), parts as (select * from schema_parts union all select * from data_parts union all select * from report_data_parts)
select md5(string_agg(key||'='||coalesce(value,''),E'\n' order by key)) as fingerprint from parts;

-- Full affected data hashes remain server-side; only one fingerprint is returned.
-- REPEATABLE READ prevents concurrent transactions from changing the snapshot.
