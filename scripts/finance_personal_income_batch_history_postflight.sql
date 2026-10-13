\set ON_ERROR_STOP on

do $personal_income_batch_history_ledger_postflight$
begin
  if not exists(select 1 from supabase_migrations.schema_migrations where version='20261013091838' and name='finance_personal_income_batch_history_v1') then
    raise exception 'Personal income batch history ledger entry absent' using errcode='55000';
  end if;
end;
$personal_income_batch_history_ledger_postflight$;
do $personal_income_batch_history_postflight$
declare v_expected record; v_proc pg_catalog.pg_proc%rowtype;
begin
  for v_expected in select * from (values
      ('private.finance_personal_document_authorized_v1(public.finance_users,text,text,text)',false,'1db71550a2ec13ece520e25abb211e09'),
      ('public.finance_personal_document_summary_v1(text,integer,integer,text,text)',true,'2af52ffb295bd15d59092f400dfd70f7'),
      ('public.finance_personal_document_detail_v1(text,text)',true,'07b0d08b0dc4207b38bcae747e5624bb'),
      ('private.finance_history_actor_v1()',false,'4fa4b048271075bade4b7ddd3f424fc4'),
      ('private.finance_personal_history_page_allows_v1(public.finance_users)',true,'b2fed44ca1b66208649d50c7bfae921d')
  ) x(signature,security_definer,source_md5) loop
    select * into v_proc from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(v_expected.signature);
    if v_proc.oid is null or pg_catalog.pg_get_userbyid(v_proc.proowner)<>'postgres'
       or v_proc.prosecdef is distinct from v_expected.security_definer
       or v_proc.provolatile<>'s' or v_proc.proconfig is distinct from array['search_path=""']::text[]
       or pg_catalog.md5(v_proc.prosrc) is distinct from v_expected.source_md5
       or pg_catalog.has_function_privilege('anon',v_proc.oid,'EXECUTE')
       or pg_catalog.has_function_privilege('service_role',v_proc.oid,'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated',v_proc.oid,'EXECUTE') is distinct from (v_expected.signature like 'public.%')
       or exists(select 1 from pg_catalog.aclexplode(coalesce(v_proc.proacl,pg_catalog.acldefault('f',v_proc.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then
      raise exception 'Personal income batch history authority/source drift: %',v_expected.signature using errcode='55000';
    end if;
  end loop;
end;
$personal_income_batch_history_postflight$;
do $personal_income_batch_history_projection$
begin
  if pg_catalog.has_table_privilege('anon','private.finance_history_source_projection_v1','SELECT')
     or pg_catalog.has_table_privilege('authenticated','private.finance_history_source_projection_v1','SELECT')
     or pg_catalog.has_table_privilege('service_role','private.finance_history_source_projection_v1','SELECT') then
    raise exception 'Personal income batch history private projection exposure' using errcode='23514';
  end if;
  if exists(with sources as (
    select tenant_id,data_environment,'expense_requests'::text record_type,id source_id from public.expense_requests
    union all select tenant_id,data_environment,'bills',id from public.bills
    union all select tenant_id,data_environment,'invoices',id from public.invoices
  ) select 1 from sources s left join private.finance_history_source_projection_v1 p
    on p.tenant_id=s.tenant_id and p.data_environment=s.data_environment and p.record_type=s.record_type and p.source_id=s.source_id
    where s.tenant_id is not null and s.data_environment in('production','test') and p.source_id is null) then
    raise exception 'Personal income batch history complete-source projection mismatch' using errcode='23514';
  end if;
end;
$personal_income_batch_history_projection$;

select 'FINANCE_PERSONAL_INCOME_BATCH_HISTORY_POSTFLIGHT_OK' as marker;
